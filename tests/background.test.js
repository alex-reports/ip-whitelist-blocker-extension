// tests/background.test.js

global.chrome = {
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn().mockResolvedValue(undefined),
    },
    onChanged: { addListener: jest.fn() },
  },
  declarativeNetRequest: {
    updateDynamicRules: jest.fn().mockResolvedValue(undefined),
  },
  runtime: {
    onInstalled: { addListener: jest.fn() },
    onStartup:   { addListener: jest.fn() },
  },
  alarms: {
    create:   jest.fn(),
    onAlarm:  { addListener: jest.fn() },
  },
  webRequest: {
    onBeforeRequest: { addListener: jest.fn() },
  },
  tabs: {
    query:  jest.fn().mockResolvedValue([]),
    reload: jest.fn(),
  },
};

function mockFetch(ip, geo = {}) {
  global.fetch = jest.fn()
    // First call → ipify
    .mockResolvedValueOnce({ ok: true, json: async () => ({ ip }) })
    // Second call → ip-api.com
    .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'success', ...geo }) });
}

function mockFetchFail() {
  global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
}

function mockStorage(values) {
  global.chrome.storage.local.get.mockResolvedValue(values);
}

const {
  checkAndApplyBlocking,
  applyBlockingRules,
  appendHistory,
  buildHistoryEntry,
  _resetForTesting,
} = require('../background');

beforeEach(() => {
  jest.clearAllMocks();
  _resetForTesting();
  global.chrome.declarativeNetRequest.updateDynamicRules.mockResolvedValue(undefined);
  global.chrome.storage.local.set.mockResolvedValue(undefined);
  global.chrome.storage.local.get.mockResolvedValue({});
});

// ─── checkAndApplyBlocking ────────────────────────────────────────────────────

describe('checkAndApplyBlocking', () => {

  test('blocks traffic when IP is not in whitelist', async () => {
    mockFetch('1.2.3.4');
    mockStorage({ whitelist: ['9.9.9.9'], enabled: true });

    await checkAndApplyBlocking();

    const call = global.chrome.declarativeNetRequest.updateDynamicRules.mock.calls[0][0];
    expect(call.addRules).toBeDefined();
  });

  test('allows traffic when IP is in whitelist', async () => {
    mockFetch('1.2.3.4');
    mockStorage({ whitelist: ['1.2.3.4'], enabled: true });

    await checkAndApplyBlocking();

    const call = global.chrome.declarativeNetRequest.updateDynamicRules.mock.calls[0][0];
    expect(call.addRules).toBeUndefined();
  });

  test('allows traffic when blocker is disabled', async () => {
    mockFetch('1.2.3.4');
    mockStorage({ whitelist: [], enabled: false });

    await checkAndApplyBlocking();

    const call = global.chrome.declarativeNetRequest.updateDynamicRules.mock.calls[0][0];
    expect(call.addRules).toBeUndefined();
  });

  test('blocks traffic when whitelist is empty', async () => {
    mockFetch('1.2.3.4');
    mockStorage({ whitelist: [], enabled: true });

    await checkAndApplyBlocking();

    const call = global.chrome.declarativeNetRequest.updateDynamicRules.mock.calls[0][0];
    expect(call.addRules).toBeDefined();
  });

  test('defaults to enabled=true and empty whitelist when storage is empty', async () => {
    mockFetch('1.2.3.4');
    mockStorage({});

    await checkAndApplyBlocking();

    const call = global.chrome.declarativeNetRequest.updateDynamicRules.mock.calls[0][0];
    expect(call.addRules).toBeDefined();
  });

  test('FAIL-CLOSED: blocks traffic when fetch fails', async () => {
    mockFetchFail();
    mockStorage({ whitelist: ['1.2.3.4'], enabled: true });

    await checkAndApplyBlocking();

    const call = global.chrome.declarativeNetRequest.updateDynamicRules.mock.calls[0][0];
    expect(call.addRules).toBeDefined();
  });

  test('FAIL-CLOSED: stores lastError when fetch fails', async () => {
    mockFetchFail();
    mockStorage({});

    await checkAndApplyBlocking();

    expect(global.chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ lastError: expect.any(String) })
    );
  });

  test('stores currentIP in storage after successful fetch', async () => {
    mockFetch('5.6.7.8');
    mockStorage({ whitelist: [], enabled: true });

    await checkAndApplyBlocking();

    expect(global.chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ currentIP: '5.6.7.8' })
    );
  });

  test('stores geoInfo in storage after successful fetch', async () => {
    mockFetch('5.6.7.8', { country: 'DE', city: 'Berlin', isp: 'Telekom', proxy: false, hosting: false });
    mockStorage({ whitelist: [], enabled: true });

    await checkAndApplyBlocking();

    expect(global.chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ geoInfo: expect.objectContaining({ country: 'DE' }) })
    );
  });

});

// ─── applyBlockingRules ───────────────────────────────────────────────────────

