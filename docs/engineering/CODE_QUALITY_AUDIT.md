# Code-quality audit

Date: 2026-11-05. The review followed the repository's actual dependency graph and test surface; it did not impose a new framework or split modules solely to match a diagram.

## Method

- Read the service projects, shared host, gateway, web routes/auth, mobile runtime/offline queue, Python package, Compose, CI, and tests.
- Applied the deletion test to suspected shallow modules: would removing the module concentrate useful complexity, or just move it?
- Searched for duplicated role routing, duplicate helpers, unsafe `any`, TODO/FIXME markers, and console logging.
- Compared module size and responsibility; checked existing tests before changing sensitive paths.
- Used the [improve-codebase-architecture skill](../../docs/engineering/SKILL_USAGE.md) as a review checklist, adapted to an implementation brief because its interactive HTML report flow is not a delivery artifact.

## Findings and changes

### 1. Home page had two responsibilities and a duplicate helper

`apps/web/src/pages/Home.tsx` was 1,015 lines. It mixed query orchestration, role-specific metric construction, quick-action configuration, and JSX. It also reimplemented `homeDestination` locally even though `src/home.ts` already owned that policy.

Change:

- Extracted the six-role figure and quick-action definitions into `apps/web/src/pages/home/content.tsx` (360 lines) behind `figuresFor` and `quickActionsFor`.
- Added `apps/web/src/test/home-content.test.tsx` covering all six roles and destination behavior.
- Removed the duplicate local destination helper; Home now imports the single policy from `src/home.ts`.
- Home is now 783 lines. It still owns query composition and page JSX, but no longer owns static role content.

This is a real cohesion improvement, not a claim that 783 lines is ideal. Further extraction of role panels is possible but would create prop plumbing without a measured testability gain.

### 2. Duplicate accessible close control in the mobile drawer

The Playwright responsive test failed because the backdrop was a `<button aria-label="Close navigation">` under the open drawer, while the drawer also had a real close button. The hidden backdrop button was selected first and intercepted by a nav link.

Change: the backdrop is now a presentation-only `<div aria-hidden="true">`; the single real close button remains, and the existing Escape handler still closes the drawer. The test was strengthened to require one uniquely named control. Targeted live test passes.

### 3. Duplicate route role lists

`apps/web/src/main.tsx` repeats role arrays across route guards and navigation owns its own role matrix. This is understandable but remains a source of drift. It was not refactored in this pass because route authorization is security-sensitive and the current behavior is covered by deep-link/E2E tests. Recommended next step: a typed access-policy module with tests, not a blind merge.

### 4. Backend hosts are already thin

The six service `Program.cs` files delegate to `FieldOps.ServiceHost`; the largest shared module is `OperationsApi.cs` at 335 lines. The domain rules live in focused modules (`WorkflowEngine`, `WorkOrderRules`, `ReplayEngine`, `Templates`) and are covered by 57 backend tests, including PostgreSQL Testcontainers. No high-confidence God class or dead abstraction justified a backend rewrite. Splitting 300-line API modules by resource would increase surface area without a failing test or measured maintenance problem.

### 5. Mobile UI primitives are large but cohesive

`apps/technician-mobile/src/ui/components.tsx` is 540 lines of shared styled primitives. It is not mixed with offline synchronization; `src/offline/queue.ts` (146 lines) and persistence are separate. No split was justified. The only change was the invalid Expo Router prop that blocked typechecking.

### 6. Performance

Measured baseline: entry 553.74 kB raw / 163.31 kB gzip; Analytics 386.80 kB. The main chunk triggered Vite's advisory.

Change: split shared React/router/query/OIDC runtime and the charting engine into cacheable chunks. Entry became 417.94 kB initially and 399.92 kB after removing the over-broad Fluent grouping; shared runtime 156.03 kB; charts 369.04 kB plus Analytics 17.85 kB. Initial gzip is **164.11 kB vs 163.31 kB**, essentially flat. The >500 kB warning is gone and vendor code is cacheable, but **no load-time speedup is claimed**. This is a caching/maintainability improvement, not a measured latency win.

### 7. Dependency and static checks

- All production web dependencies are imported; none is unused.
- No `any`, TODO/FIXME, or `console.log` found in `apps/web/src` at audit time.
- Web TypeScript strict mode and component tests pass.
- Intelligence Ruff passes.
- CI already covers backend, web, mobile, intelligence, integrated Compose, and security scans.

## Remaining technical debt (prioritized)

1. **Extract typed access policy** shared by routes and navigation; add table-driven authorization tests.
2. **Further Home decomposition** if role panels continue growing; avoid premature prop plumbing.
3. **Add ESLint or equivalent** to web/mobile if the team wants rule coverage beyond TypeScript and Prettier.
4. **Native guided-stage/offline recovery** remains unverified; this is a functional gap, not a code-style issue.
5. **Production security/operations**: TLS, MFA/device policy, secret rotation, retention, backup restore.
6. **Remote CI** has not been run; local commands are mirrored in `.github/workflows/validate.yml`.
7. **Bundle caching** needs real field metrics before any performance claim; initial payload is flat.

## Verification boundary

The audit did not run a full static-analysis suite, coverage report, native device pass, or external penetration test. It did run the backend, web, mobile, and intelligence suites listed in [REFACTORING_RESULTS.md](REFACTORING_RESULTS.md).
