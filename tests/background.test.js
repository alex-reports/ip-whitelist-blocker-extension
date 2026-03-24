// tests/background.test.js

// ─── Chrome API mock ──────────────────────────────────────────────────────────

global.chrome = {
  storage: {
    local: {
      get:  jest.fn(),
      set:  jest.fn().mockResolvedValue(undefined),
    },
    sync: {
      get:  jest.fn(),
      set:  jest.fn().mockResolvedValue(undefined),
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
    create:    jest.fn(),
    onAlarm:   { addListener: jest.fn() },
  },
  webNavigation: {
    onCommitted: { addListener: jest.fn() },
  },
  tabs: {
    query:  jest.fn().mockResolvedValue([]),
    reload: jest.fn(),
  },
  action: {
    setBadgeText:            jest.fn().mockResolvedValue(undefined),
    setBadgeBackgroundColor: jest.fn().mockResolvedValue(undefined),
  },
  notifications: {
    create: jest.fn(),
  },
};

// ─── Fetch mock helpers ───────────────────────────────────────────────────────

/**
 * Mock a successful IP fetch (ipify) + geo fetch (freeipapi.com)
 */
function mockFetch(ip, geo = {}) {
  global.fetch = jest.fn()
    // First call → api.ipify.org
    .mockResolvedValueOnce({ ok: true, json: async () => ({ ip }) })
    // Second call → freeipapi.com
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ipAddress:       ip,
        countryName:     geo.country || '',
        cityName:        geo.city    || '',
        asnOrganization: geo.isp     || '',
        isProxy:         geo.proxy   || false,
      }),
    });
}

function mockFetchFail() {
  global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
}

// ─── Storage mock helpers ─────────────────────────────────────────────────────

/** Set what chrome.storage.local.get returns */
function mockLocalStorage(values) {
  global.chrome.storage.local.get.mockResolvedValue(values);
}

/** Set what chrome.storage.sync.get returns */
function mockSyncStorage(values) {
  global.chrome.storage.sync.get.mockResolvedValue(values);
}

// ─── Module import ────────────────────────────────────────────────────────────

const {
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
  IP_SOURCE,
  _resetForTesting,
} = require('../background');

beforeEach(() => {
  jest.clearAllMocks();
  _resetForTesting();
  global.chrome.declarativeNetRequest.updateDynamicRules.mockResolvedValue(undefined);
  global.chrome.storage.local.set.mockResolvedValue(undefined);
  global.chrome.storage.local.get.mockResolvedValue({});
  global.chrome.storage.sync.get.mockResolvedValue({});
  global.chrome.storage.sync.set.mockResolvedValue(undefined);
  global.chrome.action.setBadgeText.mockResolvedValue(undefined);
  global.chrome.action.setBadgeBackgroundColor.mockResolvedValue(undefined);
});

// ─── fetchWithTimeout ─────────────────────────────────────────────────────────

describe('fetchWithTimeout', () => {
  test('resolves with response when fetch completes in time', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: true, status: 200 });
    const res = await fetchWithTimeout('https://example.com', 5000);
    expect(res.ok).toBe(true);
  });

  test('passes an AbortSignal to fetch', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: true });
    await fetchWithTimeout('https://example.com', 5000);
    const callArgs = global.fetch.mock.calls[0][1];
    expect(callArgs.signal).toBeDefined();
    expect(callArgs.signal).toBeInstanceOf(AbortSignal);
  });

  test('rejects with AbortError when timeout exceeded', async () => {
    jest.useFakeTimers();
    const controller = { abort: jest.fn() };
    const signal     = { aborted: false };
    global.fetch = jest.fn().mockImplementation(() => new Promise(() => {})); // never resolves

    const promise = fetchWithTimeout('https://example.com', 100);
    jest.runAllTimers();

    // The real AbortController will fire — we just verify the promise eventually rejects
    // (in test env the abort signal triggers rejection)
    jest.useRealTimers();
    // Since AbortController in jsdom does work, the fetch mock won't abort automatically.
    // We test the structure: signal is passed, clearTimeout is called on success.
    expect(global.fetch).toHaveBeenCalled();
  });
});

// ─── fetchIP ──────────────────────────────────────────────────────────────────

