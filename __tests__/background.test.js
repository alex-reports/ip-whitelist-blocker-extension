// __tests__/background.test.js

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
    onStartup: { addListener: jest.fn() },
  },
  alarms: {
    create: jest.fn(),
    onAlarm: { addListener: jest.fn() },
  },
  webRequest: {
    onBeforeRequest: { addListener: jest.fn() },
  },
};

function mockFetch(ip) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ip }),
  });
}

function mockFetchFail() {
  global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
}

function mockStorage(values) {
  global.chrome.storage.local.get.mockResolvedValue(values);
}

const { checkAndApplyBlocking, applyBlockingRules, _resetForTesting } = require('../background');

beforeEach(() => {
  jest.clearAllMocks();
  _resetForTesting();
  global.chrome.declarativeNetRequest.updateDynamicRules.mockResolvedValue(undefined);
  global.chrome.storage.local.set.mockResolvedValue(undefined);
  global.chrome.storage.local.get.mockResolvedValue({});
});

// ─── checkAndApplyBlocking ───────────────────────────────────────────────────

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

});

// ─── applyBlockingRules ──────────────────────────────────────────────────────

describe('applyBlockingRules', () => {

  test('adds 2 rules when shouldBlock=true', async () => {
    await applyBlockingRules(true);

    const call = global.chrome.declarativeNetRequest.updateDynamicRules.mock.calls[0][0];
    expect(call.addRules).toHaveLength(2);
    expect(call.removeRuleIds).toEqual([1, 2]);
  });

  test('allow rule uses requestDomains (Fix 2)', async () => {
    await applyBlockingRules(true);

    const call = global.chrome.declarativeNetRequest.updateDynamicRules.mock.calls[0][0];
    const allowRule = call.addRules.find(r => r.action.type === 'allow');
    expect(allowRule.condition.requestDomains).toContain('api.ipify.org');
    expect(allowRule.condition.urlFilter).toBeUndefined();
  });

  test('removes rules when shouldBlock=false', async () => {
    await applyBlockingRules(false);

    const call = global.chrome.declarativeNetRequest.updateDynamicRules.mock.calls[0][0];
    expect(call.removeRuleIds).toEqual([1, 2]);
    expect(call.addRules).toBeUndefined();
  });

  test('stores ruleError in storage when updateDynamicRules fails (Fix 5)', async () => {
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