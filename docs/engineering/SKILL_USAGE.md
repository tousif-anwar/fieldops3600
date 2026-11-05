# Agent skill usage and verification

Date: 2026-11-05
Repository: FieldOps 360
Scope: mandatory skill pass covering repository discovery, browser testing, web accessibility/visual review, performance baseline, architecture review and native Android inspection.

This is an execution record, not a checklist claim. A skill is listed as applied only after its instructions were read and its recommendations were checked against this repository. Unavailable and inapplicable skills are recorded separately.

## find-skills

- **Task:** Discover additional accessibility or testing capabilities before changing the UI.
- **Findings:** The search surfaced community accessibility packs such as `addyosmani/web-quality-skills@accessibility`, `jakubkrehel/skills@better-accessibility` and `ibelick/ui-skills@fixing-accessibility`. None was installed. The repository already has a focused review skill (`web-design-guidelines`) plus a live Playwright suite; adding overlapping community code without a provenance and maintenance review was not justified.
- **Changes:** None.
- **Verification:** Search results reviewed; no installation performed.
- **Limitations:** This was discovery only. No third-party skill was evaluated in depth or installed.

## agent-browser

- **Task:** Real browser login, dashboard, form and responsive testing.
- **Availability:** The `agent-browser` skill is installed, but its CLI is not available on this host (`command not found`). I did not install a global browser tool. The repository's existing Playwright dependency was used instead.
- **Relevant files:** `apps/web/playwright.config.ts`, `apps/web/e2e/login.spec.ts`, `apps/web/e2e/operations.spec.ts`.
- **Findings:**
  - The first run failed all 10 tests because Playwright's Chromium binary was missing; the application itself had not failed.
  - After `npx playwright install chromium`, the real Keycloak PKCE login, dispatcher request/booking, supervisor analytics and replay flows passed at desktop and Pixel 7 viewports.
  - A repeat run exposed a test-data issue rather than a UI regression: the booking test always used tomorrow at 15:00 UTC, and repeated synthetic runs had filled every qualified technician for that slot.
- **Changes:** `apps/web/e2e/operations.spec.ts` now scans up to five business-day slots and selects the first one with a recommended technician. This preserves the real booking assertion and makes local reruns repeatable.
- **Verification:** `npx playwright test --workers=1` passed **10/10** in 34.9 s after the fix (Chromium and mobile Chrome projects).
- **Limitations:** This is Playwright, not `agent-browser`; no agent-browser-specific tracing, video or exploratory session was used. The suite covers the tested flows, not every route or state.

## web-design-guidelines

- **Task:** Audit navigation, forms, focus visibility, loading/error states, accessibility and responsive behavior after the main screens were implemented.
- **Relevant files:** `apps/web/src/components/Shell.tsx`, `apps/web/src/components/common.tsx`, `apps/web/src/components/OrderEditor.tsx`, `apps/web/src/components/BookingEditor.tsx`, `apps/web/src/pages/Workflow.tsx`, `apps/web/src/pages/Analytics.tsx`, `apps/web/src/pages/Replay.tsx`, `apps/web/src/styles.css`.
- **Findings:**
  - Two search inputs suppressed the browser focus outline (`.global-search input`, `.search-field input`) without a sufficiently clear replacement.
  - Three dialogs forced focus into an input with `autoFocus`, which is undesirable on mobile viewports because it can open the keyboard and obscure the form.
  - The code already uses `role="alert"`/`role="status"`, `aria-label` on icon-only controls, a skip link, a reduced-motion media query and visible global focus styles. The all-caps eyebrow labels are an intentional part of the existing visual identity and were not treated as a defect.
- **Changes:**
  - Removed both `outline: none` declarations.
  - Added a visible `:focus-within` border to the list search field.
  - Removed `autoFocus` from the order editor, booking editor and workflow action dialog.
- **Verification:** Web unit/component tests **33/33**, `tsc -b --pretty false` exit 0, production build exit 0, `format:check` exit 0, and browser E2E **10/10**.
- **Limitations:** No axe-core scan, manual screen-reader pass or complete WCAG 2.2 AA audit was performed. Contrasts were not measured with a dedicated tool.

## frontend-design

- **Task:** Review the visual identity and information hierarchy of the operations dashboards.
- **Findings:** The existing Fluent UI system already has a deliberate enterprise identity: restrained blue/neutral palette, clear page hierarchy, visible primary actions and consistent surface treatment. A template rewrite or competing component system would add risk without improving the brief.
- **Changes:** None.
- **Verification:** Source/CSS review plus the live browser flows above; production build and E2E pass.
- **Limitations:** This was a focused review, not a pixel-level visual regression or user-research study.

## high-end-visual-design

- **Task:** Final polish review of the supervisor, analytics and replay surfaces.
- **Findings:** Spacing, alignment, surface depth and typography are already restrained and consistent. I did not add decorative animation, gradients or extra chrome; those would conflict with the operational, accessibility-first brief. No high-confidence polish change was justified after the focus fixes.
- **Changes:** None.
- **Verification:** Build, component tests and live desktop/mobile browser flows pass.
- **Limitations:** No dedicated visual snapshot comparison was run. The assessment is based on source inspection and exercised screens.