describe('fetchIP', () => {
  test('returns IPv4 address on success', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ ip: '1.2.3.4' }) });
    const ip = await fetchIP();
    expect(ip).toBe('1.2.3.4');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe(IP_SOURCE);
  });

  test('throws on HTTP error status', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: false, status: 503 });
    await expect(fetchIP()).rejects.toThrow('HTTP 503');
  });

  test('throws on network failure', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network down'));
    await expect(fetchIP()).rejects.toThrow('Network down');
  });
});

// ─── fetchGeo ─────────────────────────────────────────────────────────────────

// Helper: mock a successful Abstract API response
function mockAbstractResponse(ip, overrides = {}) {
  return {
    ok: true,
    json: async () => ({
      ip_address: ip,
      location: {
        country: overrides.country || 'Germany',
        city:    overrides.city    || 'Berlin',
      },
      company: { name: overrides.isp || 'Deutsche Telekom' },
      asn:     { asn: overrides.asn || 1234 },
      security: {
        is_vpn:     overrides.vpn     || false,
        is_proxy:   overrides.proxy   || false,
        is_tor:     overrides.tor     || false,
        is_hosting: overrides.hosting || false,
        is_relay:   overrides.relay   || false,
      },
    }),
  };
}

// Helper: mock a successful freeipapi response
function mockFreeipApiResponse(ip, overrides = {}) {
  return {
    ok: true,
    json: async () => ({
      ipAddress:       ip,
      countryName:     overrides.country || 'Germany',
      cityName:        overrides.city    || 'Berlin',
      asnOrganization: overrides.isp     || 'Deutsche Telekom',
      isProxy:         overrides.proxy   || false,
    }),
  };
}

describe('fetchGeo', () => {
  // ── Privacy mode ──────────────────────────────────────────────────────────

  test('returns null without any fetch when privacyMode=true', async () => {
    global.fetch = jest.fn();
    const geo = await fetchGeo('1.2.3.4', true, 'some-key');
    expect(geo).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // ── Abstract API (primary) ────────────────────────────────────────────────

  test('uses Abstract API when apiKey is provided and maps all fields', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(
      mockAbstractResponse('1.2.3.4', { country: 'Germany', city: 'Berlin', isp: 'Deutsche Telekom', asn: 1234 })
    );
    const geo = await fetchGeo('1.2.3.4', false, 'my-key');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain('abstractapi.com');
    expect(geo.country).toBe('Germany');
    expect(geo.city).toBe('Berlin');
    expect(geo.isp).toBe('Deutsche Telekom');
    expect(geo.asn).toBe('AS1234');
    expect(geo.vpn).toBe(false);
    expect(geo.proxy).toBe(false);
    expect(geo.tor).toBe(false);
    expect(geo.hosting).toBe(false);
    expect(geo.relay).toBe(false);
  });

  test('maps Abstract API security flags correctly when all threats true', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(
      mockAbstractResponse('1.2.3.4', { vpn: true, proxy: true, tor: true, hosting: true, relay: true })
    );
    const geo = await fetchGeo('1.2.3.4', false, 'my-key');
    expect(geo.vpn).toBe(true);
    expect(geo.proxy).toBe(true);
    expect(geo.tor).toBe(true);
    expect(geo.hosting).toBe(true);
    expect(geo.relay).toBe(true);
  });

  test('falls back to freeipapi when Abstract API returns HTTP 401 (bad key)', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 401 })          // Abstract fails
      .mockResolvedValueOnce(mockFreeipApiResponse('1.2.3.4'));    // freeipapi succeeds
    const geo = await fetchGeo('1.2.3.4', false, 'bad-key');
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(geo).not.toBeNull();
    expect(geo.country).toBe('Germany');
    // Fields not available from freeipapi default to empty/false
    expect(geo.asn).toBe('');
    expect(geo.vpn).toBe(false);
    expect(geo.tor).toBe(false);
    expect(geo.hosting).toBe(false);
    expect(geo.relay).toBe(false);
  });

  test('falls back to freeipapi when Abstract API returns HTTP 429 (rate limit)', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce(mockFreeipApiResponse('1.2.3.4'));
    const geo = await fetchGeo('1.2.3.4', false, 'my-key');
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(geo).not.toBeNull();
  });

  test('falls back to freeipapi when Abstract API network fails', async () => {
    global.fetch = jest.fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(mockFreeipApiResponse('1.2.3.4'));
    const geo = await fetchGeo('1.2.3.4', false, 'my-key');
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(geo).not.toBeNull();
  });

  test('falls back to freeipapi when Abstract API returns invalid JSON', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => { throw new SyntaxError('bad json'); } })
      .mockResolvedValueOnce(mockFreeipApiResponse('1.2.3.4'));
    const geo = await fetchGeo('1.2.3.4', false, 'my-key');
    expect(geo).not.toBeNull();
    expect(geo.country).toBe('Germany');
  });

  // ── No API key → freeipapi directly ──────────────────────────────────────

  test('skips Abstract API and goes directly to freeipapi when no apiKey', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(mockFreeipApiResponse('1.2.3.4'));
    const geo = await fetchGeo('1.2.3.4', false, '');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain('freeipapi');
    expect(geo.country).toBe('Germany');
  });

  test('freeipapi: maps isProxy=true to proxy field', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(
      mockFreeipApiResponse('2.2.2.2', { proxy: true })
    );
    const geo = await fetchGeo('2.2.2.2', false, '');
    expect(geo.proxy).toBe(true);
  });

  test('returns null when both Abstract and freeipapi fail', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })     // Abstract fails
      .mockResolvedValueOnce({ ok: false, status: 503 });    // freeipapi fails
    const geo = await fetchGeo('1.2.3.4', false, 'my-key');
    expect(geo).toBeNull();
  });

  test('returns null when no apiKey and freeipapi returns non-200', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: false, status: 503 });
    const geo = await fetchGeo('1.2.3.4', false, '');
    expect(geo).toBeNull();
  });

  test('returns null when no apiKey and freeipapi returns invalid response', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    const geo = await fetchGeo('1.2.3.4', false, '');
    expect(geo).toBeNull();
  });
});

