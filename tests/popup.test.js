// tests/popup.test.js

// ─── Chrome API mock ──────────────────────────────────────────────────────────

function makeChromeMock(localValues = {}, syncValues = {}) {
  return {
    runtime: { lastError: null },
    storage: {
      local: {
        _store: { ...localValues },
        get(keys, cb) {
          const result = {};
          (Array.isArray(keys) ? keys : [keys]).forEach(k => {
            if (k in this._store) result[k] = this._store[k];
          });
          cb(result);
        },
        set(values, cb) {
          Object.assign(this._store, values);
          if (cb) cb();
        },
      },
      sync: {
        _store: { ...syncValues },
        get(keys, cb) {
          const result = {};
          (Array.isArray(keys) ? keys : [keys]).forEach(k => {
            if (k in this._store) result[k] = this._store[k];
          });
          cb(result);
        },
        set(values, cb) {
          Object.assign(this._store, values);
          if (cb) cb();
        },
      },
    },
    notifications: { create: jest.fn() },
    action: {
      setBadgeText:            jest.fn(),
      setBadgeBackgroundColor: jest.fn(),
    },
  };
}

// ─── DOM fixture ──────────────────────────────────────────────────────────────

function buildDOM() {
  document.body.innerHTML = `
    <div class="container">
      <div id="error-banner"></div>
      <div class="hero">
        <div class="hero-header">
          <span id="current-ip"></span>
          <span id="status" class="status-badge"></span>
        </div>
        <div id="geo-box" class="hero-geo">
          <span id="geo-location"></span>
          <span id="geo-sep" style="display:none">·</span>
          <span id="geo-isp"></span>
          <span id="geo-vpn"></span>
          <span id="geo-private-msg" style="display:none">🔒 Geo lookup disabled</span>
        </div>
      </div>
      <div class="actions">
        <button id="toggle-enabled" class="btn btn-primary" aria-pressed="false"></button>
        <button id="add-current" class="btn btn-secondary"></button>
      </div>
      <details class="section" id="whitelist-details">
        <summary>
          <div class="section-title">Whitelist <span class="count-badge" id="whitelist-count">0</span></div>
          <span class="chevron">›</span>
        </summary>
        <div class="section-body">
          <ul class="ip-list" id="whitelist-list"></ul>
          <div class="add-manual">
            <input class="ip-input" id="manual-ip" placeholder="e.g. 192.168.1.1" />
            <button class="btn-add" id="add-manual-btn">Add</button>
          </div>
        </div>
      </details>
      <details class="section" id="history-details">
        <summary>
          <div class="section-title">History <span class="count-badge" id="history-count">0</span></div>
          <span class="chevron">›</span>
        </summary>
        <div class="section-body">
          <ul class="history-list" id="history-list"></ul>
        </div>
      </details>
      <button id="clear-history-btn"></button>
      <details class="section" id="settings-details">
        <summary><div class="section-title">Settings</div></summary>
        <div class="section-body settings-body">
          <label class="setting-row" for="privacy-toggle">
            <input type="checkbox" id="privacy-toggle" role="switch" aria-checked="false" />
          </label>
          <div class="setting-row setting-row--actions">
            <div class="setting-buttons">
              <button class="btn btn-sm" id="export-btn">Export</button>
              <button class="btn btn-sm" id="import-btn">Import</button>
              <input type="file" id="import-input" accept=".json" style="display:none" />
            </div>
          </div>
        </div>
      </details>
    </div>
  `;
}

function loadPopup() {
  jest.resetModules();
  require('../popup');
  document.dispatchEvent(new Event('DOMContentLoaded'));
}

// ─── Shared geo fixtures ──────────────────────────────────────────────────────

const GEO_CLEAN = {
  country: 'Germany', city: 'Munich', isp: 'Deutsche Telekom', proxy: false, hosting: false, tor: false,
};

const GEO_VPN = {
  country: 'Netherlands', city: 'Amsterdam', isp: 'Some VPN Ltd', proxy: true, hosting: true, tor: false,
};

// ─── isValidIP ────────────────────────────────────────────────────────────────

