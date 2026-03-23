// tests/popup.test.js
//
// Uses jest-environment-jsdom (set in package.json).
// popup.js reads the DOM on DOMContentLoaded, so we:
//   1. Set up the HTML fixture before each test
//   2. Re-require popup.js so listeners register against the fresh DOM
//   3. Fire DOMContentLoaded to trigger the module's init block

// ─── Chrome API mock ────────────────────────────────────────────────────────

function makeChromeMock(storageValues = {}) {
  return {
    storage: {
      local: {
        _store: { ...storageValues },
        get(keys, cb) {
          const result = {};
          keys.forEach(k => { if (k in this._store) result[k] = this._store[k]; });
          cb(result);
        },
        set(values, cb) {
          Object.assign(this._store, values);
          if (cb) cb();
        },
      },
    },
  };
}

// ─── DOM fixture ────────────────────────────────────────────────────────────

function buildDOM() {
  document.body.innerHTML = `
    <div class="container">
      <div id="error-banner" style="display:none;"></div>
      <span id="current-ip"></span>
      <span id="status"></span>
      <button id="toggle-enabled"></button>
      <button id="add-current"></button>
      <ul id="whitelist-list"></ul>
      <input id="manual-ip" placeholder="Add IP manually" />
      <button id="add-manual-btn">Add</button>
    </div>
  `;
}

// Load (and re-evaluate) popup.js against the current document
function loadPopup() {
  jest.resetModules();
  require('../popup');
  document.dispatchEvent(new Event('DOMContentLoaded'));
}

// ─── isValidIP (exported for unit testing via module trick) ─────────────────
// We test it by extracting from the module; if the project grows we can export
// it explicitly. For now, test it end-to-end via the addManualBtn interaction.

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('isValidIP — via addManualBtn interaction', () => {
  beforeEach(() => {
    buildDOM();
    global.chrome = makeChromeMock({ whitelist: [], enabled: true, currentIP: '1.2.3.4' });
    loadPopup();
  });

  const validIPs = [
    '1.2.3.4',
    '192.168.0.1',
    '0.0.0.0',
    '255.255.255.255',
    '2001:db8::1',
    '::1',
    'fe80::1',
  ];

  const invalidInputs = [
    'not-an-ip',
    'hello world',
    '<script>alert(1)</script>',
    '999.999',
    '',
  ];

  test.each(validIPs)('accepts valid IP: %s', (ip) => {
    const input = document.getElementById('manual-ip');
    const btn   = document.getElementById('add-manual-btn');
    input.value = ip;
    btn.click();

    // valid IP → added to storage (no red border)
    expect(input.style.borderColor).not.toBe('red');
    expect(global.chrome.storage.local._store.whitelist).toContain(ip);
  });

  test.each(invalidInputs)('rejects invalid input: %s', (ip) => {
    const input = document.getElementById('manual-ip');
    const btn   = document.getElementById('add-manual-btn');
    input.value = ip;
    btn.click();

    // invalid input → red border shown, NOT added to storage
    if (ip !== '') {
      expect(input.style.borderColor).toBe('red');
    }
    const stored = global.chrome.storage.local._store.whitelist || [];
    expect(stored).not.toContain(ip);
  });

  test('clears red border after 2s (setTimeout scheduled)', () => {
    jest.useFakeTimers();
    const input = document.getElementById('manual-ip');
    const btn   = document.getElementById('add-manual-btn');
    input.value = 'not-an-ip';
    btn.click();

    expect(input.style.borderColor).toBe('red');

    jest.runAllTimers();

    expect(input.style.borderColor).toBe('');
    expect(input.placeholder).toBe('Add IP manually');
    jest.useRealTimers();
  });

  test('does not add duplicate IP', () => {
    global.chrome.storage.local._store.whitelist = ['1.2.3.4'];
    const input = document.getElementById('manual-ip');
    const btn   = document.getElementById('add-manual-btn');
    input.value = '1.2.3.4';
    btn.click();

    expect(global.chrome.storage.local._store.whitelist).toHaveLength(1);
  });

  test('clears input field after successful add', () => {
    const input = document.getElementById('manual-ip');
    const btn   = document.getElementById('add-manual-btn');
    input.value = '10.0.0.1';
    btn.click();

    expect(input.value).toBe('');
  });

  test('Enter key triggers add', () => {
    const input = document.getElementById('manual-ip');
    input.value = '5.5.5.5';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(global.chrome.storage.local._store.whitelist).toContain('5.5.5.5');
  });
});

// ─── updateUI ────────────────────────────────────────────────────────────────

