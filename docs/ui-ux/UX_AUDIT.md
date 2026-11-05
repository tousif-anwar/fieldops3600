# UX audit

**Baseline commit:** `86c15a8`  
**Audit environment:** Chromium at 1440 x 1000, live Keycloak and API services, synthetic demo data  
**Roles reviewed:** Technician, Dispatcher, Supervisor, Operations Manager (login `manager`), Analyst, Administrator  
**Evidence:** `docs/ui-ux/evidence/before-*.png` (baseline), `after-*.png` (implemented result)

## Method

1. Signed in through the real Keycloak PKCE flow for each role.
2. Recorded the landing page, navigation, page title, and primary task path.
3. Inspected typography, empty/loading/error states, and the native technician app source.
4. Compared the implemented result with the same role and viewport.
5. Re-ran automated accessibility and browser checks after implementation.

No participant observation, interviews, or timed usability sessions were performed. Findings are heuristic and evidence-based, not claims about measured user behaviour.

## Baseline findings

| # | Finding | Evidence | Severity |
| --- | --- | --- | --- |
| 1 | Every operational role landed on the same overview headlined “A clear view of your day.” The page did not name the role or explain what that role should do next. | `before-technician.png`, `before-dispatcher.png`, `before-supervisor.png`, `before-manager.png` | High |
| 2 | Navigation was a flat list of system-shaped destinations: Overview, Work orders, Schedule, My workflow. There were no task groups, no Home, and no directory. | before screenshots; legacy `Shell` navigation | High |
| 3 | Critical labels were rendered at 8–11 px: workflow stage labels, stepper captions, booking metadata, replay labels. Some responsive rules reduced them further. | legacy `styles.css` selectors `.job-card-stage`, `.workflow-stepper`, `.booking-time`, `.read-only-tag`, `.replay-intro-line` | High |
| 4 | Operational pages carried promotional or supportive copy: “The next right action”, “A shared service standard. 30 minutes. Clear signals at every step.”, “Every action, accounted for.” | before overview screenshot | Medium |
| 5 | Pages had no breadcrumb trail. Deep pages were identified only by a heading, and the browser title stayed generic. | before screenshots; legacy shell | Medium |
| 6 | A protected deep link did not reliably survive authentication: the callback route redirected to `/`, discarding the requested path. | legacy `main.tsx` callback route; fixed in `AuthProvider` | High |
| 7 | Work-order filters were component state rather than URL state, and the list had no pagination. Filtered or paged context could not be linked, refreshed, or restored. | legacy `WorkOrders.tsx` | Medium |
| 8 | Analytics charts had no page-level heading structure and no non-visual data alternative. Metric definitions were buried. | legacy `Analytics.tsx`, `WarehousePatterns.tsx` | High (accessibility) |
| 9 | Focus styling and contrast were inconsistent; several muted labels failed contrast at their rendered size. | axe scan before corrections; legacy palette | High (accessibility) |
| 10 | The native technician app opened on a jobs list without a Home summary, greeting, or explicit current-stage/SLA context. | `apps/technician-mobile/app/(tabs)/index.tsx` before change | Medium |

## What the audit did not find

- No evidence that backend authorization was missing. Route guards and API authorization already existed and were preserved.
- No request to replace Keycloak, the API contract, workflow stages, SLA rules, scheduling, replay, exports, or offline storage.
- No basis for adding fake metrics, placeholder charts, favourites, or configuration controls the backend does not support.

## Implemented response

| Finding | Response |
| --- | --- |
| Shared generic landing | `/` is now a role-aware Home; six distinct compositions share one shell and design system. |
| Flat service-shaped navigation | Five role-filtered groups plus a workspace directory; active state, collapse, mobile drawer, breadcrumbs. |
| Tiny text | Enterprise type scale: 16 px base, 14 px navigation and controls, 13 px metadata, 24–36 px page/greeting titles. Remaining 12 px text is limited to uppercase group labels and compact status metadata. |
| Promotional copy | Removed from Home and page chrome; safety and audit copy retained where it prevents mistakes. |
| No breadcrumbs | Breadcrumbs on all workspace and detail pages; document titles update per route. |
| Lost deep links | PKCE state stores the requested path; callback waits for `AuthProvider`; guards resolve before content renders. |
| Unlinkable filters | Work-order search/status/priority are URL-backed; 10-row pagination; clear-filters action. |
| Inaccessible analytics | Page and section headings, metric definitions, accessible tablist, hidden data tables for charts. |
| Contrast/focus | Corrected palette, visible focus, native tab semantics, labeled table actions, single main-navigation landmark. |
| Mobile landing | Technician Home prioritizes current job, stage, SLA, alerts, and offline-aware context. |

## Preserved behaviour

Keycloak OIDC/PKCE, realm-role authorization, API routes and payloads, work-order lifecycle, workflow stage completion, SLA calculation, dispatch recommendation and booking, SignalR notifications, operational replay, CSV/PDF exports, React Query caching, mobile offline persistence, and server-side validation were not replaced or bypassed.

## Evidence index

- Baseline: `evidence/before-login.png`, `before-technician.png`, `before-dispatcher.png`, `before-supervisor.png`, `before-manager.png`, `before-analyst.png`, `before-administrator.png`
- Result: `evidence/after-login.png`, `after-home-*.png`, `after-work-orders.png`, `after-work-order-detail.png`, `after-schedule.png`, `after-sla-monitoring.png`, `after-analytics.png`, `after-replay.png`, `after-administration.png`
- Responsive: `evidence/after-responsive-{320,375,768,1024,1440,1920}.png`
- Interaction recording: `evidence/walkthrough.webm`

## Remaining audit gaps

- Native Android runtime was not available (`adb`/emulator absent), so the mobile audit is source- and test-based only.
- A few legacy empty-state lines remain friendly rather than operational (for example “Space to plan your day” on the dispatch board). They were not changed because they do not obscure status or block a task.
- Screen-reader output, browser zoom, and high-contrast mode were not exercised on a real assistive-technology stack.
