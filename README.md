# IP Whitelist Blocker Chrome Extension

This extension tracks your current public IP address and blocks all outgoing network requests if your IP is not in the whitelist.

## Features

- **Automatic IP tracking** — checks your public IP before every outgoing request (debounced to max once per 10s).
- **Request blocking** — uses Chrome's `declarativeNetRequest` API to block all traffic when your IP is not whitelisted.
- **Whitelist management** — add or remove IPs via the popup; supports both one-click "add current IP" and manual entry.
- **Manual IP validation** — the popup validates IPv4 and IPv6 format before adding; shows a visual error for invalid input.
- **Kill switch** — instantly enable or disable the blocker from the popup.
- **Error visibility** — if IP detection or rule updates fail, a warning banner appears in the popup so you always know the current state.
- **Fail-closed** — if your IP cannot be verified (network error), all traffic is blocked until the check succeeds.

## Installation

1. Clone or download this repository.
2. Open Chrome and go to `chrome://extensions/`.
3. Enable **Developer mode** (toggle in the top right corner).
4. Click **Load unpacked** and select the folder containing the extension files.

## How to Use

1. Click the extension icon in the browser toolbar.
2. Your current public IP is shown at the top.
3. Click **Add Current IP to Whitelist** to allow traffic from your current connection.
4. To add any other IP manually, type it in the input field and click **Add** (or press Enter). IPv4 and IPv6 are supported.
5. If you switch to a different network (new IP), all requests are blocked automatically until you whitelist the new IP or disable the blocker.
6. Use the **Enable / Disable Blocker** button as a kill switch at any time.

## Architecture

```
popup.html / popup.js          — Extension UI (whitelist management, status display)
        ↕  chrome.storage.local
background.js (service worker) — IP checking, blocking rules
        ↕  fetch → api.ipify.org
        ↕  chrome.declarativeNetRequest
```

`api.ipify.org` is always allowed through, even when all other traffic is blocked, so the extension can detect IP changes and auto-unblock when you return to a whitelisted network.

## Development

### Running tests

```bash
npm install
npm test
```

Tests use **Jest 27** with `jest-environment-jsdom`. There are two test suites:

| File | What it covers |
|---|---|
| `tests/background.test.js` | IP checking logic, blocking rules, fail-closed behaviour, debounce |
| `tests/popup.test.js` | IP validation, UI state (Blocked / Allowed / Disabled), error banner, whitelist CRUD |

### Project structure

```
├── manifest.json
├── background.js       # Service worker
├── popup.html          # Popup markup
├── popup.js            # Popup logic
├── styles.css          # Popup styles
├── tests/
│   ├── background.test.js
│   └── popup.test.js
└── package.json
```
