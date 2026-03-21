// background.js — fixed version

const ALARM_NAME = 'ip-check-fallback';
const ALARM_PERIOD_MINUTES = 1;
const RULE_ID_BLOCK = 1;
const RULE_ID_ALLOW_IPIFY = 2;
const DEBOUNCE_MS = 10000;

let lastCheckTime = 0;
let isChecking = false;

async function checkAndApplyBlocking() {
  const now = Date.now();
  if (isChecking || now - lastCheckTime < DEBOUNCE_MS) return;

  isChecking = true;
  lastCheckTime = now;

  try {
    const response = await fetch('https://api.ipify.org?format=json');
    if (!response.ok) throw new Error(`HTTP error: ${response.status}`);

    const data = await response.json();
    const currentIP = data.ip;

    await chrome.storage.local.set({ currentIP, lastError: null });

    const result = await chrome.storage.local.get(['whitelist', 'enabled']);
    const whitelist = result.whitelist || [];
    const enabled = result.enabled !== false;

    if (!enabled) {
      await applyBlockingRules(false);
    } else if (whitelist.includes(currentIP)) {
      await applyBlockingRules(false);
    } else {
      await applyBlockingRules(true);
    }
  } catch (error) {
    console.error('Error checking IP:', error);
    // Fix 6: fail-closed — if IP cannot be verified, block all traffic
    await chrome.storage.local.set({ lastError: error.message });
    await applyBlockingRules(true);
  } finally {
    isChecking = false;
  }
}

async function applyBlockingRules(shouldBlock) {
  try {
    if (shouldBlock) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [RULE_ID_BLOCK, RULE_ID_ALLOW_IPIFY],
        addRules: [
          {
            id: RULE_ID_ALLOW_IPIFY,
            priority: 2,
            action: { type: 'allow' },
            condition: {
              // Fix 2: use requestDomains for exact domain match (not substring urlFilter)
              requestDomains: ['api.ipify.org'],
              resourceTypes: ['xmlhttprequest', 'main_frame', 'sub_frame']
            }
          },
          {
            id: RULE_ID_BLOCK,
            priority: 1,
            action: { type: 'block' },
            condition: {
              urlFilter: '*',
              resourceTypes: [
                'main_frame', 'sub_frame', 'stylesheet', 'script',
                'image', 'font', 'xmlhttprequest', 'ping', 'media',
                'websocket', 'other'
              ]
            }
          }
        ]
      });
    } else {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [RULE_ID_BLOCK, RULE_ID_ALLOW_IPIFY]
      });
    }
    // Fix 5: clear any previously stored rule error
    await chrome.storage.local.set({ ruleError: null });
  } catch (error) {
    // Fix 5: store rule error in storage so popup can display a warning
    console.error('Failed to update blocking rules:', error);
    await chrome.storage.local.set({ ruleError: error.message });
  }
}

// Check IP on every outgoing request (debounced to max once per 10s)
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.url.includes('api.ipify.org')) return;
    checkAndApplyBlocking();
  },
  { urls: ['<all_urls>'] }
);

// Fix 3: re-apply blocking rules every time Chrome starts up
chrome.runtime.onStartup.addListener(() => {
  checkAndApplyBlocking();
});

// Register fallback alarm on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MINUTES });
  checkAndApplyBlocking();
});

// Fallback: check IP via alarm
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    lastCheckTime = 0;
    checkAndApplyBlocking();
  }
});

// Re-check whenever the user toggles the blocker or updates the whitelist
chrome.storage.onChanged.addListener((changes) => {
  if ('enabled' in changes || 'whitelist' in changes) {
    lastCheckTime = 0;
    checkAndApplyBlocking();
  }
});

// Exports for testing
if (typeof module !== 'undefined') {
  module.exports = { checkAndApplyBlocking, applyBlockingRules, _resetForTesting: () => { lastCheckTime = 0; isChecking = false; } };
}