# IP Whitelist Blocker Chrome Extension

This extension tracks your current public IP address and blocks all outgoing network requests if your IP is not in the whitelist.

## Features

- **Automatic IP tracking** — checks your public IP before every outgoing request (debounced to max once per 10s).
- **Request blocking** — uses Chrome's `declarativeNetRequest` API to block all traffic when your IP is not whitelisted.
- **Geo info** — shows country, city, and ISP for your current IP (powered by ip-api.com).
- **VPN / Proxy detection** — flags whether your current IP is a known proxy or hosting/VPN endpoint.
- **IP history** — keeps a log of every IP you've connected from, with location and VPN flags. Newest first.
- **Whitelist management** — add or remove IPs via the popup; supports one-click "add current IP" and manual entry.
- **Manual IP validation** — validates IPv4 and IPv6 format before adding; shows visual error for invalid input.
- **Kill switch** — instantly enable or disable the blocker from the popup.
- **Error visibility** — if IP detection or rule updates fail, a warning banner appears in the popup.
- **Fail-closed** — if your IP cannot be verified (network error), all traffic is blocked until the check succeeds.

## Installation

1. Clone or download this repository.
2. Open Chrome and go to `chrome://extensions/`.
3. Enable **Developer mode** (toggle in the top right corner).
4. Click **Load unpacked** and select the folder containing the extension files.

## How to Use

1. Click the extension icon in the browser toolbar.
2. Your current public IP, location, ISP, and VPN status are shown at the top.
3. Click **Add Current IP to Whitelist** to allow traffic from your current connection.
4. To add any other IP manually, type it in the input field and click **Add** (or press Enter).
5. If you switch to a different network, all requests are blocked automatically until you whitelist the new IP or disable the blocker.
6. Use the **Enable / Disable Blocker** button as a kill switch at any time.
7. The **IP History** section shows all IPs you've connected from, with timestamps and VPN flags. Click **✕** to clear.

## Architecture

```
popup.html / popup.js          — Extension UI (status, geo info, history, whitelist)
        ↕  chrome.storage.local
background.js (service worker) — IP checking, geo fetching, blocking rules
        ↕  fetch → api.ipify.org   (get current IP)
        ↕  fetch → ip-api.com      (get geo / ISP / proxy info)
        ↕  chrome.declarativeNetRequest
```

Both `api.ipify.org` and `ip-api.com` are always allowed through, even when all other traffic is blocked.

> **Note:** ip-api.com free tier requires HTTP (not HTTPS). Requests to it are allowed by the extension rules and are used only for metadata lookup — no user traffic is routed through it.

## Development

### Running tests

```bash
npm install
npm test
```

Tests use **Jest 27** with `jest-environment-jsdom`. Two test suites:

| File | What it covers |
|---|---|
| `tests/background.test.js` | IP checking, blocking rules, fail-closed, debounce, geo fetch, history append |
| `tests/popup.test.js` | IP validation, status display, geo block, VPN flags, IP history, whitelist CRUD, error banner |

### Project structure

```
├── manifest.json
├── background.js       # Service worker — IP check, geo fetch, blocking rules, history
├── popup.html          # Popup markup
├── popup.js            # Popup logic
├── styles.css          # Popup styles
├── tests/
│   ├── background.test.js
│   └── popup.test.js
└── package.json
```
