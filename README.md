# IP Whitelist Blocker Chrome Extension

This extension tracks your current public IP address and blocks all outgoing network requests if your IP is not in the whitelist.

## Features
- **IP Tracking**: Automatically checks your public IP every minute.
- **Request Blocking**: Uses Chrome's `declarativeNetRequest` API to block all traffic when you're on an unauthorized IP.
- **Whitelist Management**: Add or remove IPs from the whitelist via the extension popup.
- **Kill Switch**: Easily enable or disable the blocker.

## Installation
1. Download and unzip the `ip-blocker-extension.zip` file.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (toggle in the top right corner).
4. Click **Load unpacked** and select the folder containing the extension files.

## How to Use
1. Click the extension icon in your browser toolbar.
2. You will see your current public IP address.
3. Click **Whitelist Current IP** to allow traffic from your current connection.
4. If you move to a different network (different IP), the extension will automatically block all requests until you whitelist the new IP or disable the blocker.
5. You can manually add IPs to the whitelist in the popup.

## Note
The extension allows requests to `api.ipify.org` even when blocked, so it can continue to check your IP and unblock automatically if you return to a whitelisted network.
