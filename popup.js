document.addEventListener('DOMContentLoaded', () => {
  const currentIpSpan = document.getElementById('current-ip');
  const statusSpan = document.getElementById('status');
  const toggleBtn = document.getElementById('toggle-enabled');
  const addCurrentBtn = document.getElementById('add-current');
  const whitelistList = document.getElementById('whitelist-list');
  const manualIpInput = document.getElementById('manual-ip');
  const addManualBtn = document.getElementById('add-manual-btn');

  function updateUI() {
    chrome.storage.local.get(['currentIP', 'whitelist', 'enabled'], (result) => {
      const currentIP = result.currentIP || 'Unknown';
      const whitelist = result.whitelist || [];
      const enabled = result.enabled !== false;

      currentIpSpan.textContent = currentIP;
      
      if (enabled === false) {
        statusSpan.textContent = 'Disabled';
        statusSpan.className = 'status-disabled';
        toggleBtn.textContent = 'Enable Blocker';
      } else if (whitelist.includes(currentIP)) {
        statusSpan.textContent = 'Allowed (Whitelisted)';
        statusSpan.className = 'status-allowed';
        toggleBtn.textContent = 'Disable Blocker';
      } else {
        statusSpan.textContent = 'Blocked';
        statusSpan.className = 'status-blocked';
        toggleBtn.textContent = 'Disable Blocker';
      }

      // Update whitelist display
      whitelistList.innerHTML = '';
      whitelist.forEach(ip => {
        const li = document.createElement('li');
        li.textContent = ip;
        const removeBtn = document.createElement('button');
        removeBtn.textContent = 'Remove';
        removeBtn.className = 'remove-btn';
        removeBtn.onclick = () => {
          const newWhitelist = whitelist.filter(item => item !== ip);
          chrome.storage.local.set({ whitelist: newWhitelist }, updateUI);
        };
        li.appendChild(removeBtn);
        whitelistList.appendChild(li);
      });
    });
  }

  toggleBtn.onclick = () => {
    chrome.storage.local.get(['enabled'], (result) => {
      const newState = result.enabled === false;
      chrome.storage.local.set({ enabled: newState }, updateUI);
    });
  };

  addCurrentBtn.onclick = () => {
    chrome.storage.local.get(['currentIP', 'whitelist'], (result) => {
      const currentIP = result.currentIP;
      const whitelist = result.whitelist || [];
      if (currentIP && !whitelist.includes(currentIP)) {
        whitelist.push(currentIP);
        chrome.storage.local.set({ whitelist }, updateUI);
      }
    });
  };

  addManualBtn.onclick = () => {
    const ip = manualIpInput.value.trim();
    if (ip) {
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
    }
  };

  updateUI();
});