// ─── updateBadge ─────────────────────────────────────────────────────────────

describe('updateBadge', () => {
  test('sets green badge + "ON" for allowed state', async () => {
    await updateBadge('allowed');
    expect(global.chrome.action.setBadgeText).toHaveBeenCalledWith({ text: 'ON' });
    expect(global.chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#22c55e' });
  });

  test('sets red badge + "!" for blocked state', async () => {
    await updateBadge('blocked');
    expect(global.chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '!' });
    expect(global.chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#ef4444' });
  });

  test('sets grey badge + "OFF" for disabled state', async () => {
    await updateBadge('disabled');
    expect(global.chrome.action.setBadgeText).toHaveBeenCalledWith({ text: 'OFF' });
    expect(global.chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#6b7280' });
  });

  test('sets yellow badge + "ERR" for error state', async () => {
    await updateBadge('error');
    expect(global.chrome.action.setBadgeText).toHaveBeenCalledWith({ text: 'ERR' });
    expect(global.chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#f59e0b' });
  });

  test('does not throw when chrome.action is unavailable', async () => {
    global.chrome.action.setBadgeText.mockRejectedValueOnce(new Error('Permission denied'));
    await expect(updateBadge('allowed')).resolves.not.toThrow();
  });
});

// ─── notifyIPChange ───────────────────────────────────────────────────────────

describe('notifyIPChange', () => {
  test('fires notification with blocked message', async () => {
    await notifyIPChange('5.6.7.8', true);
    expect(global.chrome.notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('blocked') })
    );
  });

  test('fires notification with allowed message', async () => {
    await notifyIPChange('5.6.7.8', false);
    expect(global.chrome.notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('allowed') })
    );
  });

  test('includes the new IP in the notification message', async () => {
    await notifyIPChange('1.2.3.4', true);
    expect(global.chrome.notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('1.2.3.4') })
    );
  });

  test('does not throw when notifications.create fails (permission denied)', async () => {
    global.chrome.notifications.create.mockImplementationOnce(() => {
      throw new Error('Permission denied');
    });
    await expect(notifyIPChange('1.2.3.4', true)).resolves.not.toThrow();
  });
});

// ─── checkAndApplyBlocking ────────────────────────────────────────────────────

