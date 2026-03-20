const IP_CHECK_URL = 'https://api.ipify.org?format=json';
const BLOCK_RULE_ID = 1;
const ALLOW_RULE_ID = 2;

// Initialize storage
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['whitelist', 'enabled'], (result) => {
    if (result.whitelist === undefined) {
      chrome.storage.local.set({ whitelist: [], enabled: true });
    }
  });
  checkAndApplyBlocking();
});

// Function to check current IP and apply blocking rules
async function checkAndApplyBlocking() {
  try {
    const response = await fetch(IP_CHECK_URL);
    const data = await response.json();
    const currentIP = data.ip;
    
    chrome.storage.local.set({ currentIP });
    
    const result = await chrome.storage.local.get(['whitelist', 'enabled']);
    const whitelist = result.whitelist || [];
    const enabled = result.enabled !== false;
    
    if (enabled && !whitelist.includes(currentIP)) {
      // IP not in whitelist, block all requests except IP check
      applyBlockingRules(true);
    } else {
      // IP in whitelist or disabled, allow all requests
      applyBlockingRules(false);
    }
  } catch (error) {
    console.error('Error checking IP:', error);
  }
}

function applyBlockingRules(shouldBlock) {
  if (shouldBlock) {
    chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [BLOCK_RULE_ID, ALLOW_RULE_ID],
      addRules: [
        {
          id: BLOCK_RULE_ID,
          priority: 1,
          action: { type: 'block' },
          condition: { urlFilter: '*', resourceTypes: ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'other'] }
        },
        {
          id: ALLOW_RULE_ID,
          priority: 2,
          action: { type: 'allow' },
          condition: { urlFilter: 'api.ipify.org', resourceTypes: ['xmlhttprequest'] }
        }
      ]
    });
  } else {
    chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [BLOCK_RULE_ID, ALLOW_RULE_ID]
    });
  }
}

// Intercept requests to trigger an IP check before they are processed
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    // Skip if it's the IP check itself to avoid infinite loops
    if (details.url.includes('api.ipify.org')) return;
    
    // Trigger an IP check and rule update
    checkAndApplyBlocking();
  },
  { urls: ["<all_urls>"] }
);

// Listen for changes in whitelist or enabled status
chrome.storage.onChanged.addListener((changes) => {
  if (changes.whitelist || changes.enabled) {
    checkAndApplyBlocking();
  }
});
