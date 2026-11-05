# Accessibility report

**Target:** WCAG 2.2 Level AA  
**Automated engine:** axe-core 4.10.3 in Chromium via Playwright  
**Final scan:** November 5, 2026  
**Result:** 0 violations across 30 page/role scans (1 signed-out entry screen + 29 authenticated views)

Automated zero violations are necessary but not sufficient for conformance. Screen-reader, browser-zoom, high-contrast, and native-device checks remain outstanding and are listed under limitations.

## Scope

| Role | Views scanned |
| --- | --- |
| Signed out | Secure entry screen |
| Technician | Home, Work orders, Schedule, My work, Notifications |
| Dispatcher | Home, Work orders, Schedule, Operations overview, Create work order |
| Supervisor | Home, Work orders, Workflow review, SLA monitoring, Analytics, Operational replay |
| Operations Manager | Home, Operations overview, Analytics, SLA monitoring, Operational replay |
| Analyst | Home, Analytics, All workspaces |
| Administrator | Home, Administration, Analytics, Operational replay, All workspaces |

Rules run: `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`, and axe best-practice. Results are stored in `evidence/axe-results.json`.

## Issues found and fixed

| Issue | Where | Impact | Fix | Verification |
| --- | --- | --- | --- | --- |
| `aria-hidden-focus` | Fluent `TabList` in Analytics | Serious | Replaced with a native `role="tablist"` of buttons using roving `tabIndex`, `aria-selected`, `aria-controls`, and Arrow/Home/End handling. | Axe rescan; visual tab capture |
| `empty-table-header` | Work orders actions column | Minor | Added a visually hidden “Actions” header. | Axe rescan |
| `color-contrast` | Login, shell metadata, booking cards, analytics notes, metric definitions, job-card stage labels, acknowledged notifications, replay labels, back link | Serious | Darkened muted text while preserving hierarchy; removed opacity from acknowledged notifications. | Axe rescan |
| `landmark-unique` / `region` | Application sidebar | Moderate | The sidebar is now a single `<nav aria-label="Main navigation">` containing brand, workspace, navigation groups, and footer; the inner list is a plain container. | Axe rescan |
| Tiny type | Workflow stages, stepper captions, booking metadata, replay labels | Readability | Enterprise type scale: 14 px navigation and controls, 13 px metadata, 12 px only for uppercase labels/badges. | Visual inspection; computed styles |

Contrast is carried by more than colour: every status chip contains text, and SLA states use labels such as Breached, Critical, Warning, On time, and Paused. Charts include source figures or data tables.

## Structural checks

- **Landmarks:** banner (topbar), main, contentinfo (footer), one labeled main navigation, labeled breadcrumb navigation, and labeled search form.
- **Headings:** one `h1` per page; Home uses the greeting as `h1` and panel titles as `h2`; Analytics has a page `h1` and section headings.
- **Skip link:** first focusable element, jumps to `#main`.
- **Page titles:** update to “Route · FieldOps 360”.
- **Breadcrumbs:** labeled `Breadcrumb`; current page marked with `aria-current="page"`.
- **Tables:** caption-like panel headings, column headers, labelled row actions, scroll container at narrow widths.
- **Forms:** Fluent `Field` labels, required markers, hints, inline errors, server rejection preserved.
- **Charts:** accessible data tables or source figures; chart canvases are supplementary.
- **Icons:** decorative icons use `aria-hidden`; icon-only controls have accessible names (navigation, notifications, account menu, previous/next event).

## Keyboard

Verified by the live browser suite:

- Skip link receives the first Tab and is visible on focus.
- Account menu opens with Enter and exposes “Sign out”.
- Login is usable with keyboard and at mobile size.
- Mobile navigation opens and closes through labelled buttons; Escape closes the drawer.
- Sidebar collapse control has an accessible expanded/collapsed name.

Implemented but not covered by an automated test:

- Analytics tablist ArrowRight/ArrowLeft/Home/End moves selection and focus.
- Dialogs retain the existing Fluent focus trap and Escape behaviour.

The tablist behaviour was code-reviewed, not exercised by an automated keyboard test; this is a gap, not a claim of verification.

## Zoom and reflow

Browser zoom automation was not available. The equivalent reflow risk was tested by:

- Viewport widths 320, 375, 768, 1024, 1440, and 1920 px.
- Asserting `documentElement.scrollWidth <= window.innerWidth + 1` at every width.
- Screenshots at each width (`after-responsive-*.png`).
- Stacking the Home snapshot, panels, filters, tables, and action rows at narrow widths.

At 320 px the page reflows to one column with no horizontal page overflow. Wide tables use an internal horizontal scroll container. This is a reflow proxy, not a substitute for testing 200% browser zoom.

## Touch and target size

- Sidebar navigation rows: minimum 40 px.
- Mobile drawer controls and account/notification buttons: 40–44 px.
- Native technician controls: 44 px touch targets.
- Fluent default buttons and inputs meet the WCAG 2.2 minimum 24 × 24 px target; most are larger.

## Responsive navigation

- At ≤900 px the sidebar becomes an off-canvas drawer with a scrim and labelled open/close buttons.
- The drawer closes on route change and Escape.
- Breadcrumbs and global search simplify rather than overflow.
- The technician mobile app uses native bottom tabs, not the web sidebar.

## Remaining limitations

1. **No screen-reader run.** NVDA/JAWS/VoiceOver/TalkBack were not available; accessible names and structure were checked statically and with axe.
2. **No native Android runtime.** `adb` and an emulator were unavailable. Mobile was verified by TypeScript, 23 unit tests, and source review, not on-device rendering.
3. **No browser-zoom automation.** 320 px reflow is the proxy; 125%, 150%, and 200% zoom were not separately exercised.
4. **No high-contrast or forced-colours test.**
5. **Automated coverage is partial.** axe does not validate reading order, screen-reader announcements, or every WCAG 2.2 criterion.
6. **Reduced motion** is handled in CSS (`prefers-reduced-motion`), but was not exercised in a browser with the OS setting enabled.
7. **Tablist keyboard handling** is implemented but not in the automated suite.
8. **Legacy 12 px metadata** remains in a few compact labels; it is not operational body copy.

## Reproduction

The scan was run against the Vite development server with the live Keycloak/API stack:

```bash
cd apps/web
FIELDOPS_LIVE_E2E=1 WEB_BASE_URL=http://localhost:5173 npm run test:e2e -- --workers=1 --project=chromium
```

The axe harness was a temporary Playwright script using a locally installed `axe-core`; it was removed from the repository after the final run to avoid an undeclared runtime dependency. The final machine-readable result is retained as evidence.