describe('applyBlockingRules', () => {

  test('adds 3 rules when shouldBlock=true (ipify + ip-api + block)', async () => {
    await applyBlockingRules(true);

    const call = global.chrome.declarativeNetRequest.updateDynamicRules.mock.calls[0][0];
    expect(call.addRules).toHaveLength(3);
    expect(call.removeRuleIds).toEqual([1, 2, 3]);
  });

  test('ipify allow rule uses requestDomains', async () => {
    await applyBlockingRules(true);

    const call      = global.chrome.declarativeNetRequest.updateDynamicRules.mock.calls[0][0];
    const allowRule = call.addRules.find(r => r.condition.requestDomains?.includes('api.ipify.org'));
    expect(allowRule).toBeDefined();
    expect(allowRule.action.type).toBe('allow');
    expect(allowRule.condition.urlFilter).toBeUndefined();
  });

  test('ip-api allow rule uses requestDomains', async () => {
    await applyBlockingRules(true);

    const call      = global.chrome.declarativeNetRequest.updateDynamicRules.mock.calls[0][0];
    const allowRule = call.addRules.find(r => r.condition.requestDomains?.includes('ip-api.com'));
    expect(allowRule).toBeDefined();
    expect(allowRule.action.type).toBe('allow');
  });

  test('removes all 3 rule IDs when shouldBlock=false', async () => {
    await applyBlockingRules(false);

    const call = global.chrome.declarativeNetRequest.updateDynamicRules.mock.calls[0][0];
    expect(call.removeRuleIds).toEqual([1, 2, 3]);
    expect(call.addRules).toBeUndefined();
  });

  test('reloads all eligible tabs when blocking is applied', async () => {
    global.chrome.tabs.query.mockResolvedValueOnce([
      { id: 1, status: 'complete', url: 'https://meet.google.com/abc' },
      { id: 2, status: 'complete', url: 'https://example.com' },
      { id: 3, status: 'complete', url: 'chrome://extensions/' },           // skipped
      { id: 4, status: 'complete', url: 'chrome-extension://xyz/popup.html' }, // skipped
    ]);

    await applyBlockingRules(true);

    expect(global.chrome.tabs.reload).toHaveBeenCalledTimes(2);
    expect(global.chrome.tabs.reload).toHaveBeenCalledWith(1);
    expect(global.chrome.tabs.reload).toHaveBeenCalledWith(2);
    expect(global.chrome.tabs.reload).not.toHaveBeenCalledWith(3);
    expect(global.chrome.tabs.reload).not.toHaveBeenCalledWith(4);
  });

  test('does NOT reload tabs when unblocking', async () => {
    await applyBlockingRules(false);

    expect(global.chrome.tabs.reload).not.toHaveBeenCalled();
  });

  test('stores ruleError in storage when updateDynamicRules fails', async () => {
    global.chrome.declarativeNetRequest.updateDynamicRules.mockRejectedValueOnce(
      new Error('Rule limit exceeded')
    );

    await applyBlockingRules(true);

    expect(global.chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ ruleError: 'Rule limit exceeded' })
    );
  });

  test('clears ruleError on success', async () => {
    await applyBlockingRules(true);

    expect(global.chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ ruleError: null })
    );
  });

});

// ─── appendHistory ────────────────────────────────────────────────────────────

describe('appendHistory', () => {

  test('appends entry when IP changes', async () => {
    global.chrome.storage.local.get.mockResolvedValue({ ipHistory: [
      { ip: '1.1.1.1', ts: 1000 },
    ]});

    const entry = { ip: '2.2.2.2', ts: 2000, country: 'DE', city: 'Berlin', proxy: false, hosting: false };
    await appendHistory(entry);

    expect(global.chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        ipHistory: expect.arrayContaining([
          expect.objectContaining({ ip: '2.2.2.2' }),
        ]),
      })
    );
  });

  test('does not append when IP is the same as last entry', async () => {
    global.chrome.storage.local.get.mockResolvedValue({ ipHistory: [
      { ip: '1.1.1.1', ts: 1000 },
    ]});

    await appendHistory({ ip: '1.1.1.1', ts: 2000 });

    expect(global.chrome.storage.local.set).not.toHaveBeenCalled();
  });

  test('trims history to 50 entries', async () => {
    const existing = Array.from({ length: 50 }, (_, i) => ({ ip: `10.0.0.${i}`, ts: i }));
    global.chrome.storage.local.get.mockResolvedValue({ ipHistory: existing });

    await appendHistory({ ip: '99.99.99.99', ts: 9999 });

    const stored = global.chrome.storage.local.set.mock.calls[0][0].ipHistory;
    expect(stored).toHaveLength(50);
    expect(stored[stored.length - 1].ip).toBe('99.99.99.99');
  });

});

// ─── buildHistoryEntry ────────────────────────────────────────────────────────

describe('buildHistoryEntry', () => {

  test('maps ip and geo fields correctly', () => {
    const geo   = { country: 'US', city: 'NY', isp: 'Comcast', proxy: true, hosting: false };
    const entry = buildHistoryEntry('1.2.3.4', geo);

    expect(entry.ip).toBe('1.2.3.4');
    expect(entry.country).toBe('US');
    expect(entry.city).toBe('NY');
    expect(entry.isp).toBe('Comcast');
    expect(entry.proxy).toBe(true);
    expect(entry.hosting).toBe(false);
    expect(entry.ts).toBeDefined();
  });

  test('handles missing geo fields gracefully', () => {
    const entry = buildHistoryEntry('1.2.3.4', {});
    expect(entry.country).toBe('');
    expect(entry.city).toBe('');
    expect(entry.proxy).toBe(false);
  });

});
