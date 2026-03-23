// popup.js

// ─── Storage key constants (mirrored from background.js) ───────────────────────
// Keep in sync manually — no bundler, so we inline in each file.

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
  if (geo.tor)     flags.push('Tor');
  return flags.length
    ? { label: flags.join(', '), clean: false }
    : { label: 'Clean', clean: true };
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
    const btn       = document.createElement('button');
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

// ─── FileReader wrapped as Promise ───────────────────────────────────────────

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader    = new FileReader();
    reader.onload   = (e) => resolve(e.target.result);
    reader.onerror  = ()  => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

// ─── Storage helpers (sync + local split) ────────────────────────────────────

/**
 * Write a value to chrome.storage.sync, falling back to chrome.storage.local
 * if the sync quota is exceeded. Shows a warning banner on fallback.
 */
function syncSet(values, onQuotaFallback) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(values, () => {
      if (chrome.runtime.lastError &&
          chrome.runtime.lastError.message?.includes('QUOTA_BYTES')) {
        console.warn('[IP-Guard] Sync quota exceeded — falling back to local storage');
        chrome.storage.local.set(values, () => {
          if (onQuotaFallback) onQuotaFallback();
          resolve();
        });
      } else {
        resolve();
      }
    });
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const currentIpEl     = document.getElementById('current-ip');
  const statusEl        = document.getElementById('status');
  const toggleBtn       = document.getElementById('toggle-enabled');
  const addCurrentBtn   = document.getElementById('add-current');
  const whitelistList   = document.getElementById('whitelist-list');
  const whitelistCount  = document.getElementById('whitelist-count');
  const manualIpInput   = document.getElementById('manual-ip');
  const addManualBtn    = document.getElementById('add-manual-btn');
  const errorBanner     = document.getElementById('error-banner');
  const privacyToggle   = document.getElementById('privacy-toggle');
  const exportBtn       = document.getElementById('export-btn');
  const importInput     = document.getElementById('import-input');
  const importBtn       = document.getElementById('import-btn');

  const geoBox          = document.getElementById('geo-box');
  const geoLocation     = document.getElementById('geo-location');
  const geoSep          = document.getElementById('geo-sep');
  const geoIsp          = document.getElementById('geo-isp');
  const geoVpnEl        = document.getElementById('geo-vpn');
  const geoPrivateMsg   = document.getElementById('geo-private-msg');

  const historyList     = document.getElementById('history-list');
  const historyCount    = document.getElementById('history-count');
  const clearHistoryBtn = document.getElementById('clear-history-btn');

  // Sync aria-expanded on <details> elements
  ['whitelist-details', 'history-details', 'settings-details'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('toggle', () => {
      const summary = el.querySelector('summary');
      if (summary) summary.setAttribute('aria-expanded', String(el.open));
    });
  });

  // ── updateUI ──────────────────────────────────────────────────────────────

  function showError(msg) {
    if (!errorBanner) return;
    errorBanner.style.display = 'block';
    errorBanner.setAttribute('role', 'alert');
    errorBanner.textContent = `⚠ ${msg}`;
  }

  function hideError() {
    if (!errorBanner) return;
    errorBanner.style.display = 'none';
    errorBanner.textContent = '';
  }

  function updateUI() {
    // Read sync keys (whitelist, enabled, privacyMode)
    chrome.storage.sync.get(
      [STORAGE_KEYS.WHITELIST, STORAGE_KEYS.ENABLED, STORAGE_KEYS.PRIVACY_MODE],
      (syncResult) => {
        // Read local keys (currentIP, geoInfo, errors, history)
        chrome.storage.local.get(
          [STORAGE_KEYS.CURRENT_IP, STORAGE_KEYS.GEO_INFO, STORAGE_KEYS.RULE_ERROR, STORAGE_KEYS.LAST_ERROR, STORAGE_KEYS.IP_HISTORY],
          (localResult) => {
            const currentIP  = localResult[STORAGE_KEYS.CURRENT_IP] || 'Unknown';
            const whitelist  = syncResult[STORAGE_KEYS.WHITELIST]   || [];
            const enabled    = syncResult[STORAGE_KEYS.ENABLED]     !== false;
            const privMode   = syncResult[STORAGE_KEYS.PRIVACY_MODE] || false;
            const geo        = localResult[STORAGE_KEYS.GEO_INFO]   || null;
            const history    = localResult[STORAGE_KEYS.IP_HISTORY] || [];

            // ── Hero: IP ──────────────────────────────────────────────────
            currentIpEl.textContent = currentIP;
            currentIpEl.classList.remove('skeleton');

            // ── Hero: Status badge ────────────────────────────────────────
            statusEl.className = 'status-badge';
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

            // ── Hero: Geo ─────────────────────────────────────────────────
            if (privMode) {
              // Privacy mode: geo section shows a static message
              if (geoLocation)   geoLocation.textContent   = '';
              if (geoIsp)        geoIsp.textContent        = '';
              if (geoVpnEl)      geoVpnEl.textContent      = '';
              if (geoSep)        geoSep.style.display      = 'none';
              if (geoPrivateMsg) geoPrivateMsg.style.display = '';
            } else if (geo) {
              if (geoPrivateMsg) geoPrivateMsg.style.display = 'none';
              const location = [geo.city, geo.country].filter(Boolean).join(', ');
              const isp = geo.isp || '';
              const vpn = formatVPN(geo);

              if (geoLocation) geoLocation.textContent = location;
              if (geoIsp)      geoIsp.textContent      = isp;
              if (geoSep)      geoSep.style.display    = (location && isp) ? '' : 'none';

              if (vpn && geoVpnEl) {
                geoVpnEl.textContent = vpn.clean ? '✓ Clean' : `⚠ ${vpn.label}`;
                geoVpnEl.className   = `vpn-badge ${vpn.clean ? 'clean' : 'warning'}`;
              } else if (geoVpnEl) {
                geoVpnEl.textContent = '';
                geoVpnEl.className   = '';
              }
            } else {
              if (geoPrivateMsg) geoPrivateMsg.style.display = 'none';
              if (geoLocation)   geoLocation.textContent   = '';
              if (geoIsp)        geoIsp.textContent        = '';
              if (geoVpnEl)      geoVpnEl.textContent      = '';
              if (geoSep)        geoSep.style.display      = 'none';
            }

            // ── Privacy mode toggle state ─────────────────────────────────
            if (privacyToggle) {
              privacyToggle.checked = privMode;
              privacyToggle.setAttribute('aria-checked', String(privMode));
            }

            // ── Error banner ──────────────────────────────────────────────
            const errorMsg = localResult[STORAGE_KEYS.RULE_ERROR] || localResult[STORAGE_KEYS.LAST_ERROR];
            if (errorMsg) {
              showError(errorMsg);
            } else {
              hideError();
            }

            // ── Whitelist ─────────────────────────────────────────────────
            whitelistCount.textContent = whitelist.length;
            whitelistList.innerHTML    = '';

            if (whitelist.length === 0) {
              whitelistList.appendChild(buildWhitelistEmpty(currentIP));
            } else {
              whitelist.forEach(ip => {
                const li = document.createElement('li');
                li.innerHTML = `<span class="ip-text">${ip}</span>`;

                const removeBtn = document.createElement('button');
                removeBtn.textContent = 'Remove';
                removeBtn.className   = 'btn-remove';
                removeBtn.setAttribute('aria-label', `Remove ${ip} from whitelist`);
                removeBtn.onclick = () => {
                  const newList = whitelist.filter(item => item !== ip);
                  syncSet({ [STORAGE_KEYS.WHITELIST]: newList }, () => showError('Whitelist too large to sync — using local storage'));
                  updateUI();
                };

                li.appendChild(removeBtn);
                whitelistList.appendChild(li);
              });
            }

            // ── History ───────────────────────────────────────────────────
            historyCount.textContent = history.length;
            historyList.innerHTML    = '';

            if (history.length === 0) {
              historyList.appendChild(buildHistoryEmpty());
            } else {
              [...history].reverse().forEach(entry => {
                const li = document.createElement('li');
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
    );
  }

  // ── Toggle blocker ────────────────────────────────────────────────────────

  toggleBtn.onclick = () => {
    chrome.storage.sync.get([STORAGE_KEYS.ENABLED], (result) => {
      const newEnabled = result[STORAGE_KEYS.ENABLED] === false;
      syncSet({ [STORAGE_KEYS.ENABLED]: newEnabled }, () => showError('Sync failed — using local storage'));
      updateUI();
    });
  };

  // ── Add current IP ────────────────────────────────────────────────────────

  function addCurrentIPToWhitelist() {
    chrome.storage.local.get([STORAGE_KEYS.CURRENT_IP], (localResult) => {
      chrome.storage.sync.get([STORAGE_KEYS.WHITELIST], (syncResult) => {
        const ip        = localResult[STORAGE_KEYS.CURRENT_IP];
        const whitelist = syncResult[STORAGE_KEYS.WHITELIST] || [];
        if (ip && ip !== 'Unknown' && !whitelist.includes(ip)) {
          whitelist.push(ip);
          syncSet(
            { [STORAGE_KEYS.WHITELIST]: whitelist },
            () => showError('Whitelist too large to sync — using local storage')
          );
          updateUI();
        }
      });
    });
  }

  addCurrentBtn.onclick = addCurrentIPToWhitelist;
  document.addEventListener('add-current-ip', addCurrentIPToWhitelist);

  // ── Add manual IP ─────────────────────────────────────────────────────────

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

    chrome.storage.sync.get([STORAGE_KEYS.WHITELIST], (result) => {
      const whitelist = result[STORAGE_KEYS.WHITELIST] || [];
      if (!whitelist.includes(ip)) {
        whitelist.push(ip);
        syncSet(
          { [STORAGE_KEYS.WHITELIST]: whitelist },
          () => showError('Whitelist too large to sync — using local storage')
        );
        manualIpInput.value = '';
        updateUI();
      }
    });
  };

  manualIpInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addManualBtn.click();
  });

  // ── Privacy mode toggle ───────────────────────────────────────────────────

  if (privacyToggle) {
    privacyToggle.onchange = () => {
      const isPrivate = privacyToggle.checked;
      syncSet(
        { [STORAGE_KEYS.PRIVACY_MODE]: isPrivate },
        () => showError('Sync failed — using local storage')
      );
      updateUI();
    };
  }

  // ── Clear history ─────────────────────────────────────────────────────────

  clearHistoryBtn.onclick = (e) => {
    e.stopPropagation(); // don't toggle the <details>
    chrome.storage.local.set({ [STORAGE_KEYS.IP_HISTORY]: [] }, updateUI);
  };

  // ── Settings Export ───────────────────────────────────────────────────────

  if (exportBtn) {
    exportBtn.onclick = () => {
      chrome.storage.sync.get(
        [STORAGE_KEYS.WHITELIST, STORAGE_KEYS.ENABLED, STORAGE_KEYS.PRIVACY_MODE],
        (result) => {
          const data = {
            whitelist:   result[STORAGE_KEYS.WHITELIST]   || [],
            enabled:     result[STORAGE_KEYS.ENABLED]     !== false,
            privacyMode: result[STORAGE_KEYS.PRIVACY_MODE] || false,
            exportedAt:  new Date().toISOString(),
            version:     '1.1',
          };
          const blob    = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const url     = URL.createObjectURL(blob);
          const anchor  = document.createElement('a');
          anchor.href   = url;
          anchor.download = `ip-whitelist-backup-${Date.now()}.json`;
          anchor.click();
          URL.revokeObjectURL(url);
        }
      );
    };
  }

  // ── Settings Import ───────────────────────────────────────────────────────

  if (importBtn && importInput) {
    importBtn.onclick = () => importInput.click();

    importInput.onchange = async () => {
      const file = importInput.files[0];
      if (!file) return;
      importInput.value = ''; // reset so same file can be re-imported

      try {
        const text = await readFileAsText(file);
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          showError('Import failed: invalid JSON file');
          return;
        }

        if (!data || !Array.isArray(data.whitelist)) {
          showError('Import failed: missing or invalid "whitelist" field');
          return;
        }

        // Validate each IP in the imported list
        const validIPs = data.whitelist.filter(ip => typeof ip === 'string' && isValidIP(ip.trim()));

        await syncSet(
          {
            [STORAGE_KEYS.WHITELIST]:    validIPs,
            [STORAGE_KEYS.ENABLED]:      typeof data.enabled === 'boolean' ? data.enabled : true,
            [STORAGE_KEYS.PRIVACY_MODE]: typeof data.privacyMode === 'boolean' ? data.privacyMode : false,
          },
          () => showError('Import saved locally — sync quota exceeded')
        );

        updateUI();
      } catch (err) {
        showError(`Import failed: ${err.message}`);
      }
    };
  }

  updateUI();
});
