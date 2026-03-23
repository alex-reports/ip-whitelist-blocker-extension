# DESIGN SYSTEM — IP Whitelist Blocker Extension

## Visual Language
Dark security tool. Feels like a terminal or VPN client — precise, trustworthy, technical.
Not a consumer app. Not a dashboard. Every pixel earns its place.

## Color Tokens

```css
--bg-base:      #0d1117   /* page background */
--bg-surface:   #161b22   /* cards, sections */
--bg-elevated:  #21262d   /* inputs, hover states */
--border:       rgba(255,255,255,0.08)
--text-primary: #e6edf3
--text-muted:   #7d8590
--text-inverse: #0d1117

--accent-blue:  #3b82f6
--status-ok:    #22c55e   /* ALLOWED */
--status-block: #ef4444   /* BLOCKED */
--status-warn:  #f59e0b   /* VPN/Proxy warning */
--status-off:   #6b7280   /* DISABLED */
```

## Typography

| Role         | Font                              | Size  | Weight |
|--------------|-----------------------------------|-------|--------|
| Hero IP      | JetBrains Mono, monospace         | 22px  | 600    |
| Section head | Inter, system-ui                  | 11px  | 600    | (uppercase, letter-spaced)
| Body         | Inter, system-ui                  | 13px  | 400    |
| Label/muted  | Inter, system-ui                  | 11px  | 400    |
| Badge text   | Inter, system-ui                  | 11px  | 600    |

## Spacing Scale (4px base grid)
4 · 8 · 12 · 16 · 24px

## Components

### StatusBadge
- Pill shape: `border-radius: 20px`, `padding: 3px 10px`
- Coloured dot (6px circle) + uppercase text
- States: ALLOWED (green), BLOCKED (red), DISABLED (gray)
- `role="status"` + `aria-live="polite"`

### Hero Block
- IP in monospace 22px, full width
- Geo line below: `city · ISP` in muted 11px
- VPN badge inline if proxy/hosting detected (amber pill)

### Buttons
- **Primary** (toggle blocker): full-width, 36px height, filled, `--accent-blue` or red when blocking
- **Secondary** (add current IP): full-width, 36px, ghost (border only)
- **Danger small** (remove IP): 28px height, `rgba(239,68,68,0.1)` bg + red text
- **Icon-only** (clear history ✕): 24×24, transparent

### CollapsibleSection
- `<details>/<summary>` pattern
- Summary: section label (uppercase 11px) + count badge + chevron icon
- Chevron rotates 90° on open (CSS transform)
- Smooth height transition: `max-height` animation

### IpListItem
- IP in monospace, left-aligned
- Remove button far right, ghost until hover
- `aria-label="Remove {ip} from whitelist"`

### EmptyState
- Whitelist: 🛡️ + "No IPs whitelisted." + inline action "Add {currentIP}"
- History: 🕐 + "Your IP history will appear here."

### ErrorBanner
- `role="alert"` + `aria-live="assertive"`
- Amber left-border style (not full red background)

## Information Hierarchy

```
Level 1 (Hero)     — IP + status badge + geo  → user knows their state in 0.5s
Level 2 (Actions)  — Primary + secondary btn  → one clear next action
Level 3 (Details)  — Whitelist + History      → collapsed by default
```

## Accessibility Checklist
- [ ] All buttons min 36px height, 44px touch target
- [ ] `toggle-enabled`: `aria-pressed` (true/false)
- [ ] Status badge: `role="status"` + `aria-live="polite"`
- [ ] Error banner: `role="alert"` + `aria-live="assertive"`
- [ ] Collapsible sections: `aria-expanded` on trigger
- [ ] Remove buttons: `aria-label="Remove {ip} from whitelist"`
- [ ] Tab order: hero → toggle → add-current → manual-input → history-clear
- [ ] Color contrast: all text pairs ≥ AA (4.5:1)
- [ ] No information conveyed by color alone (badges have text + dot)