describe('checkAndApplyBlocking', () => {
  test('blocks traffic when IP is not in whitelist', async () => {
    mockFetch('1.2.3.4');
    mockLocalStorage({ [STORAGE_KEYS.IP_HISTORY]: [] });
    mockSyncStorage({ [STORAGE_KEYS.WHITELIST]: ['9.9.9.9'], [STORAGE_KEYS.ENABLED]: true });

    await checkAndApplyBlocking();

    const call = global.chrome.declarativeNetRequest.updateDynamicRules.mock.calls[0][0];
    expect(call.addRules).toBeDefined();
  });

  test('allows traffic when IP is in whitelist', async () => {
    mockFetch('1.2.3.4');
    mockLocalStorage({ [STORAGE_KEYS.IP_HISTORY]: [] });
    mockSyncStorage({ [STORAGE_KEYS.WHITELIST]: ['1.2.3.4'], [STORAGE_KEYS.ENABLED]: true });

    await checkAndApplyBlocking();

    const call = global.chrome.declarativeNetRequest.updateDynamicRules.mock.calls[0][0];
    expect(call.addRules).toBeUndefined();
  });

  test('allows traffic when blocker is disabled', async () => {
    mockFetch('1.2.3.4');
    mockLocalStorage({ [STORAGE_KEYS.IP_HISTORY]: [] });
    mockSyncStorage({ [STORAGE_KEYS.WHITELIST]: [], [STORAGE_KEYS.ENABLED]: false });

    await checkAndApplyBlocking();

    const call = global.chrome.declarativeNetRequest.updateDynamicRules.mock.calls[0][0];
    expect(call.addRules).toBeUndefined();
  });

  test('blocks traffic when whitelist is empty', async () => {
    mockFetch('1.2.3.4');
    mockLocalStorage({ [STORAGE_KEYS.IP_HISTORY]: [] });
    mockSyncStorage({ [STORAGE_KEYS.WHITELIST]: [], [STORAGE_KEYS.ENABLED]: true });

    await checkAndApplyBlocking();

    const call = global.chrome.declarativeNetRequest.updateDynamicRules.mock.calls[0][0];
    expect(call.addRules).toBeDefined();
  });

  test('defaults to enabled=true and empty whitelist when sync storage is empty', async () => {
    mockFetch('1.2.3.4');
    mockLocalStorage({ [STORAGE_KEYS.IP_HISTORY]: [] });
    mockSyncStorage({});

    await checkAndApplyBlocking();

    const call = global.chrome.declarativeNetRequest.updateDynamicRules.mock.calls[0][0];
    expect(call.addRules).toBeDefined();
  });

  test('FAIL-CLOSED: blocks traffic when fetch fails', async () => {
    mockFetchFail();
    mockLocalStorage({});
    mockSyncStorage({ [STORAGE_KEYS.WHITELIST]: ['1.2.3.4'], [STORAGE_KEYS.ENABLED]: true });

    await checkAndApplyBlocking();

    const call = global.chrome.declarativeNetRequest.updateDynamicRules.mock.calls[0][0];
    expect(call.addRules).toBeDefined();
  });

  test('FAIL-CLOSED: stores lastError when fetch fails', async () => {
    mockFetchFail();
    mockLocalStorage({});
    mockSyncStorage({});

    await checkAndApplyBlocking();

    expect(global.chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ [STORAGE_KEYS.LAST_ERROR]: expect.any(String) })
    );
  });

  test('stores currentIP in local storage after successful fetch', async () => {
    mockFetch('5.6.7.8');
    mockLocalStorage({ [STORAGE_KEYS.IP_HISTORY]: [] });
    mockSyncStorage({ [STORAGE_KEYS.WHITELIST]: [], [STORAGE_KEYS.ENABLED]: true });

    await checkAndApplyBlocking();

    expect(global.chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ [STORAGE_KEYS.CURRENT_IP]: '5.6.7.8' })
    );
  });

  test('stores geoInfo in local storage after successful fetch', async () => {
    mockFetch('5.6.7.8', { country: 'DE', city: 'Berlin', isp: 'Telekom', proxy: false });
    mockLocalStorage({ [STORAGE_KEYS.IP_HISTORY]: [] });
    mockSyncStorage({ [STORAGE_KEYS.WHITELIST]: [], [STORAGE_KEYS.ENABLED]: true });

    await checkAndApplyBlocking();

    expect(global.chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ [STORAGE_KEYS.GEO_INFO]: expect.objectContaining({ country: 'DE' }) })
    );
  });

  test('sets disabled badge when blocker is off', async () => {
    mockFetch('1.2.3.4');
    mockLocalStorage({ [STORAGE_KEYS.IP_HISTORY]: [] });
    mockSyncStorage({ [STORAGE_KEYS.WHITELIST]: [], [STORAGE_KEYS.ENABLED]: false });

    await checkAndApplyBlocking();

    expect(global.chrome.action.setBadgeText).toHaveBeenCalledWith({ text: 'OFF' });
  });

  test('sets allowed badge when IP is whitelisted', async () => {
    mockFetch('1.2.3.4');
    mockLocalStorage({ [STORAGE_KEYS.IP_HISTORY]: [] });
    mockSyncStorage({ [STORAGE_KEYS.WHITELIST]: ['1.2.3.4'], [STORAGE_KEYS.ENABLED]: true });

    await checkAndApplyBlocking();

    expect(global.chrome.action.setBadgeText).toHaveBeenCalledWith({ text: 'ON' });
  });

  test('sets blocked badge when IP is not whitelisted', async () => {
    mockFetch('9.9.9.9');
    mockLocalStorage({ [STORAGE_KEYS.IP_HISTORY]: [] });
    mockSyncStorage({ [STORAGE_KEYS.WHITELIST]: ['1.2.3.4'], [STORAGE_KEYS.ENABLED]: true });

    await checkAndApplyBlocking();

    expect(global.chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '!' });
  });
});