describe('updateUI — status display', () => {
  beforeEach(() => {
    buildDOM();
  });

  test('shows "Blocked" when IP is not in whitelist and enabled=true', () => {
    global.chrome = makeChromeMock({ currentIP: '1.2.3.4', whitelist: ['9.9.9.9'], enabled: true });
    loadPopup();

    expect(document.getElementById('status').textContent).toBe('Blocked');
    expect(document.getElementById('status').className).toBe('status-blocked');
  });

  test('shows "Allowed (Whitelisted)" when IP is in whitelist', () => {
    global.chrome = makeChromeMock({ currentIP: '1.2.3.4', whitelist: ['1.2.3.4'], enabled: true });
    loadPopup();

    expect(document.getElementById('status').textContent).toBe('Allowed (Whitelisted)');
    expect(document.getElementById('status').className).toBe('status-allowed');
  });

  test('shows "Disabled" when enabled=false regardless of whitelist', () => {
    global.chrome = makeChromeMock({ currentIP: '1.2.3.4', whitelist: ['1.2.3.4'], enabled: false });
    loadPopup();

    expect(document.getElementById('status').textContent).toBe('Disabled');
    expect(document.getElementById('toggle-enabled').textContent).toBe('Enable Blocker');
  });

  test('shows "Unknown" when currentIP is absent', () => {
    global.chrome = makeChromeMock({ whitelist: [], enabled: true });
    loadPopup();

    expect(document.getElementById('current-ip').textContent).toBe('Unknown');
  });
});

// ─── error banner (Fix 5) ────────────────────────────────────────────────────

describe('updateUI — error banner (Fix 5)', () => {
  beforeEach(() => buildDOM());

  test('shows banner when ruleError is set', () => {
    global.chrome = makeChromeMock({
      currentIP: '1.2.3.4',
      whitelist: [],
      enabled: true,
      ruleError: 'Rule limit exceeded',
    });
    loadPopup();

    const banner = document.getElementById('error-banner');
    expect(banner.style.display).toBe('block');
    expect(banner.textContent).toContain('Rule limit exceeded');
  });

  test('shows banner when lastError is set', () => {
    global.chrome = makeChromeMock({
      currentIP: '1.2.3.4',
      whitelist: [],
      enabled: true,
      lastError: 'Network error',
    });
    loadPopup();

    const banner = document.getElementById('error-banner');
    expect(banner.style.display).toBe('block');
    expect(banner.textContent).toContain('Network error');
  });

  test('prefers ruleError over lastError when both set', () => {
    global.chrome = makeChromeMock({
      ruleError: 'Rule error',
      lastError: 'Last error',
    });
    loadPopup();

    const banner = document.getElementById('error-banner');
    expect(banner.textContent).toContain('Rule error');
  });

  test('hides banner when no errors', () => {
    global.chrome = makeChromeMock({ currentIP: '1.2.3.4', whitelist: [], enabled: true });
    loadPopup();

    expect(document.getElementById('error-banner').style.display).toBe('none');
  });
});

// ─── toggleBtn ───────────────────────────────────────────────────────────────

describe('toggleBtn', () => {
  beforeEach(() => buildDOM());

  test('disables blocker when currently enabled', () => {
    global.chrome = makeChromeMock({ enabled: true, currentIP: '1.2.3.4', whitelist: [] });
    loadPopup();

    document.getElementById('toggle-enabled').click();

    expect(global.chrome.storage.local._store.enabled).toBe(false);
  });

  test('enables blocker when currently disabled', () => {
    global.chrome = makeChromeMock({ enabled: false, currentIP: '1.2.3.4', whitelist: [] });
    loadPopup();

    document.getElementById('toggle-enabled').click();

    expect(global.chrome.storage.local._store.enabled).toBe(true);
  });
});

// ─── addCurrentBtn ───────────────────────────────────────────────────────────

describe('addCurrentBtn', () => {
  beforeEach(() => buildDOM());

  test('adds currentIP to whitelist', () => {
    global.chrome = makeChromeMock({ currentIP: '7.7.7.7', whitelist: [], enabled: true });
    loadPopup();

    document.getElementById('add-current').click();

    expect(global.chrome.storage.local._store.whitelist).toContain('7.7.7.7');
  });

  test('does not add "Unknown" to whitelist', () => {
    global.chrome = makeChromeMock({ whitelist: [], enabled: true }); // no currentIP
    loadPopup();

    document.getElementById('add-current').click();

    expect(global.chrome.storage.local._store.whitelist).toHaveLength(0);
  });

  test('does not add duplicate', () => {
    global.chrome = makeChromeMock({ currentIP: '7.7.7.7', whitelist: ['7.7.7.7'], enabled: true });
    loadPopup();

    document.getElementById('add-current').click();

    expect(global.chrome.storage.local._store.whitelist).toHaveLength(1);
  });
});

// ─── whitelist remove button ──────────────────────────────────────────────────

describe('whitelist remove button', () => {
  beforeEach(() => buildDOM());

  test('removes correct IP from whitelist', () => {
    global.chrome = makeChromeMock({
      currentIP: '1.1.1.1',
      whitelist: ['1.1.1.1', '2.2.2.2'],
      enabled: true,
    });
    loadPopup();

    // Click the Remove button for the first item
    const removeBtn = document.querySelector('#whitelist-list .remove-btn');
    removeBtn.click();

    expect(global.chrome.storage.local._store.whitelist).not.toContain('1.1.1.1');
    expect(global.chrome.storage.local._store.whitelist).toContain('2.2.2.2');
  });

  test('renders one <li> per whitelisted IP', () => {
    global.chrome = makeChromeMock({
      currentIP: '1.1.1.1',
      whitelist: ['1.1.1.1', '2.2.2.2', '3.3.3.3'],
      enabled: true,
    });
    loadPopup();

    expect(document.querySelectorAll('#whitelist-list li')).toHaveLength(3);
  });
});
