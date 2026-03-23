// tests/popup.test.js

// ─── Chrome API mock ──────────────────────────────────────────────────────────

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
        </div>
      </div>
      <div class="actions">
        <button id="toggle-enabled" class="btn btn-primary" aria-pressed="false"></button>
        <button id="add-current" class="btn btn-secondary"></button>
      </div>
      <details class="section" id="whitelist-details">
        <summary><div class="section-title">Whitelist <span class="count-badge" id="whitelist-count">0</span></div><span class="chevron">›</span></summary>
        <div class="section-body">
          <ul class="ip-list" id="whitelist-list"></ul>
          <div class="add-manual">
            <input class="ip-input" id="manual-ip" placeholder="e.g. 192.168.1.1" />
            <button class="btn-add" id="add-manual-btn">Add</button>
          </div>
        </div>
      </details>
      <details class="section" id="history-details">
        <summary><div class="section-title">History <span class="count-badge" id="history-count">0</span></div><span class="chevron">›</span></summary>
        <div class="section-body">
          <ul class="history-list" id="history-list"></ul>
        </div>
      </details>
      <button id="clear-history-btn"></button>
    </div>
  `;
}

function loadPopup() {
  jest.resetModules();
  require('../popup');
  document.dispatchEvent(new Event('DOMContentLoaded'));
}

// ─── Shared geo fixture ───────────────────────────────────────────────────────

const GEO_CLEAN = {
  status: 'success', country: 'Germany', regionName: 'Bavaria',
  city: 'Munich', isp: 'Deutsche Telekom', proxy: false, hosting: false,
};

const GEO_VPN = {
  status: 'success', country: 'Netherlands', regionName: 'NH',
  city: 'Amsterdam', isp: 'Some VPN Ltd', proxy: true, hosting: true,
};

// ─── isValidIP ────────────────────────────────────────────────────────────────

describe('isValidIP — via addManualBtn', () => {
  beforeEach(() => {
    buildDOM();
    global.chrome = makeChromeMock({ whitelist: [], enabled: true, currentIP: '1.2.3.4' });
    loadPopup();
  });

  const validIPs = ['1.2.3.4', '192.168.0.1', '0.0.0.0', '255.255.255.255', '2001:db8::1', '::1', 'fe80::1'];
  const invalidInputs = ['not-an-ip', 'hello world', '<script>alert(1)</script>', '999.999', ''];

  test.each(validIPs)('accepts valid IP: %s', (ip) => {
    const input = document.getElementById('manual-ip');
    input.value = ip;
    document.getElementById('add-manual-btn').click();
    expect(input.style.borderColor).not.toBe('red');
    expect(global.chrome.storage.local._store.whitelist).toContain(ip);
  });

  test.each(invalidInputs)('rejects invalid input: %s', (ip) => {
    const input = document.getElementById('manual-ip');
    input.value = ip;
    document.getElementById('add-manual-btn').click();
    if (ip !== '') expect(input.classList).toContain('invalid');
    expect(global.chrome.storage.local._store.whitelist || []).not.toContain(ip);
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
    global.chrome.storage.local._store.whitelist = ['1.2.3.4'];
    const input = document.getElementById('manual-ip');
    input.value = '1.2.3.4';
    document.getElementById('add-manual-btn').click();
    expect(global.chrome.storage.local._store.whitelist).toHaveLength(1);
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
    expect(global.chrome.storage.local._store.whitelist).toContain('5.5.5.5');
  });
});

// ─── updateUI — status ────────────────────────────────────────────────────────

describe('updateUI — status display', () => {
  beforeEach(() => buildDOM());

  test('shows Blocked when IP not in whitelist', () => {
    global.chrome = makeChromeMock({ currentIP: '1.2.3.4', whitelist: ['9.9.9.9'], enabled: true });
    loadPopup();
    expect(document.getElementById('status').textContent).toBe('Blocked');
    expect(document.getElementById('status').classList).toContain('blocked');
  });

  test('shows Allowed when IP is whitelisted', () => {
    global.chrome = makeChromeMock({ currentIP: '1.2.3.4', whitelist: ['1.2.3.4'], enabled: true });
    loadPopup();
    expect(document.getElementById('status').textContent).toBe('Allowed');
    expect(document.getElementById('status').classList).toContain('allowed');
  });

  test('shows Disabled when enabled=false', () => {
    global.chrome = makeChromeMock({ currentIP: '1.2.3.4', whitelist: [], enabled: false });
    loadPopup();
    expect(document.getElementById('status').textContent).toBe('Disabled');
    expect(document.getElementById('toggle-enabled').textContent).toBe('Enable Blocker');
  });

  test('shows Unknown when currentIP absent', () => {
    global.chrome = makeChromeMock({ whitelist: [], enabled: true });
    loadPopup();
    expect(document.getElementById('current-ip').textContent).toBe('Unknown');
  });
});

// ─── updateUI — error banner ──────────────────────────────────────────────────

describe('updateUI — error banner', () => {
  beforeEach(() => buildDOM());

  test('shows banner on ruleError', () => {
    global.chrome = makeChromeMock({ ruleError: 'Rule limit exceeded' });
    loadPopup();
    const b = document.getElementById('error-banner');
    expect(b.style.display).toBe('block');
    expect(b.textContent).toContain('Rule limit exceeded');
  });

  test('shows banner on lastError', () => {
    global.chrome = makeChromeMock({ lastError: 'Network error' });
    loadPopup();
    const b = document.getElementById('error-banner');
    expect(b.style.display).toBe('block');
    expect(b.textContent).toContain('Network error');
  });

  test('hides banner when no errors', () => {
    global.chrome = makeChromeMock({ currentIP: '1.2.3.4', whitelist: [], enabled: true });
    loadPopup();
    expect(document.getElementById('error-banner').style.display).toBe('none');
  });
});

// ─── updateUI — geo info ──────────────────────────────────────────────────────

describe('updateUI — geo info block', () => {
  beforeEach(() => buildDOM());

  test('shows geo location and ISP when geoInfo present', () => {
    global.chrome = makeChromeMock({ currentIP: '1.2.3.4', whitelist: [], enabled: true, geoInfo: GEO_CLEAN });
    loadPopup();
    expect(document.getElementById('geo-location').textContent).toBe('Munich, Bavaria, Germany');
    expect(document.getElementById('geo-isp').textContent).toBe('Deutsche Telekom');
  });

  test('shows Clean VPN status for non-proxy IP', () => {
    global.chrome = makeChromeMock({ currentIP: '1.2.3.4', whitelist: [], enabled: true, geoInfo: GEO_CLEAN });
    loadPopup();
    expect(document.getElementById('geo-vpn').textContent).toContain('Clean');
    expect(document.getElementById('geo-vpn').classList).toContain('clean');
  });

  test('shows warning badge for proxy/hosting IP', () => {
    global.chrome = makeChromeMock({ currentIP: '2.2.2.2', whitelist: [], enabled: true, geoInfo: GEO_VPN });
    loadPopup();
    const vpnEl = document.getElementById('geo-vpn');
    expect(vpnEl.textContent).toContain('Proxy');
    expect(vpnEl.textContent).toContain('Hosting/VPN');
    expect(vpnEl.classList).toContain('warning');
  });

  test('clears geo when geoInfo absent', () => {
    global.chrome = makeChromeMock({ currentIP: '1.2.3.4', whitelist: [], enabled: true });
    loadPopup();
    expect(document.getElementById('geo-location').textContent).toBe('');
    expect(document.getElementById('geo-isp').textContent).toBe('');
  });

  test('clears geo when geoInfo status=fail', () => {
    global.chrome = makeChromeMock({
      currentIP: '1.2.3.4', whitelist: [], enabled: true,
      geoInfo: { status: 'fail' },
    });
    loadPopup();
    expect(document.getElementById('geo-location').textContent).toBe('');
  });
});

// ─── updateUI — IP History ────────────────────────────────────────────────────

describe('updateUI — IP history', () => {
  beforeEach(() => buildDOM());

  test('shows empty state when history is empty', () => {
    global.chrome = makeChromeMock({ ipHistory: [] });
    loadPopup();
    expect(document.getElementById('history-list').textContent).toContain('history will appear here');
  });

  test('renders one entry per history item', () => {
    const history = [
      { ip: '1.1.1.1', ts: 1000000, country: 'US', city: 'NY', isp: 'ISP', proxy: false, hosting: false },
      { ip: '2.2.2.2', ts: 2000000, country: 'DE', city: 'Berlin', isp: 'ISP2', proxy: false, hosting: false },
    ];
    global.chrome = makeChromeMock({ ipHistory: history });
    loadPopup();
    const items = document.querySelectorAll('#history-list .history-entry');
    expect(items).toHaveLength(2);
  });

  test('renders newest IP first', () => {
    const history = [
      { ip: '1.1.1.1', ts: 1000000, country: 'US', city: '', isp: '', proxy: false, hosting: false },
      { ip: '2.2.2.2', ts: 2000000, country: 'DE', city: '', isp: '', proxy: false, hosting: false },
    ];
    global.chrome = makeChromeMock({ ipHistory: history });
    loadPopup();
    const items = document.querySelectorAll('#history-list .history-entry');
    expect(items[0].textContent).toContain('2.2.2.2');
    expect(items[1].textContent).toContain('1.1.1.1');
  });

  test('shows proxy/VPN flags in history entry', () => {
    const history = [
      { ip: '3.3.3.3', ts: 1000000, country: 'NL', city: 'Amsterdam', isp: '', proxy: true, hosting: true },
    ];
    global.chrome = makeChromeMock({ ipHistory: history });
    loadPopup();
    const item = document.querySelector('#history-list .history-entry');
    expect(item.textContent).toContain('Proxy');
    expect(item.textContent).toContain('VPN');
    // VPN badge has class 'warning'
    const badge = item.querySelector('.vpn-badge.warning');
    expect(badge).not.toBeNull();
  });

  test('clear history button empties ipHistory in storage', () => {
    const history = [
      { ip: '1.1.1.1', ts: 1000000, country: 'US', city: '', isp: '', proxy: false, hosting: false },
    ];
    global.chrome = makeChromeMock({ ipHistory: history });
    loadPopup();
    document.getElementById('clear-history-btn').click();
    expect(global.chrome.storage.local._store.ipHistory).toHaveLength(0);
  });
});

// ─── toggleBtn ────────────────────────────────────────────────────────────────

describe('toggleBtn', () => {
  beforeEach(() => buildDOM());

  test('disables blocker when enabled', () => {
    global.chrome = makeChromeMock({ enabled: true, currentIP: '1.2.3.4', whitelist: [] });
    loadPopup();
    document.getElementById('toggle-enabled').click();
    expect(global.chrome.storage.local._store.enabled).toBe(false);
  });

  test('enables blocker when disabled', () => {
    global.chrome = makeChromeMock({ enabled: false, currentIP: '1.2.3.4', whitelist: [] });
    loadPopup();
    document.getElementById('toggle-enabled').click();
    expect(global.chrome.storage.local._store.enabled).toBe(true);
  });
});

// ─── addCurrentBtn ────────────────────────────────────────────────────────────

describe('addCurrentBtn', () => {
  beforeEach(() => buildDOM());

  test('adds currentIP to whitelist', () => {
    global.chrome = makeChromeMock({ currentIP: '7.7.7.7', whitelist: [], enabled: true });
    loadPopup();
    document.getElementById('add-current').click();
    expect(global.chrome.storage.local._store.whitelist).toContain('7.7.7.7');
  });

  test('does not add Unknown', () => {
    global.chrome = makeChromeMock({ whitelist: [], enabled: true });
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

// ─── Whitelist remove button ──────────────────────────────────────────────────

describe('whitelist remove button', () => {
  beforeEach(() => buildDOM());

  test('removes correct IP', () => {
    global.chrome = makeChromeMock({ currentIP: '1.1.1.1', whitelist: ['1.1.1.1', '2.2.2.2'], enabled: true });
    loadPopup();
    document.querySelector('#whitelist-list .btn-remove').click();
    expect(global.chrome.storage.local._store.whitelist).not.toContain('1.1.1.1');
    expect(global.chrome.storage.local._store.whitelist).toContain('2.2.2.2');
  });

  test('renders one li per whitelisted IP', () => {
    global.chrome = makeChromeMock({ currentIP: '1.1.1.1', whitelist: ['1.1.1.1', '2.2.2.2', '3.3.3.3'], enabled: true });
    loadPopup();
    expect(document.querySelectorAll('#whitelist-list li')).toHaveLength(3);
  });
});