describe('isValidIP — via addManualBtn', () => {
  beforeEach(() => {
    buildDOM();
    global.chrome = makeChromeMock({ currentIP: '1.2.3.4' }, { whitelist: [], enabled: true });
    loadPopup();
  });

  const validIPs     = ['1.2.3.4', '192.168.0.1', '0.0.0.0', '255.255.255.255', '2001:db8::1', '::1', 'fe80::1'];
  const invalidInputs = ['not-an-ip', 'hello world', '<script>alert(1)</script>', '999.999', ''];

  test.each(validIPs)('accepts valid IP: %s', (ip) => {
    const input = document.getElementById('manual-ip');
    input.value = ip;
    document.getElementById('add-manual-btn').click();
    expect(input.style.borderColor).not.toBe('red');
    expect(global.chrome.storage.sync._store.whitelist).toContain(ip);
  });

  test.each(invalidInputs)('rejects invalid input: %s', (ip) => {
    const input = document.getElementById('manual-ip');
    input.value = ip;
    document.getElementById('add-manual-btn').click();
    if (ip !== '') expect(input.classList).toContain('invalid');
    expect(global.chrome.storage.sync._store.whitelist || []).not.toContain(ip);
  });

  test('clears invalid class after 2s', () => {
    jest.useFakeTimers();
    const input = document.getElementById('manual-ip');
    input.value = 'bad-input';
    document.getElementById('add-manual-btn').click();
    expect(input.classList).toContain('invalid');
    jest.runAllTimers();
    expect(input.classList).not.toContain('invalid');
    jest.useRealTimers();
  });

  test('does not add duplicate', () => {
    global.chrome.storage.sync._store.whitelist = ['1.2.3.4'];
    const input = document.getElementById('manual-ip');
    input.value = '1.2.3.4';
    document.getElementById('add-manual-btn').click();
    expect(global.chrome.storage.sync._store.whitelist).toHaveLength(1);
  });

  test('clears input after successful add', () => {
    const input = document.getElementById('manual-ip');
    input.value = '10.0.0.1';
    document.getElementById('add-manual-btn').click();
    expect(input.value).toBe('');
  });

  test('Enter key triggers add', () => {
    const input = document.getElementById('manual-ip');
    input.value = '5.5.5.5';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(global.chrome.storage.sync._store.whitelist).toContain('5.5.5.5');
  });
});

// ─── updateUI — status ────────────────────────────────────────────────────────

describe('updateUI — status display', () => {
  beforeEach(() => buildDOM());

  test('shows Blocked when IP not in whitelist', () => {
    global.chrome = makeChromeMock({ currentIP: '1.2.3.4' }, { whitelist: ['9.9.9.9'], enabled: true });
    loadPopup();
    expect(document.getElementById('status').textContent).toBe('Blocked');
    expect(document.getElementById('status').classList).toContain('blocked');
  });

  test('shows Allowed when IP is whitelisted', () => {
    global.chrome = makeChromeMock({ currentIP: '1.2.3.4' }, { whitelist: ['1.2.3.4'], enabled: true });
    loadPopup();
    expect(document.getElementById('status').textContent).toBe('Allowed');
    expect(document.getElementById('status').classList).toContain('allowed');
  });

  test('shows Disabled when enabled=false', () => {
    global.chrome = makeChromeMock({ currentIP: '1.2.3.4' }, { whitelist: [], enabled: false });
    loadPopup();
    expect(document.getElementById('status').textContent).toBe('Disabled');
    expect(document.getElementById('toggle-enabled').textContent).toBe('Enable Blocker');
  });

  test('shows Unknown when currentIP absent', () => {
    global.chrome = makeChromeMock({}, { whitelist: [], enabled: true });
    loadPopup();
    expect(document.getElementById('current-ip').textContent).toBe('Unknown');
  });
});

// ─── updateUI — error banner ──────────────────────────────────────────────────

describe('updateUI — error banner', () => {
  beforeEach(() => buildDOM());

  test('shows banner on ruleError', () => {
    global.chrome = makeChromeMock({ ruleError: 'Rule limit exceeded' }, {});
    loadPopup();
    const b = document.getElementById('error-banner');
    expect(b.style.display).toBe('block');
    expect(b.textContent).toContain('Rule limit exceeded');
  });

  test('shows banner on lastError', () => {
    global.chrome = makeChromeMock({ lastError: 'Network error' }, {});
    loadPopup();
    const b = document.getElementById('error-banner');
    expect(b.style.display).toBe('block');
    expect(b.textContent).toContain('Network error');
  });

  test('hides banner when no errors', () => {
    global.chrome = makeChromeMock({ currentIP: '1.2.3.4' }, { whitelist: [], enabled: true });
    loadPopup();
    expect(document.getElementById('error-banner').style.display).toBe('none');
  });
});

