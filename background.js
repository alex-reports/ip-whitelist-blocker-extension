// background.js

const ALARM_NAME           = 'ip-check-fallback';
const ALARM_PERIOD_MINUTES = 1;
const RULE_ID_BLOCK        = 1;
const RULE_ID_ALLOW_IPIFY  = 2;
const RULE_ID_ALLOW_IPAPI  = 3;
const DEBOUNCE_MS          = 10000;
const IP_HISTORY_LIMIT     = 50;   // max entries to keep

let lastCheckTime = 0;
let isChecking    = false;

// ─── IP + Geo fetch ──────────────────────────────────────────────────────────

async function fetchIPAndGeo() {
  // Step 1: get current public IP
  const ipRes = await fetch('https://api.ipify.org?format=json');
  if (!ipRes.ok) throw new Error(`ipify HTTP ${ipRes.status}`);
  const { ip } = await ipRes.json();

  // Step 2: get geo/ISP/proxy data from ip-api.com
  // Fields: status, country, regionName, city, isp, org, as, proxy, hosting
  const geoRes = await fetch(
    `http://ip-api.com/json/${ip}?fields=status,country,regionName,city,isp,org,as,proxy,hosting`
  );
  if (!geoRes.ok) throw new Error(`ip-api HTTP ${geoRes.status}`);
  const geo = await geoRes.json();

  return { ip, geo };
}

// ─── History helpers ─────────────────────────────────────────────────────────

function buildHistoryEntry(ip, geo) {
  return {
    ip,
    ts:      Date.now(),
    country: geo.country      || '',
    city:    geo.city         || '',
    isp:     geo.isp          || '',
    proxy:   geo.proxy        || false,
    hosting: geo.hosting      || false,
  };
}

async function appendHistory(entry) {
  const result  = await chrome.storage.local.get(['ipHistory']);
  const history = result.ipHistory || [];

  // Only append if the IP actually changed
  if (history.length > 0 && history[history.length - 1].ip === entry.ip) return;

  history.push(entry);
  if (history.length > IP_HISTORY_LIMIT) history.splice(0, history.length - IP_HISTORY_LIMIT);

  await chrome.storage.local.set({ ipHistory: history });
}

// ─── Core check ──────────────────────────────────────────────────────────────

async function checkAndApplyBlocking() {
  const now = Date.now();
  if (isChecking || now - lastCheckTime < DEBOUNCE_MS) return;

  isChecking    = true;
  lastCheckTime = now;

  try {
    const { ip: currentIP, geo } = await fetchIPAndGeo();

    // Persist current IP + geo info
    await chrome.storage.local.set({
      currentIP,
      geoInfo:   geo,
      lastError: null,
    });

    // Append to history (only when IP changes)
    await appendHistory(buildHistoryEntry(currentIP, geo));

    const result    = await chrome.storage.local.get(['whitelist', 'enabled']);
    const whitelist = result.whitelist || [];
    const enabled   = result.enabled !== false;

    if (!enabled || whitelist.includes(currentIP)) {
      await applyBlockingRules(false);
    } else {
      await applyBlockingRules(true);
    }
  } catch (error) {
    console.error('Error checking IP:', error);
    await chrome.storage.local.set({ lastError: error.message });
    await applyBlockingRules(true);   // fail-closed
  } finally {
    isChecking = false;
  }
}

// ─── Blocking rules ───────────────────────────────────────────────────────────

async function applyBlockingRules(shouldBlock) {
  try {
    if (shouldBlock) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [RULE_ID_BLOCK, RULE_ID_ALLOW_IPIFY, RULE_ID_ALLOW_IPAPI],
        addRules: [
          {
            id:       RULE_ID_ALLOW_IPIFY,
            priority: 2,
            action:   { type: 'allow' },
            condition: {
              requestDomains: ['api.ipify.org'],
              resourceTypes:  ['xmlhttprequest', 'main_frame', 'sub_frame'],
            },
          },
          {
            id:       RULE_ID_ALLOW_IPAPI,
            priority: 2,
            action:   { type: 'allow' },
            condition: {
              requestDomains: ['ip-api.com'],
              resourceTypes:  ['xmlhttprequest', 'main_frame', 'sub_frame'],
            },
          },
          {
            id:       RULE_ID_BLOCK,
            priority: 1,
            action:   { type: 'block' },
            condition: {
              urlFilter:     '*',
              resourceTypes: [
                'main_frame', 'sub_frame', 'stylesheet', 'script',
                'image', 'font', 'xmlhttprequest', 'ping', 'media',
                'websocket', 'other',
              ],
            },
          },
        ],
      });

      // Reload all active tabs to kill existing WebRTC/WebSocket connections,
      // simulating a real network drop (same behaviour as physical disconnection).
      const tabs = await chrome.tabs.query({ status: 'complete' });
      for (const tab of tabs) {
        if (tab.id && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
          chrome.tabs.reload(tab.id);
        }
      }
    } else {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [RULE_ID_BLOCK, RULE_ID_ALLOW_IPIFY, RULE_ID_ALLOW_IPAPI],
      });
    }
    await chrome.storage.local.set({ ruleError: null });
  } catch (error) {
    console.error('Failed to update blocking rules:', error);
    await chrome.storage.local.set({ ruleError: error.message });
  }
}

// ─── Event listeners ─────────────────────────────────────────────────────────

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.url.includes('api.ipify.org') || details.url.includes('ip-api.com')) return;
    checkAndApplyBlocking();
  },
  { urls: ['<all_urls>'] }
);

chrome.runtime.onStartup.addListener(() => checkAndApplyBlocking());

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MINUTES });
  checkAndApplyBlocking();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    lastCheckTime = 0;
    checkAndApplyBlocking();
  }
});

chrome.storage.onChanged.addListener((changes) => {
  if ('enabled' in changes || 'whitelist' in changes) {
    lastCheckTime = 0;
    checkAndApplyBlocking();
  }
});

// Exports for testing
if (typeof module !== 'undefined') {
  module.exports = {
    checkAndApplyBlocking,
    applyBlockingRules,
    appendHistory,
    buildHistoryEntry,
    _resetForTesting: () => { lastCheckTime = 0; isChecking = false; },
  };
}
