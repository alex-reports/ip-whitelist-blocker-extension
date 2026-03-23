// background.js

// ─── Storage key constants ────────────────────────────────────────────────────
// Sync keys: persisted across Chrome instances via chrome.storage.sync
// Local keys: device-only (large data, transient state)

const STORAGE_KEYS = {
  // chrome.storage.sync
  WHITELIST:    'whitelist',
  ENABLED:      'enabled',
  PRIVACY_MODE: 'privacyMode',
  // chrome.storage.local
  CURRENT_IP:   'currentIP',
  GEO_INFO:     'geoInfo',
  RULE_ERROR:   'ruleError',
  LAST_ERROR:   'lastError',
  IP_HISTORY:   'ipHistory',
};

// ─── Constants ────────────────────────────────────────────────────────────────

const ALARM_NAME           = 'ip-check-fallback';
const ALARM_PERIOD_MINUTES = 1;
const RULE_ID_BLOCK        = 1;
const RULE_ID_ALLOW_IPIFY  = 2;
const RULE_ID_ALLOW_GEO    = 3;
const DEBOUNCE_MS          = 10000;
const IP_HISTORY_LIMIT     = 50;
const FETCH_TIMEOUT_MS     = 5000;

// IP sources tried in order: primary, then fallback
const IP_SOURCES = [
  'https://api.ipify.org?format=json',
  'https://api64.ipify.org?format=json',
];

// ─── State ────────────────────────────────────────────────────────────────────

let lastCheckTime = 0;
let isChecking    = false;

// ─── Fetch helpers ────────────────────────────────────────────────────────────

/**
 * fetch() with an AbortController timeout.
 * Throws AbortError if the request takes longer than `ms` milliseconds.
 */
