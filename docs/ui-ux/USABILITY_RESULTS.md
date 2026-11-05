# Usability results

**Type of evaluation:** automated browser testing plus heuristic review  
**Not included:** moderated usability sessions, interviews, task-time measurement, or a control group  
**Date:** November 5, 2026

The results below are real test outcomes. They are not presented as human usability measurements.

## Test environment

| Item | Value |
| --- | --- |
| Web URL | `http://localhost:5173` (Vite) |
| Identity | Keycloak realm `fieldops`, six demo accounts |
| Browser | Playwright Chromium 1.57.0, desktop viewport 1440 × 1000 unless stated |
| API | Live local FieldOps services with synthetic demo data |
| Native | TypeScript and unit tests only; no emulator or device |

The Compose web container on `localhost:8088` was not used because it serves an older image. This does not affect the Vite results.

## Automated results

| Check | Result |
| --- | --- |
| Live browser scenarios (`apps/web/e2e`) | **16 / 16 passed**, 1.7 minutes, 1 worker |
| Six-role Home matrix | Passed for Technician, Dispatcher, Supervisor, Operations Manager, Analyst, Administrator |
| Role-specific context and attention panel | Passed for all six roles |
| Authorized navigation / hidden destinations | Passed for all six roles |
| Normal login lands on Home (`/`) | Passed |
| Protected deep link with query restoration | Passed (`/work-orders?status=Created` after reauthentication) |
| Unauthorized deep link | Passed: explicit permission error, no Administration heading |
| Sign-out | Passed: returns to secure entry screen |
| Responsive reflow at 320/375/768/1024/1440/1920 | Passed: no horizontal overflow |
| Mobile navigation drawer | Passed: opens, visible main navigation, closes |
| Keyboard: skip link and account menu | Passed |
| Dispatcher creates a real request and confirms a booking | Passed |
| Supervisor analytics + read-only replay | Passed |
| Supervisor reviews completed history without mutation | Passed |
| Web unit tests | **41 / 41 passed** (9 files) |
| Web typecheck / production build | Passed / passed |
| Mobile unit tests | **23 / 23 passed** |
| Mobile typecheck | Passed |
| axe WCAG A/AA + best-practice | **0 violations across 30 scans** |
| Console errors matching 403 / duplicate key / uncaught | None in the role matrix |

The production build emits a chunk-size warning: `index` 553.74 kB and Analytics 386.80 kB before gzip. The build succeeds; the warning is a performance follow-up, not a functional failure.

## Before/after journey comparison

Click counts are route transitions derived from the UI. They were not stopwatch-timed with users.

| Role | Before: sign-in → primary task | After: sign-in → primary task | Removed step |
| --- | --- | --- | --- |
| Technician | 3 | 1–2 | Generic overview and workflow search |
| Dispatcher | 3–4 | 1–2 | Re-selecting the work order on the dispatch board |
| Supervisor | 2–3 | 1–2 | Hunting for the risky workflow in a generic list |
| Manager | 2 | 1 | Choosing between overview and analytics after reading a generic page |
| Analyst | 2 | 1 | Navigating past operational metrics to reach reports |
| Administrator | 2 | 1 | Searching the flat sidebar for administration |

All six roles now land on `/` with role-specific content. Deep links still override Home when one was explicitly requested.

## Readability and visual review

- Reviewed screenshots of login, all six Homes, work orders, work-order detail, dispatch board, SLA monitoring, Analytics, replay, Administration, six responsive widths, and mobile navigation.
- Confirmed the Home greeting is the visual `h1`; section headings are `h2`.
- Confirmed 14–16 px navigation/body text and 13 px metadata on the redesigned surfaces.
- Confirmed status chips use text and colour.
- Confirmed the Analyst coverage count is right-aligned and the dispatch-board times no longer wrap.
- Confirmed tables expose pagination (“Showing 11–20 of 24”, “Page 2 of 3”).
- An earlier six-role capture recorded zero console errors and zero overflow at all tested widths; the final role matrix asserts no 403/duplicate-key/uncaught errors and no overflow.

## Heuristic findings after implementation