// ─── updateUI — geo info ──────────────────────────────────────────────────────

describe('updateUI — geo info block', () => {
  beforeEach(() => buildDOM());

  test('shows geo location and ISP when geoInfo present', () => {
    global.chrome = makeChromeMock(
      { currentIP: '1.2.3.4', geoInfo: GEO_CLEAN },
      { whitelist: [], enabled: true }
    );
    loadPopup();
    expect(document.getElementById('geo-location').textContent).toBe('Munich, Germany');
    expect(document.getElementById('geo-isp').textContent).toBe('Deutsche Telekom');
  });

  test('shows Clean VPN status for non-proxy IP', () => {
    global.chrome = makeChromeMock(
      { currentIP: '1.2.3.4', geoInfo: GEO_CLEAN },
      { whitelist: [], enabled: true }
    );
    loadPopup();
    expect(document.getElementById('geo-vpn').textContent).toContain('Clean');
    expect(document.getElementById('geo-vpn').classList).toContain('clean');
  });

  test('shows warning badge for proxy/hosting IP', () => {
    global.chrome = makeChromeMock(
      { currentIP: '2.2.2.2', geoInfo: GEO_VPN },
      { whitelist: [], enabled: true }
    );
    loadPopup();
    const vpnEl = document.getElementById('geo-vpn');
    expect(vpnEl.textContent).toContain('Proxy');
    expect(vpnEl.textContent).toContain('Hosting/VPN');
    expect(vpnEl.classList).toContain('warning');
  });

  test('clears geo when geoInfo absent', () => {
    global.chrome = makeChromeMock({ currentIP: '1.2.3.4' }, { whitelist: [], enabled: true });
    loadPopup();
    expect(document.getElementById('geo-location').textContent).toBe('');
    expect(document.getElementById('geo-isp').textContent).toBe('');
  });

  test('shows "Geo lookup disabled" when privacyMode=true', () => {
    global.chrome = makeChromeMock(
      { currentIP: '1.2.3.4' },
      { whitelist: [], enabled: true, privacyMode: true }
    );
    loadPopup();
    const msg = document.getElementById('geo-private-msg');
    expect(msg.style.display).not.toBe('none');
  });

  test('hides "Geo lookup disabled" when privacyMode=false', () => {
    global.chrome = makeChromeMock(
      { currentIP: '1.2.3.4', geoInfo: GEO_CLEAN },
      { whitelist: [], enabled: true, privacyMode: false }
    );
    loadPopup();
    const msg = document.getElementById('geo-private-msg');
    expect(msg.style.display).toBe('none');
  });
});

// ─── updateUI — IP History ────────────────────────────────────────────────────

describe('updateUI — IP history', () => {
  beforeEach(() => buildDOM());

  test('shows empty state when history is empty', () => {
    global.chrome = makeChromeMock({ ipHistory: [] }, {});
    loadPopup();
    expect(document.getElementById('history-list').textContent).toContain('history will appear here');
  });

  test('renders one entry per history item', () => {
    const history = [
      { ip: '1.1.1.1', ts: 1000000, country: 'US', city: 'NY', isp: 'ISP', proxy: false, hosting: false },
      { ip: '2.2.2.2', ts: 2000000, country: 'DE', city: 'Berlin', isp: 'ISP2', proxy: false, hosting: false },
    ];
    global.chrome = makeChromeMock({ ipHistory: history }, {});
    loadPopup();
    const items = document.querySelectorAll('#history-list .history-entry');
    expect(items).toHaveLength(2);
  });

  test('renders newest IP first', () => {
    const history = [
      { ip: '1.1.1.1', ts: 1000000, country: 'US', city: '', isp: '', proxy: false, hosting: false },
      { ip: '2.2.2.2', ts: 2000000, country: 'DE', city: '', isp: '', proxy: false, hosting: false },
    ];
    global.chrome = makeChromeMock({ ipHistory: history }, {});
    loadPopup();
    const items = document.querySelectorAll('#history-list .history-entry');
    expect(items[0].textContent).toContain('2.2.2.2');
    expect(items[1].textContent).toContain('1.1.1.1');
  });

  test('shows proxy/VPN flags in history entry', () => {
    const history = [
      { ip: '3.3.3.3', ts: 1000000, country: 'NL', city: 'Amsterdam', isp: '', proxy: true, hosting: true },
    ];
    global.chrome = makeChromeMock({ ipHistory: history }, {});
    loadPopup();
    const item  = document.querySelector('#history-list .history-entry');
    expect(item.textContent).toContain('Proxy');
    expect(item.textContent).toContain('VPN');
    const badge = item.querySelector('.vpn-badge.warning');
    expect(badge).not.toBeNull();
  });

  test('clear history button empties ipHistory in local storage', () => {
    const history = [
      { ip: '1.1.1.1', ts: 1000000, country: 'US', city: '', isp: '', proxy: false, hosting: false },
    ];
    global.chrome = makeChromeMock({ ipHistory: history }, {});
    loadPopup();
    document.getElementById('clear-history-btn').click();
    expect(global.chrome.storage.local._store.ipHistory).toHaveLength(0);
  });
});