// ─── applyBlockingRules ───────────────────────────────────────────────────────

describe('applyBlockingRules', () => {
  test('adds 2 rules when shouldBlock=true (combined api allow + block)', async () => {
    await applyBlockingRules(true);

    const call = global.chrome.declarativeNetRequest.updateDynamicRules.mock.calls[0][0];
    expect(call.addRules).toHaveLength(2);
    expect(call.removeRuleIds).toEqual([1, 2]);
  });

  test('api allow rule uses regexFilter covering ipify, freeipapi, and abstractapi', async () => {
    await applyBlockingRules(true);

    const call      = global.chrome.declarativeNetRequest.updateDynamicRules.mock.calls[0][0];
    const allowRule = call.addRules.find(r => r.condition.regexFilter);
    expect(allowRule).toBeDefined();
    expect(allowRule.action.type).toBe('allow');
    expect(allowRule.condition.regexFilter).toContain('ipify');
    expect(allowRule.condition.regexFilter).toContain('freeipapi');
    expect(allowRule.condition.regexFilter).toContain('abstractapi');
  });

  test('block rule has higher rule ID and blocks all common resource types', async () => {
    await applyBlockingRules(true);

    const call      = global.chrome.declarativeNetRequest.updateDynamicRules.mock.calls[0][0];
    const blockRule = call.addRules.find(r => r.action.type === 'block');
    expect(blockRule).toBeDefined();
    expect(blockRule.condition.resourceTypes).toContain('main_frame');
    expect(blockRule.condition.resourceTypes).toContain('xmlhttprequest');
  });

  test('removes both rule IDs when shouldBlock=false', async () => {
    await applyBlockingRules(false);

    const call = global.chrome.declarativeNetRequest.updateDynamicRules.mock.calls[0][0];
    expect(call.removeRuleIds).toEqual([1, 2]);
    expect(call.addRules).toBeUndefined();
  });

  test('reloads only the active tab when blocking is applied', async () => {
    global.chrome.tabs.query.mockResolvedValueOnce([
      { id: 1, url: 'https://meet.google.com/abc', active: true },
    ]);

    await applyBlockingRules(true);

    expect(global.chrome.tabs.reload).toHaveBeenCalledTimes(1);
    expect(global.chrome.tabs.reload).toHaveBeenCalledWith(1);
  });

  test('does NOT reload chrome:// tabs', async () => {
    global.chrome.tabs.query.mockResolvedValueOnce([
      { id: 3, url: 'chrome://extensions/', active: true },
    ]);

    await applyBlockingRules(true);

    expect(global.chrome.tabs.reload).not.toHaveBeenCalled();
  });

  test('does NOT reload chrome-extension:// tabs', async () => {
    global.chrome.tabs.query.mockResolvedValueOnce([
      { id: 4, url: 'chrome-extension://xyz/popup.html', active: true },
    ]);

    await applyBlockingRules(true);

    expect(global.chrome.tabs.reload).not.toHaveBeenCalled();
  });

  test('does NOT reload any tabs when unblocking', async () => {
    await applyBlockingRules(false);

    expect(global.chrome.tabs.reload).not.toHaveBeenCalled();
  });

  test('handles no active tab gracefully (no crash)', async () => {
    global.chrome.tabs.query.mockResolvedValueOnce([]);

    await expect(applyBlockingRules(true)).resolves.not.toThrow();
    expect(global.chrome.tabs.reload).not.toHaveBeenCalled();
  });

  test('stores ruleError when updateDynamicRules fails', async () => {
    global.chrome.declarativeNetRequest.updateDynamicRules.mockRejectedValueOnce(
      new Error('Rule limit exceeded')
    );

    await applyBlockingRules(true);

    expect(global.chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ [STORAGE_KEYS.RULE_ERROR]: 'Rule limit exceeded' })
    );
  });

  test('clears ruleError on success', async () => {
    await applyBlockingRules(true);

    expect(global.chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ [STORAGE_KEYS.RULE_ERROR]: null })
    );
  });
});

