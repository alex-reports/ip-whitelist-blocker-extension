# IP Whitelist Blocker Chrome Extension

This extension tracks your current public IP address and blocks all outgoing network requests if your IP is not in the whitelist.

## Features

- **Automatic IP tracking** — checks your public IP on every page navigation and on a 1-minute alarm (debounced to max once per 10s).
- **Request blocking** — uses Chrome's `declarativeNetRequest` API to block all traffic when your IP is not whitelisted.
- **Geo info** — shows country, city, ISP, and ASN for your current IP.
- **VPN / Proxy / Tor / Hosting / Relay detection** — individual threat badges powered by [Abstract API](https://www.abstractapi.com/ip-geolocation-api) (requires free API key). Falls back to [freeipapi.com](https://freeipapi.com) (proxy-only detection, no key required).
- **Extension badge** — `ON` (green) / `!` (red, blocked) / `OFF` (grey) / `ERR` (yellow) visible on the toolbar icon at all times.
- **Desktop notifications** — alerts you when your IP changes and whether the new IP is allowed or blocked.
- **IP history** — keeps a log of the last 50 IPs you've connected from, with timestamps, location, and threat flags. Newest first.
- **Whitelist management** — add or remove IPs via the popup; supports one-click "add current IP" and manual entry.
- **Manual IP validation** — validates IPv4 and IPv6 format before adding; shows visual error for invalid input.
- **Kill switch** — instantly enable or disable the blocker from the popup.
- **Auto-whitelist on install** — your current IP is added automatically on first install for a smooth first-run experience.
- **Privacy mode** — disables all external geo API calls entirely. Only `api.ipify.org` is called to get your IP.
- **Settings export / import** — back up and restore your whitelist, settings, and API key as a JSON file.
- **Error visibility** — if IP detection or rule updates fail, a warning banner appears in the popup.
- **Fail-closed** — if your IP cannot be verified (network error), all traffic is blocked until the check succeeds.

## Installation

1. Clone or download this repository.
2. Open Chrome and go to `chrome://extensions/`.
3. Enable **Developer mode** (toggle in the top right corner).
4. Click **Load unpacked** and select the folder containing the extension files.

## How to Use

1. Click the extension icon in the browser toolbar.
2. Your current public IP, location, ISP/ASN, and threat flags are shown at the top.
3. Click **Add Current IP to Whitelist** to allow traffic from your current connection.
4. To add any other IP manually, type it in the input field and click **Add** (or press Enter).
5. If you switch to a different network, all requests are blocked automatically until you whitelist the new IP or disable the blocker.
6. Use the **Enable / Disable Blocker** button as a kill switch at any time.
7. The **IP History** section shows all IPs you've connected from, with timestamps and threat flags. Click **✕** to clear.
8. Open **Settings** to configure your Abstract API key, toggle Privacy mode, and export or import your settings.

## Geo & Threat Detection

The extension uses two geo sources depending on whether an API key is configured:

| Source | Requires key | Fields |
|---|---|---|
| [Abstract API](https://www.abstractapi.com/ip-geolocation-api) | Yes (free: 20k req/mo) | Country, City, ISP, ASN, VPN, Proxy, Tor, Hosting, Relay |
| [freeipapi.com](https://freeipapi.com) | No | Country, City, ISP, Proxy |

**Strategy:** Abstract API is tried first when a key is configured. On any failure (bad key, rate limit, network error) it automatically falls back to freeipapi.com. If both fail, geo is unavailable but blocking still works correctly.

To set up an Abstract API key: open the popup → **Settings** → paste your key → **Save**. Get a free key at [abstractapi.com](https://www.abstractapi.com).

## Architecture

```
popup.html / popup.js              — Extension UI (status, geo info, history, whitelist, settings)
        ↕  chrome.storage.sync     — whitelist, enabled, privacyMode, abstractApiKey
        ↕  chrome.storage.local    — currentIP, geoInfo, ipHistory, errors
background.js (service worker)     — IP checking, geo fetching, blocking rules, notifications
        ↕  fetch → api.ipify.org               (get current IPv4)
        ↕  fetch → ipgeolocation.abstractapi.com  (geo + threat detection, primary)
        ↕  fetch → freeipapi.com               (geo fallback, no key required)
        ↕  chrome.declarativeNetRequest        (block / allow rules)
        ↕  chrome.notifications               (IP change alerts)
```

API endpoints (`api.ipify.org`, `ipgeolocation.abstractapi.com`, `freeipapi.com`) are always allowed through the block rule via a `regexFilter` allow-rule, even when all other traffic is blocked.

## Development

### Running tests

```bash
npm install
npm test
```

Tests use **Jest 27** with `jest-environment-jsdom`. Two test suites:

| File | What it covers |
|---|---|
| `tests/background.test.js` | IP checking, blocking rules, fail-closed, geo fetch (Abstract API + fallback), history append, badge, notifications |
| `tests/popup.test.js` | IP validation, status display, geo block, individual threat badges, IP history, whitelist CRUD, privacy mode, export/import, API key save |

### Generating icons

```bash
npm run icons   # generates PNG icons from SVG using sharp
```

### Building a distributable zip

```bash
npm run build   # creates ip-whitelist-blocker.zip
```

### Project structure

```
├── manifest.json
├── background.js       # Service worker — IP check, geo fetch, blocking rules, history, notifications
├── popup.html          # Popup markup
├── popup.js            # Popup logic
├── styles.css          # Popup styles
├── generate-icons.js   # Icon generation script (Node + sharp)
├── tests/
│   ├── background.test.js
│   └── popup.test.js
└── package.json
```

## Changelog

### v1.2
- Add Abstract API as primary geo source (VPN, Proxy, Tor, Hosting, Relay detection)
- Add freeipapi.com as automatic fallback when Abstract fails or no key configured
- Add API key input in Settings popup (stored in `chrome.storage.sync`)
- Show individual threat badges per flag (`⚠ VPN`, `⚠ Tor`, etc.) instead of a combined label
- Show ISP + ASN combined in geo line (e.g. `Lanet Network Ltd · AS39608`)
- Add `💡 Add API key` hint when running without a key
- Remove `api64.ipify.org` (was causing IPv6 whitelist mismatch bugs)
- Settings export format updated to v1.2 (includes `apiKey` field)
- 208 tests passing

### v1.1
- Add Privacy mode — disables all external geo API calls
- Add settings export / import (JSON backup)
- Add desktop notifications on IP change
- Add extension badge (`ON` / `!` / `OFF` / `ERR`)
- Add auto-whitelist on first install
- Migrate whitelist and settings to `chrome.storage.sync`
- Switch geo source to freeipapi.com (replaced ip-api.com and ipwho.is)
- Add `webNavigation` trigger (replaced `webRequest`)

### v1.0
- Initial release