// ─── toggleBtn ────────────────────────────────────────────────────────────────

describe('toggleBtn', () => {
  beforeEach(() => buildDOM());

  test('disables blocker when enabled', () => {
    global.chrome = makeChromeMock({ currentIP: '1.2.3.4' }, { enabled: true, whitelist: [] });
    loadPopup();
    document.getElementById('toggle-enabled').click();
    expect(global.chrome.storage.sync._store.enabled).toBe(false);
  });

  test('enables blocker when disabled', () => {
    global.chrome = makeChromeMock({ currentIP: '1.2.3.4' }, { enabled: false, whitelist: [] });
    loadPopup();
    document.getElementById('toggle-enabled').click();
    expect(global.chrome.storage.sync._store.enabled).toBe(true);
  });
});

// ─── addCurrentBtn ────────────────────────────────────────────────────────────

describe('addCurrentBtn', () => {
  beforeEach(() => buildDOM());

  test('adds currentIP to sync whitelist', () => {
    global.chrome = makeChromeMock({ currentIP: '7.7.7.7' }, { whitelist: [], enabled: true });
    loadPopup();
    document.getElementById('add-current').click();
    expect(global.chrome.storage.sync._store.whitelist).toContain('7.7.7.7');
  });

  test('does not add Unknown', () => {
    global.chrome = makeChromeMock({}, { whitelist: [], enabled: true });
    loadPopup();
    document.getElementById('add-current').click();
    expect(global.chrome.storage.sync._store.whitelist || []).toHaveLength(0);
  });

  test('does not add duplicate', () => {
    global.chrome = makeChromeMock({ currentIP: '7.7.7.7' }, { whitelist: ['7.7.7.7'], enabled: true });
    loadPopup();
    document.getElementById('add-current').click();
    expect(global.chrome.storage.sync._store.whitelist).toHaveLength(1);
  });
});

// ─── whitelist remove button ──────────────────────────────────────────────────

describe('whitelist remove button', () => {
  beforeEach(() => buildDOM());

  test('removes correct IP from sync whitelist', () => {
    global.chrome = makeChromeMock({ currentIP: '1.1.1.1' }, { whitelist: ['1.1.1.1', '2.2.2.2'], enabled: true });
    loadPopup();
    document.querySelector('#whitelist-list .btn-remove').click();
    expect(global.chrome.storage.sync._store.whitelist).not.toContain('1.1.1.1');
    expect(global.chrome.storage.sync._store.whitelist).toContain('2.2.2.2');
  });

  test('renders one li per whitelisted IP', () => {
    global.chrome = makeChromeMock({ currentIP: '1.1.1.1' }, { whitelist: ['1.1.1.1', '2.2.2.2', '3.3.3.3'], enabled: true });
    loadPopup();
    expect(document.querySelectorAll('#whitelist-list li')).toHaveLength(3);
  });
});

// ─── Privacy mode toggle ──────────────────────────────────────────────────────

describe('privacy mode toggle', () => {
  beforeEach(() => buildDOM());

  test('clicking toggle saves privacyMode=true to sync storage', () => {
    global.chrome = makeChromeMock({ currentIP: '1.2.3.4' }, { whitelist: [], enabled: true, privacyMode: false });
    loadPopup();
    const toggle = document.getElementById('privacy-toggle');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    expect(global.chrome.storage.sync._store.privacyMode).toBe(true);
  });

  test('clicking toggle saves privacyMode=false when unchecking', () => {
    global.chrome = makeChromeMock({ currentIP: '1.2.3.4' }, { whitelist: [], enabled: true, privacyMode: true });
    loadPopup();
    const toggle = document.getElementById('privacy-toggle');
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    expect(global.chrome.storage.sync._store.privacyMode).toBe(false);
  });

  test('toggle reflects current privacyMode=true state in UI', () => {
    global.chrome = makeChromeMock({ currentIP: '1.2.3.4' }, { whitelist: [], enabled: true, privacyMode: true });
    loadPopup();
    expect(document.getElementById('privacy-toggle').checked).toBe(true);
  });

  test('toggle reflects current privacyMode=false state in UI', () => {
    global.chrome = makeChromeMock({ currentIP: '1.2.3.4' }, { whitelist: [], enabled: true, privacyMode: false });
    loadPopup();
    expect(document.getElementById('privacy-toggle').checked).toBe(false);
  });
});