async function fetchWithTimeout(url, ms = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch the current public IP address.
 * Tries IP_SOURCES in order: primary, then fallback on any failure.
 * Throws if all sources fail.
 */
async function fetchIP() {
  let lastError;
  for (const source of IP_SOURCES) {
    try {
      const res = await fetchWithTimeout(source);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      console.log(`[IP-Guard] IP fetched from ${source}: ${data.ip}`);
      return data.ip;
    } catch (err) {
      console.warn(`[IP-Guard] IP source failed (${source}): ${err.message}`);
      lastError = err;
    }
  }
  throw lastError || new Error('All IP sources failed');
}

/**
 * Fetch geo + ISP + VPN data for a given IP via ipwho.is (HTTPS, free).
 * Returns null when privacy mode is enabled or when the request fails.
 *
 * ipwho.is response shape:
 *   { success, ip, country, city, connection: { isp }, security: { vpn, proxy, tor } }
 */
async function fetchGeo(ip, privacyMode = false) {
  if (privacyMode) {
    console.log('[IP-Guard] Privacy mode enabled — skipping geo lookup');
    return null;
  }
  try {
    const res = await fetchWithTimeout(`https://ipwho.is/${ip}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error('ipwho.is returned success=false');
    // Remap to a stable internal shape (decoupled from API field names)
    return {
      country:  data.country   || '',
      city:     data.city      || '',
      isp:      data.connection?.isp || '',
      proxy:    data.security?.proxy || false,
      hosting:  data.security?.vpn   || false,
      tor:      data.security?.tor   || false,
    };
  } catch (err) {
    console.warn(`[IP-Guard] Geo fetch failed: ${err.message}`);
    return null;
  }
}

/**
 * Orchestrates IP + geo fetch with retry/fallback built into fetchIP().
 * Reads privacyMode from sync storage before deciding whether to call fetchGeo().
 */
async function fetchIPAndGeo() {
  const syncResult = await chrome.storage.sync.get([STORAGE_KEYS.PRIVACY_MODE]);
  const privacyMode = syncResult[STORAGE_KEYS.PRIVACY_MODE] || false;

  const ip  = await fetchIP();
  const geo = await fetchGeo(ip, privacyMode);
  return { ip, geo };
}

// ─── History helpers ──────────────────────────────────────────────────────────

function buildHistoryEntry(ip, geo) {
  return {
    ip,
    ts:      Date.now(),
    country: geo?.country  || '',
    city:    geo?.city     || '',
    isp:     geo?.isp      || '',
    proxy:   geo?.proxy    || false,
    hosting: geo?.hosting  || false,
  };
}

async function appendHistory(entry) {
  const result  = await chrome.storage.local.get([STORAGE_KEYS.IP_HISTORY]);
  const history = result[STORAGE_KEYS.IP_HISTORY] || [];

  // Only append when the IP actually changed
  if (history.length > 0 && history[history.length - 1].ip === entry.ip) return;

  history.push(entry);
  if (history.length > IP_HISTORY_LIMIT) {
    history.splice(0, history.length - IP_HISTORY_LIMIT);
  }

  await chrome.storage.local.set({ [STORAGE_KEYS.IP_HISTORY]: history });
  console.log(`[IP-Guard] History updated — ${history.length} entries`);
}

// ─── Badge helper ─────────────────────────────────────────────────────────────

/**
 * Updates the extension action badge to reflect current state:
 *   green "ON"  — IP is allowed
 *   red   "!"   — IP is blocked
 *   grey  "OFF" — blocker disabled
 *   yellow "ERR" — rule error
 */
async function updateBadge(state) {
  const configs = {
    allowed:  { text: 'ON',  color: '#22c55e' },
    blocked:  { text: '!',   color: '#ef4444' },
    disabled: { text: 'OFF', color: '#6b7280' },
    error:    { text: 'ERR', color: '#f59e0b' },
  };
  const cfg = configs[state] || configs.error;
  try {
    await chrome.action.setBadgeText({ text: cfg.text });
    await chrome.action.setBadgeBackgroundColor({ color: cfg.color });
  } catch (err) {
    console.warn(`[IP-Guard] Badge update failed: ${err.message}`);
  }
}

// ─── Notification helper ──────────────────────────────────────────────────────

async function notifyIPChange(newIP, blocked) {
  try {
    const message = blocked
      ? `Traffic blocked — IP changed to ${newIP}`
      : `IP changed to ${newIP} — traffic allowed`;
    chrome.notifications.create({
      type:     'basic',
      iconUrl:  'icons/icon48.png',
      title:    'IP Whitelist Blocker',
      message,
      priority: 2,
    });
    console.log(`[IP-Guard] Notification sent: ${message}`);
  } catch (err) {
    // Notification permission denied or API unavailable — fail silently
    console.warn(`[IP-Guard] Notification failed: ${err.message}`);
  }
}

// ─── Core check ───────────────────────────────────────────────────────────────

async function checkAndApplyBlocking() {
  const now = Date.now();
  if (isChecking || now - lastCheckTime < DEBOUNCE_MS) return;

  isChecking    = true;
  lastCheckTime = now;

  try {
    const { ip: currentIP, geo } = await fetchIPAndGeo();
    console.log(`[IP-Guard] Current IP: ${currentIP}`);

    // Persist current IP + geo info
    await chrome.storage.local.set({
      [STORAGE_KEYS.CURRENT_IP]: currentIP,
      [STORAGE_KEYS.GEO_INFO]:   geo,
      [STORAGE_KEYS.LAST_ERROR]: null,
    });

    // Read previous IP to detect change (for notifications)
    const prevState = await chrome.storage.local.get([STORAGE_KEYS.IP_HISTORY]);
    const history   = prevState[STORAGE_KEYS.IP_HISTORY] || [];
    const prevIP    = history.length > 0 ? history[history.length - 1].ip : null;
    const ipChanged = prevIP !== null && prevIP !== currentIP;

    // Append to history (only when IP changes)
    await appendHistory(buildHistoryEntry(currentIP, geo));

    // Read whitelist + enabled from sync storage
    const syncResult = await chrome.storage.sync.get([
      STORAGE_KEYS.WHITELIST,
      STORAGE_KEYS.ENABLED,
    ]);
    const whitelist = syncResult[STORAGE_KEYS.WHITELIST] || [];
    const enabled   = syncResult[STORAGE_KEYS.ENABLED] !== false;

    if (!enabled) {
      await applyBlockingRules(false);
      await updateBadge('disabled');
    } else if (whitelist.includes(currentIP)) {
      await applyBlockingRules(false);
      await updateBadge('allowed');
      if (ipChanged) await notifyIPChange(currentIP, false);
    } else {
      await applyBlockingRules(true);
      await updateBadge('blocked');
      if (ipChanged) await notifyIPChange(currentIP, true);
      console.log(`[IP-Guard] IP ${currentIP} not in whitelist — blocking enabled`);
    }
  } catch (error) {
    console.error('[IP-Guard] Error checking IP:', error);
    await chrome.storage.local.set({ [STORAGE_KEYS.LAST_ERROR]: error.message });
    await applyBlockingRules(true); // fail-closed
    await updateBadge('error');
  } finally {
    isChecking = false;
  }
}

// ─── Blocking rules ───────────────────────────────────────────────────────────

async function applyBlockingRules(shouldBlock) {
  try {
    if (shouldBlock) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [RULE_ID_BLOCK, RULE_ID_ALLOW_IPIFY, RULE_ID_ALLOW_GEO],
        addRules: [
          {
            id:       RULE_ID_ALLOW_IPIFY,
            priority: 2,
            action:   { type: 'allow' },
            condition: {
              requestDomains: ['api.ipify.org', 'api64.ipify.org'],
              resourceTypes:  ['xmlhttprequest', 'main_frame', 'sub_frame'],
            },
          },
          {
            id:       RULE_ID_ALLOW_GEO,
            priority: 2,
            action:   { type: 'allow' },
            condition: {
              requestDomains: ['ipwho.is'],
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

      // Reload only the active focused tab to kill WebRTC/WebSocket connections
      // (simulates a real network drop without disrupting all background tabs)
      const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (
        activeTab?.id &&
        activeTab.url &&
        !activeTab.url.startsWith('chrome://') &&
        !activeTab.url.startsWith('chrome-extension://')
      ) {
        chrome.tabs.reload(activeTab.id);
        console.log(`[IP-Guard] Reloaded active tab ${activeTab.id} to kill existing connections`);
      }
    } else {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [RULE_ID_BLOCK, RULE_ID_ALLOW_IPIFY, RULE_ID_ALLOW_GEO],
      });
    }
    await chrome.storage.local.set({ [STORAGE_KEYS.RULE_ERROR]: null });
  } catch (error) {
    console.error('[IP-Guard] Failed to update blocking rules:', error);
    await chrome.storage.local.set({ [STORAGE_KEYS.RULE_ERROR]: error.message });
  }
}

// ─── Event listeners ──────────────────────────────────────────────────────────

// Trigger on main-frame navigations only (replaces webRequest listener)
// frameId === 0 ensures we only react to top-level page loads, not iframes
chrome.webNavigation.onCommitted.addListener(
  (details) => {
    if (details.frameId !== 0) return;
    checkAndApplyBlocking();
  },
  { url: [{ schemes: ['http', 'https'] }] }
);

chrome.runtime.onStartup.addListener(() => {
  console.log('[IP-Guard] Browser started — running IP check');
  checkAndApplyBlocking();
});

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log(`[IP-Guard] Extension ${details.reason}`);
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MINUTES });

  // On first install: auto-whitelist current IP for a good first-run experience
  if (details.reason === 'install') {
    try {
      const ip = await fetchIP();
      const syncResult = await chrome.storage.sync.get([STORAGE_KEYS.WHITELIST]);
      const whitelist  = syncResult[STORAGE_KEYS.WHITELIST] || [];
      if (ip && !whitelist.includes(ip)) {
        whitelist.push(ip);
        await chrome.storage.sync.set({ [STORAGE_KEYS.WHITELIST]: whitelist });
        console.log(`[IP-Guard] Auto-whitelisted on install: ${ip}`);
      }
    } catch (err) {
      console.warn(`[IP-Guard] Auto-whitelist on install failed: ${err.message}`);
    }
  }

  checkAndApplyBlocking();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    lastCheckTime = 0;
    checkAndApplyBlocking();
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && (STORAGE_KEYS.ENABLED in changes || STORAGE_KEYS.WHITELIST in changes)) {
    console.log('[IP-Guard] Settings changed — re-checking IP');
    lastCheckTime = 0;
    checkAndApplyBlocking();
  }
});

// ─── Exports for testing ──────────────────────────────────────────────────────

if (typeof module !== 'undefined') {
  module.exports = {
    checkAndApplyBlocking,
    applyBlockingRules,
    appendHistory,
    buildHistoryEntry,
    fetchWithTimeout,
    fetchIP,
    fetchGeo,
    updateBadge,
    notifyIPChange,
    STORAGE_KEYS,
    IP_SOURCES,
    _resetForTesting: () => { lastCheckTime = 0; isChecking = false; },
  };
}