## performance-optimization

- **Task:** Establish a reproducible baseline before changing performance-sensitive code.
- **Measurements (2026-11-05):**
  - Gateway readiness (`http://localhost:5100/health/ready`): HTTP 200, three samples **5.9–15.6 ms**.
  - Web entry (`http://localhost:8088`): HTTP 200, three samples **2.8–5.9 ms**.
  - Production bundle: **750 KB** across 23 assets; main chunk **529.37 KB** (gzip **157.06 KB**); Analytics route chunk **429.70 KB** (gzip **127.10 KB**). Vite reports a >500 KB chunk warning.
- **Findings:** No user-facing latency bottleneck was measured. Routes are already lazy-loaded; the main chunk warning is a size warning, not proof of a regression. Changing caching or chunking without a measured target would add risk and could introduce staleness.
- **Changes:** None.
- **Verification:** Timings above and `npm run build`; the build completed successfully with the size warning retained in the report.
- **Limitations:** Three samples are a smoke baseline, not p95 or a load test. No Lighthouse/Core Web Vitals or warehouse query benchmark was run. The 529 KB warning remains.

## improve-codebase-architecture

- **Task:** Apply a focused boundary and deletion-test review after establishing the test baseline.
- **Findings:** The repository keeps six .NET service hosts, a gateway, analytics/warehouse code and the web client separated. In the web client, the shared primitives in `common.tsx` earn their place: removing them would duplicate page headers, loading/error/empty states and status formatting across routes. The `Administrator`-only path of `auth.can` was checked specifically; an empty allowed-role list does not open the Administration route to ordinary users. No high-confidence module deepening or boundary rewrite was justified.
- **Changes:** None. No ADR was required because no architectural decision changed.
- **Verification:** Reviewed `auth.tsx`, `main.tsx` and `common.tsx`; the role-scoped browser tests pass for dispatcher and supervisor. Prior backend/gateway evidence is 54/54 and 7/7; those suites were not rerun in this skill pass.
- **Limitations:** This was a deliberate focused review, not the full HTML candidate report or a backend-wide dependency/coupling audit. No large rewrite was attempted.

## design-mobile-apps

- **Availability:** The skill requires `SLEEK_API_KEY`; that credential is not available on this host, so the skill was **not** used and is not claimed as executed.
- **Alternative:** The existing Expo application was inspected through the Android emulator and ADB on `emulator-5556`.
- **Actual native evidence:**
  - Authenticated **My jobs** dashboard loaded as Jordan Rivera.
  - Opened synthetic job `WO-20261105-FB162B`; job details showed the address, HVAC status and the **Start guided service** action.
  - Started the guided service. The app moved to stage **1/8, Job Accepted, Active**, with a server-backed SLA countdown.
  - The stage form rendered **Assignment** and **Readiness** dropdowns, the assistance guidance, and **Submit & continue**. Screenshot: `.local/native-guided-stage.png` (ignored local evidence).
- **Changes:** None.
- **Verification:** ADB screenshots and UI hierarchy dumps; source inspection of `apps/technician-mobile/app/job/[id]/stage/[stage].tsx` confirms the Picker/queue/submit implementation.
- **Limitations:** I did not complete a native stage submission or exercise the offline queue/conflict path. ADB's accessibility dump lagged the React Native overlay and a coordinate attempt returned to job details; I stopped rather than claim a pass. Sleek was not used, and no physical-device test was performed.

## tailwind-design-system

- **Status:** Not applicable and not invoked.
- **Reason:** FieldOps 360 uses Fluent UI and the established `styles.css` design system. Replacing it with Tailwind would create a competing component system and violate the repository's design constraints.

## nodejs-backend-patterns

- **Status:** Not applicable and not invoked for backend work.
- **Reason:** The backend is ASP.NET Core/.NET 10. No Node.js server component was added. The existing TypeScript tooling belongs to the Vite web client and Expo app, not a Node backend.

## Verification summary

| Check | Result |
|---|---|
| Web unit/component tests | 33/33 passed |
| Web TypeScript | `tsc -b --pretty false` exit 0 |
| Web production build | Exit 0; 750 KB dist, 23 assets; main chunk warning retained |
| Web formatting | `prettier --check src e2e scripts *.ts *.json *.html README.md` passed |
| Browser E2E | 10/10 passed, Chromium + mobile Chrome, 34.9 s |
| Native Android | Authenticated dashboard, job details and guided stage 1 form rendered; stage submission/offline still open |
| API/web smoke latency | Gateway 5.9–15.6 ms; web 2.8–5.9 ms (three samples each) |

Remaining verification gap: no complete WCAG audit, no native stage-submission/offline recovery, no remote CI run, and no physical Android/iOS device test.