// ─── Settings export ──────────────────────────────────────────────────────────

describe('settings export', () => {
  beforeEach(() => buildDOM());

  // Mock URL and Blob APIs (not available in jsdom by default)
  beforeEach(() => {
    global.URL.createObjectURL = jest.fn().mockReturnValue('blob:mock');
    global.URL.revokeObjectURL = jest.fn();
  });

  test('export triggers URL.createObjectURL (initiates download)', () => {
    global.chrome = makeChromeMock({}, { whitelist: ['1.2.3.4'], enabled: true, privacyMode: false });
    loadPopup();

    // Intercept anchor click
    const origCreate = document.createElement.bind(document);
    let anchorClicked = false;
    jest.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = origCreate(tag);
      if (tag === 'a') el.click = () => { anchorClicked = true; };
      return el;
    });

    document.getElementById('export-btn').click();
    expect(global.URL.createObjectURL).toHaveBeenCalled();
    document.createElement.mockRestore();
  });

  test('export with empty whitelist still produces valid call', () => {
    global.chrome = makeChromeMock({}, { whitelist: [], enabled: true, privacyMode: false });
    loadPopup();

    const origCreate = document.createElement.bind(document);
    jest.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = origCreate(tag);
      if (tag === 'a') el.click = jest.fn();
      return el;
    });

    expect(() => document.getElementById('export-btn').click()).not.toThrow();
    document.createElement.mockRestore();
  });
});

// ─── Settings import ──────────────────────────────────────────────────────────

describe('settings import', () => {
  beforeEach(() => buildDOM());

  function makeFileWithContent(content) {
    return new File([content], 'backup.json', { type: 'application/json' });
  }

  test('import with valid JSON updates sync storage', async () => {
    global.chrome = makeChromeMock({}, { whitelist: [], enabled: true });
    loadPopup();

    const input  = document.getElementById('import-input');
    const data   = JSON.stringify({ whitelist: ['9.9.9.9'], enabled: false, privacyMode: true });
    const file   = makeFileWithContent(data);

    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));

    // Allow FileReader to complete
    await new Promise(r => setTimeout(r, 50));

    expect(global.chrome.storage.sync._store.whitelist).toContain('9.9.9.9');
    expect(global.chrome.storage.sync._store.enabled).toBe(false);
    expect(global.chrome.storage.sync._store.privacyMode).toBe(true);
  });

  test('import with invalid JSON shows error banner', async () => {
    global.chrome = makeChromeMock({}, {});
    loadPopup();

    const input = document.getElementById('import-input');
    const file  = makeFileWithContent('{ this is not: valid json }');

    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));

    await new Promise(r => setTimeout(r, 50));

    expect(document.getElementById('error-banner').style.display).toBe('block');
    expect(document.getElementById('error-banner').textContent).toContain('invalid JSON');
  });

  test('import with missing whitelist key shows error banner', async () => {
    global.chrome = makeChromeMock({}, {});
    loadPopup();

    const input = document.getElementById('import-input');
    const file  = makeFileWithContent(JSON.stringify({ enabled: true }));

    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));

    await new Promise(r => setTimeout(r, 50));

    expect(document.getElementById('error-banner').style.display).toBe('block');
    expect(document.getElementById('error-banner').textContent).toContain('whitelist');
  });

  test('import filters out invalid IPs from whitelist', async () => {
    global.chrome = makeChromeMock({}, { whitelist: [] });
    loadPopup();

    const input = document.getElementById('import-input');
    const data  = JSON.stringify({ whitelist: ['1.2.3.4', 'not-an-ip', '5.6.7.8'] });
    const file  = makeFileWithContent(data);

    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));

    await new Promise(r => setTimeout(r, 50));

    const stored = global.chrome.storage.sync._store.whitelist;
    expect(stored).toContain('1.2.3.4');
    expect(stored).toContain('5.6.7.8');
    expect(stored).not.toContain('not-an-ip');
  });
});