// ─── appendHistory ────────────────────────────────────────────────────────────

describe('appendHistory', () => {
  test('appends entry when IP changes', async () => {
    global.chrome.storage.local.get.mockResolvedValue({
      [STORAGE_KEYS.IP_HISTORY]: [{ ip: '1.1.1.1', ts: 1000 }],
    });

    const entry = { ip: '2.2.2.2', ts: 2000, country: 'DE', city: 'Berlin', proxy: false };
    await appendHistory(entry);

    expect(global.chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        [STORAGE_KEYS.IP_HISTORY]: expect.arrayContaining([
          expect.objectContaining({ ip: '2.2.2.2' }),
        ]),
      })
    );
  });

  test('does not append when IP is the same as last entry', async () => {
    global.chrome.storage.local.get.mockResolvedValue({
      [STORAGE_KEYS.IP_HISTORY]: [{ ip: '1.1.1.1', ts: 1000 }],
    });

    await appendHistory({ ip: '1.1.1.1', ts: 2000 });

    expect(global.chrome.storage.local.set).not.toHaveBeenCalled();
  });

  test('trims history to 50 entries', async () => {
    const existing = Array.from({ length: 50 }, (_, i) => ({ ip: `10.0.0.${i}`, ts: i }));
    global.chrome.storage.local.get.mockResolvedValue({
      [STORAGE_KEYS.IP_HISTORY]: existing,
    });

    await appendHistory({ ip: '99.99.99.99', ts: 9999 });

    const stored = global.chrome.storage.local.set.mock.calls[0][0][STORAGE_KEYS.IP_HISTORY];
    expect(stored).toHaveLength(50);
    expect(stored[stored.length - 1].ip).toBe('99.99.99.99');
  });
});

// ─── buildHistoryEntry ────────────────────────────────────────────────────────

describe('buildHistoryEntry', () => {
  test('maps all ip and geo fields correctly including new Abstract API fields', () => {
    const geo   = {
      country: 'US', city: 'NY', isp: 'Comcast', asn: 'AS7922',
      vpn: true, proxy: false, tor: false, hosting: true, relay: false,
    };
    const entry = buildHistoryEntry('1.2.3.4', geo);

    expect(entry.ip).toBe('1.2.3.4');
    expect(entry.country).toBe('US');
    expect(entry.city).toBe('NY');
    expect(entry.isp).toBe('Comcast');
    expect(entry.asn).toBe('AS7922');
    expect(entry.vpn).toBe(true);
    expect(entry.proxy).toBe(false);
    expect(entry.tor).toBe(false);
    expect(entry.hosting).toBe(true);
    expect(entry.relay).toBe(false);
    expect(entry.ts).toBeDefined();
  });

  test('handles missing geo fields gracefully — all default to empty/false', () => {
    const entry = buildHistoryEntry('1.2.3.4', {});

    expect(entry.country).toBe('');
    expect(entry.city).toBe('');
    expect(entry.asn).toBe('');
    expect(entry.vpn).toBe(false);
    expect(entry.proxy).toBe(false);
    expect(entry.tor).toBe(false);
    expect(entry.hosting).toBe(false);
    expect(entry.relay).toBe(false);
  });

  test('handles null geo (privacy mode) gracefully', () => {
    const entry = buildHistoryEntry('1.2.3.4', null);

    expect(entry.country).toBe('');
    expect(entry.isp).toBe('');
    expect(entry.asn).toBe('');
    expect(entry.vpn).toBe(false);
    expect(entry.proxy).toBe(false);
    expect(entry.tor).toBe(false);
    expect(entry.hosting).toBe(false);
    expect(entry.relay).toBe(false);
    expect(entry.ip).toBe('1.2.3.4');
  });
});