| Heuristic | Result |
| --- | --- |
| Visibility of system status | Live/polling/offline, SLA labels, loading, empty and error states are explicit. |
| Match to the real world | Task labels replace service names; “Dispatch board”, “My work”, “SLA monitoring”. |
| User control and freedom | Breadcrumbs, back links, cancel actions, sign-out, collapsible navigation. |
| Consistency and standards | Shared shell, page header, type scale, cards, status chips, table actions. |
| Error prevention | Required labels, disabled prerequisites explained, server rejection preserved, booking conflicts enforced. |
| Recognition over recall | Role Home exposes current work; navigation groups are persistent; filters are URL-backed. |
| Flexibility and efficiency | Home quick actions deep-link into preselected dispatch and filtered work orders. |
| Aesthetic and minimalist design | Promotional blocks removed from Home; at most three figures and three quick actions. |
| Help users recover from errors | Existing error/retry patterns retained; API errors shown in context. |
| Help and documentation | Metric definitions, SLA guidance, replay read-only explanation, locale note. |

## What improved, with evidence

1. **Role orientation:** each Home names the role, team, and responsibility. Evidence: `after-home-*.png`; six-role E2E assertions.
2. **Navigation:** grouped, role-filtered, collapsible; workspace directory; breadcrumbs. Evidence: `after-home-*.png`, deep-link test.
3. **Readability:** legacy 8–11 px operational labels replaced on the redesigned surfaces. Evidence: before/after screenshots; CSS type scale.
4. **Accessibility:** automated violations reduced from multiple serious findings to zero. Evidence: `axe-results.json`; `ACCESSIBILITY_REPORT.md`.
5. **Operational clarity:** dispatch assignment starts from the request; supervisor risk rows open the workflow; analyst areas are explicit. Evidence: journeys; live dispatcher/supervisor tests.
6. **Responsive integrity:** no page-level horizontal overflow at 320–1920 px. Evidence: E2E assertion; responsive screenshots.

## What was not measured

- Time on task, error rate, and learnability with real users.
- Satisfaction, SUS, or trust ratings.
- Screen-reader task completion.
- Native device performance, touch accuracy, or offline recovery on hardware.
- Before/after rendering performance beyond build output and page-load behaviour.

A follow-up study should recruit at least one participant per role, define representative tasks, and record completion, time, and errors under the same environment.

## Known limitations

1. **Reload requires reauthentication.** Tokens are intentionally memory-only. The deep link is preserved, but a refresh is not a seamless session restore. This is existing security behaviour.
2. **Native runtime unavailable.** No `adb`, emulator, or device. The mobile Home is implemented and typechecked, not visually verified on Android.
3. **No screen-reader or zoom run.** See `ACCESSIBILITY_REPORT.md`.
4. **Bundle size warning.** The main and Analytics chunks exceed Vite's 500 kB warning threshold.
5. **Legacy copy and density remain on some secondary surfaces.** They were not rewritten wholesale to avoid destabilizing workflows.
6. **Synthetic data.** Screenshots contain demo/E2E records; no production data was used.

## Reproduction

```bash
# Web
cd apps/web
npm run typecheck
npm test -- --run
npm run build
FIELDOPS_LIVE_E2E=1 WEB_BASE_URL=http://localhost:5173 \
  npm run test:e2e -- --workers=1 --project=chromium

# Mobile
cd ../technician-mobile
npm run typecheck
npm test
```

Demo credentials are read from the ignored root `.env`; no password is stored in this document or in the test sources.

## Evidence

- Role Homes: `evidence/after-home-{technician,dispatcher,supervisor,manager,analyst,administrator}.png`
- Login: `evidence/after-login.png`
- Workspaces: `evidence/after-work-orders.png`, `after-work-orders-page-2.png`, `after-work-order-detail.png`, `after-schedule.png`, `after-sla-monitoring.png`, `after-analytics.png`, `after-replay.png`, `after-administration.png`
- Responsive: `evidence/after-responsive-{320,375,768,1024,1440,1920}.png`
- Mobile navigation: `evidence/after-mobile-navigation.png`
- Walkthrough: `evidence/walkthrough.webm`
- Baseline: `evidence/before-*.png`
