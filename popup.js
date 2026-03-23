// popup.js

// ─── IP validation ────────────────────────────────────────────────────────────

function isValidIP(ip) {
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6 = /^[0-9a-fA-F:]+$/;
  return ipv4.test(ip) || ipv6.test(ip);
}

// ─── Geo helpers ──────────────────────────────────────────────────────────────

function formatVPN(geo) {
  if (!geo) return null;
  const flags = [];
  if (geo.proxy)   flags.push('Proxy');
  if (geo.hosting) flags.push('Hosting/VPN');
  return flags.length ? { label: flags.join(', '), clean: false } : { label: 'Clean', clean: true };
}

function formatHistoryMeta(entry) {
  const date     = new Date(entry.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const location = [entry.city, entry.country].filter(Boolean).join(', ') || '—';
  return `${location} · ${date}`;
}

// ─── Empty state builders ─────────────────────────────────────────────────────

function buildWhitelistEmpty(currentIP) {
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.innerHTML = `<span class="empty-icon">🛡️</span>
    <p class="empty-text">No IPs whitelisted.<br>Add your current IP to allow traffic.</p>`;
  if (currentIP && currentIP !== 'Unknown') {
    const btn   = document.createElement('button');
    btn.className   = 'btn-inline';
    btn.textContent = `Add ${currentIP}`;
    btn.onclick     = () => btn.dispatchEvent(new CustomEvent('add-current-ip', { bubbles: true }));
    div.appendChild(btn);
  }
  return div;
}

function buildHistoryEmpty() {
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.innerHTML = `<span class="empty-icon">🕐</span>
    <p class="empty-text">Your IP history will appear here.</p>`;
  return div;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const currentIpEl    = document.getElementById('current-ip');
  const statusEl       = document.getElementById('status');
  const toggleBtn      = document.getElementById('toggle-enabled');
  const addCurrentBtn  = document.getElementById('add-current');
  const whitelistList  = document.getElementById('whitelist-list');
  const whitelistCount = document.getElementById('whitelist-count');
  const manualIpInput  = document.getElementById('manual-ip');
  const addManualBtn   = document.getElementById('add-manual-btn');
  const errorBanner    = document.getElementById('error-banner');

  const geoBox         = document.getElementById('geo-box');
  const geoLocation    = document.getElementById('geo-location');
  const geoSep         = document.getElementById('geo-sep');
  const geoIsp         = document.getElementById('geo-isp');
  const geoVpnEl       = document.getElementById('geo-vpn');

  const historyList    = document.getElementById('history-list');
  const historyCount   = document.getElementById('history-count');
  const clearHistoryBtn = document.getElementById('clear-history-btn');

  // Sync aria-expanded on <details> elements
  ['whitelist-details', 'history-details'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('toggle', () => {
      const summary = el.querySelector('summary');
      if (summary) summary.setAttribute('aria-expanded', String(el.open));
    });
  });

  // ── updateUI ────────────────────────────────────────────────────────────────

  function updateUI() {
    chrome.storage.local.get(
      ['currentIP', 'geoInfo', 'whitelist', 'enabled', 'ruleError', 'lastError', 'ipHistory'],
      (result) => {
        const currentIP = result.currentIP || 'Unknown';
        const whitelist = result.whitelist  || [];
        const enabled   = result.enabled !== false;
        const geo       = result.geoInfo    || null;
        const history   = result.ipHistory  || [];

        // ── Hero: IP ────────────────────────────────────────────────────────
        currentIpEl.textContent = currentIP;
        currentIpEl.classList.remove('skeleton');

        // ── Hero: Status badge ──────────────────────────────────────────────
        statusEl.className  = 'status-badge';
        if (!enabled) {
          statusEl.textContent = 'Disabled';
          statusEl.classList.add('disabled');
          toggleBtn.textContent = 'Enable Blocker';
          toggleBtn.classList.remove('danger');
          toggleBtn.setAttribute('aria-pressed', 'false');
        } else if (whitelist.includes(currentIP)) {
          statusEl.textContent = 'Allowed';
          statusEl.classList.add('allowed');
          toggleBtn.textContent = 'Disable Blocker';
          toggleBtn.classList.remove('danger');
          toggleBtn.setAttribute('aria-pressed', 'true');
        } else {
          statusEl.textContent = 'Blocked';
          statusEl.classList.add('blocked');
          toggleBtn.textContent = 'Disable Blocker';
          toggleBtn.classList.add('danger');
          toggleBtn.setAttribute('aria-pressed', 'true');
        }

        // ── Hero: Geo ───────────────────────────────────────────────────────
        if (geo && geo.status !== 'fail') {
          const location = [geo.city, geo.regionName, geo.country].filter(Boolean).join(', ');
          const isp      = geo.isp || '';
          const vpn      = formatVPN(geo);

          geoLocation.textContent = location;
          geoIsp.textContent      = isp;
          geoSep.style.display    = (location && isp) ? '' : 'none';

          if (vpn) {
            geoVpnEl.textContent  = vpn.clean ? '✓ Clean' : `⚠ ${vpn.label}`;
            geoVpnEl.className    = `vpn-badge ${vpn.clean ? 'clean' : 'warning'}`;
          } else {
            geoVpnEl.textContent  = '';
            geoVpnEl.className    = '';
          }
        } else {
          geoLocation.textContent = '';
          geoIsp.textContent      = '';
          geoVpnEl.textContent    = '';
          geoSep.style.display    = 'none';
        }

        // ── Error banner ────────────────────────────────────────────────────
        const errorMsg = result.ruleError || result.lastError;
        if (errorMsg) {
          errorBanner.style.display = 'block';
          errorBanner.textContent   = `⚠ ${errorMsg}`;
        } else {
          errorBanner.style.display = 'none';
        }

        // ── Whitelist ───────────────────────────────────────────────────────
        whitelistCount.textContent = whitelist.length;
        whitelistList.innerHTML    = '';

        if (whitelist.length === 0) {
          whitelistList.appendChild(buildWhitelistEmpty(currentIP));
        } else {
          whitelist.forEach(ip => {
            const li       = document.createElement('li');
            li.innerHTML   = `<span class="ip-text">${ip}</span>`;

            const removeBtn           = document.createElement('button');
            removeBtn.textContent     = 'Remove';
            removeBtn.className       = 'btn-remove';
            removeBtn.setAttribute('aria-label', `Remove ${ip} from whitelist`);
            removeBtn.onclick         = () => {
              const newList = whitelist.filter(item => item !== ip);
              chrome.storage.local.set({ whitelist: newList }, updateUI);
            };

            li.appendChild(removeBtn);
            whitelistList.appendChild(li);
          });
        }

        // ── History ─────────────────────────────────────────────────────────
        historyCount.textContent = history.length;
        historyList.innerHTML    = '';

        if (history.length === 0) {
          historyList.appendChild(buildHistoryEmpty());
        } else {
          [...history].reverse().forEach(entry => {
            const li    = document.createElement('li');
            li.className = 'history-entry';

            const ipLine = document.createElement('div');
            ipLine.className = 'history-ip';
            ipLine.innerHTML = `<span>${entry.ip}</span>`;

            if (entry.proxy || entry.hosting) {
              const badge       = document.createElement('span');
              badge.className   = 'vpn-badge warning';
              badge.textContent = [entry.proxy && 'Proxy', entry.hosting && 'VPN'].filter(Boolean).join('/');
              ipLine.appendChild(badge);
            }

            const meta       = document.createElement('div');
            meta.className   = 'history-meta';
            meta.textContent = formatHistoryMeta(entry);

            li.appendChild(ipLine);
            li.appendChild(meta);
            historyList.appendChild(li);
          });
        }
      }
    );
  }

  // ── Toggle blocker ──────────────────────────────────────────────────────────

  toggleBtn.onclick = () => {
    chrome.storage.local.get(['enabled'], (result) => {
      chrome.storage.local.set({ enabled: result.enabled === false }, updateUI);
    });
  };

  // ── Add current IP ──────────────────────────────────────────────────────────

  function addCurrentIPToWhitelist() {
    chrome.storage.local.get(['currentIP', 'whitelist'], (result) => {
      const ip        = result.currentIP;
      const whitelist = result.whitelist || [];
      if (ip && ip !== 'Unknown' && !whitelist.includes(ip)) {
        whitelist.push(ip);
        chrome.storage.local.set({ whitelist }, updateUI);
      }
    });
  }

  addCurrentBtn.onclick = addCurrentIPToWhitelist;

  // Handle "Add {ip}" button from empty state
  document.addEventListener('add-current-ip', addCurrentIPToWhitelist);

  // ── Add manual IP ───────────────────────────────────────────────────────────

  addManualBtn.onclick = () => {
    const ip = manualIpInput.value.trim();
    if (!ip) return;

    if (!isValidIP(ip)) {
      manualIpInput.classList.add('invalid');
      manualIpInput.setAttribute('aria-invalid', 'true');
      const original = manualIpInput.placeholder;
      manualIpInput.placeholder = 'Invalid IP — try again';
      setTimeout(() => {
        manualIpInput.classList.remove('invalid');
        manualIpInput.removeAttribute('aria-invalid');
        manualIpInput.placeholder = original;
      }, 2000);
      return;
    }

    chrome.storage.local.get(['whitelist'], (result) => {
      const whitelist = result.whitelist || [];
      if (!whitelist.includes(ip)) {
        whitelist.push(ip);
        chrome.storage.local.set({ whitelist }, () => {
          manualIpInput.value = '';
          updateUI();
        });
      }
    });
  };

  manualIpInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addManualBtn.click();
  });

  // ── Clear history ───────────────────────────────────────────────────────────

  clearHistoryBtn.onclick = (e) => {
    e.stopPropagation(); // don't toggle the <details>
    chrome.storage.local.set({ ipHistory: [] }, updateUI);
  };

  updateUI();
});
