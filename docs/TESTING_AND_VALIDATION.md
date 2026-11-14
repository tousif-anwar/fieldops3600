# Testing and Validation

## Environment

| Item | Value |
|---|---|
| Execution date | 13 November 2026 |
| Host | Windows development host, local Docker Compose stack |
| Python | 3.14.4 |
| Node.js | 24.15.0 |
| .NET SDK | 10.0.403 |
| Docker | 29.9.2 |
| Database | PostgreSQL 18 Alpine container |
| Broker | RabbitMQ 4.2 Alpine container |
| Identity | Keycloak 26.8.1 container |
| Browser | Chromium via Playwright and the packaged preview browser |

The tests ran against the actual local stack and the checked-out source tree. They were not executed by a remote CI service for this release. Where a check required a disposable database, it ran inside the Compose network against the warehouse database.

## Summary

| Suite | Command | Result |
|---|---|---|
| .NET backend | `.tools/dotnet/dotnet.exe test tests/backend/FieldOps.Tests.csproj -c Release --no-build` | **75 passed, 0 failed** |
| Web unit/component | `npm test` in `client/apps/web` | **55 passed, 0 failed** (12 files) |
| Web typecheck/build | `npm run build` | Passed |
| Web formatting | `npm run format:check` | Passed |
| Mobile typecheck/tests | `npm run check` in `client/apps/technician-mobile` | **34 passed, 0 failed** |
| Optimizer tests | `python -m pytest -c optimizer/pyproject.toml tests/optimizer -q` | **10 passed** |
| Optimizer lint/format | Ruff check and format check | Passed |
| Warehouse PostgreSQL | `docker compose run --rm -v "$(pwd -W):/repo:ro" migrate-warehouse python /repo/tests/warehouse/test_projection.py -v` | **32 passed** |
| Gateway security | `python tests/security/test_gateway.py -v` | **7 passed** |
| Live integration | `python -m unittest discover -s tests/integration -v` | **5 passed** in 228.977 s |
| Scoped authorization | `python tests/backend/verify_resource_authorization_http.py -v` | **3 passed** in 98.155 s |
| Optimizer HTTP contract | `python tests/backend/verify_optimizer_http.py -v` | **1 passed** |
| Browser E2E | `FIELDOPS_LIVE_E2E=1 WEB_BASE_URL=http://localhost:8088 npx playwright test --workers=1` | **27 passed, 11 skipped, 0 failed** |
| Live SignalR notification | `WEB_BASE_URL=http://localhost:8088 node scripts/check-live-notifications.mjs` | Passed |
| Replay layout | `npm run check:replay-layout` | 5 widths passed |
| Database permissions | `python scripts/verify-database-permissions.py` | Passed |
| Compose syntax | `docker compose config --quiet` | Passed |
| Resilience demonstration | `python scripts/demo-resilience.py` with the demo override | Passed |

The browser suite contains desktop and mobile Chromium projects. Eleven desktop-only role/auth scenarios are intentionally skipped by the mobile project; they are not failures. The 27 executed scenarios passed.

## What each suite covers

### .NET backend

The backend suite covers domain rules, workflow transitions, SLA audit behavior, template validation, work-order rules, customer/asset validation, dispatch adapter checks, replay ordering and causation, trace-probe behavior, PDF construction, warehouse metrics, and PostgreSQL integration tests. The PostgreSQL tests use the configured test database/Testcontainers environment available to the suite.

### Web

The web suite covers work-order validation, analytics rendering with null populations, registry insights, replay behavior, job progress, delivery status, workflow forms, authentication translation, and asset contracts. The production build runs TypeScript project compilation and Vite bundling.

### Mobile

The mobile suite covers client-side form validation, equipment/customer context isolation, offline queue durability and retry semantics, identity/session lifecycle, SLA presentation, and UI contrast. TypeScript checking is part of `npm run check`.

### Optimizer

The optimizer suite covers baseline and CP-SAT feasibility, skills/certifications, time off, working hours, existing bookings, scarce capacity, invalid output rejection, API readiness, and request validation. The optimizer no longer contains a predictive model.

### Warehouse

The warehouse suite runs against PostgreSQL and covers duplicate/colliding events, late arrival, terminal-state protection, booking/cancellation ordering, UTC buckets under a different session timezone, DST capacity, time-off exclusions, registry projections, metric denominators, and archive/backfill ledger behavior.

### Security and authorization

The gateway tests verify that only health is anonymous, identity headers cannot authenticate, query tokens are rejected outside the hub, invalid bearer tokens are rejected, sensitive responses are not cached, unapproved origins receive no CORS allowance, and readiness fails when business services are absent.

The live scoped authorization tests verify cross-team denial, technician self-scope, booking-first cancellation, and hidden foreign-team resources. A manual policy check additionally confirmed that the Operations Manager can read an authorized replay (`200`) while Analyst and Technician receive `403`.

### Live integration

The five integration tests create synthetic records through authenticated APIs and exercise:

- signed identity and role boundaries;
- unassigned-technician invisibility;
- complete pipeline: recommendation, booking, concurrent conflict, assignment projection, eight-stage execution, idempotent resubmission, pause/resume, replay, exports, and warehouse completion;
- assigned equipment/customer context and history;
- registry reporting freshness.

No authentication bypass or handcrafted database row is used to make these tests pass.

### Browser end-to-end

Playwright verifies protected sign-in, keyboard/mobile login, a dispatcher request and booking through PKCE, supervisor analytics/replay, registry reads, role-aware navigation for all six roles, deep-link reauthentication, unauthorized deep-link denial, sign-out, responsive Home behavior, and keyboard order. Desktop and mobile Chromium projects are configured.

### Resilience demonstration

The explicit demo override sets 20/25/30-second SLA thresholds and enables a controlled warning-consumer failure. The demonstration verified:

- a persisted stage deadline survived a workflow-service restart;
- the stage became overdue and a supervisor escalation was delivered;
- a warning delivery failed once and then succeeded;
- supervisor pause/resume preserved the breach evidence;
- the eight-stage workflow completed;
- replay was immutable and internally consistent;
- a work order created while RabbitMQ was stopped later recovered through the outbox after the broker restarted.

Evidence was written to `artifacts/demo-resilience.json` locally. The file is generated evidence, not source, and is excluded from the release archive.

## Not run or not claimed

- **Native Android emulator/device execution:** no emulator session was completed. The Expo app was typechecked and its deterministic tests passed, but native runtime behavior was not verified in this release.
- **Customer portal:** no customer authentication, self-service request wizard, appointment tracking, or customer-scoped data isolation exists to test.
- **Fresh accessibility audit:** the release did not rerun a full axe-core or assistive-technology audit. Existing component tests include contrast checks, and the browser tests exercise keyboard navigation, but this is not a complete accessibility certification.
- **Production load, failover, backup/restore, and penetration testing:** not performed.
- **Remote CI:** no remote CI result is claimed. The commands above were run locally.
- **Screenshots:** no screenshots are included in the release archive.

## Reproducing the checks

From the repository root (or from `server/` in the archive, adjusting paths for `client/`):

```bash
# Backend
.tools/dotnet/dotnet.exe test tests/backend/FieldOps.Tests.csproj -c Release

# Web
cd client/apps/web
npm ci
npm test
npm run build
npm run format:check

# Mobile
cd ../technician-mobile
npm ci
npm run check

# Optimizer
cd ../../server
PYTHONPATH=optimizer optimizer/.venv/Scripts/python -m pytest -c optimizer/pyproject.toml tests/optimizer -q
optimizer/.venv/Scripts/python -m ruff check --config optimizer/pyproject.toml optimizer/fieldops_optimizer tests/optimizer

# Stack checks (stack must be running)
python tests/security/test_gateway.py -v
python -m unittest discover -s tests/integration -v
python tests/backend/verify_resource_authorization_http.py -v
python tests/backend/verify_optimizer_http.py -v

# Warehouse (Windows Git Bash path conversion must be disabled)
MSYS_NO_PATHCONV=1 docker compose run --rm -v "$(pwd -W):/repo:ro" migrate-warehouse python /repo/tests/warehouse/test_projection.py -v

# Browser and live notification checks
cd ../client/apps/web
FIELDOPS_LIVE_E2E=1 WEB_BASE_URL=http://localhost:8088 npx playwright test --workers=1
WEB_BASE_URL=http://localhost:8088 node scripts/check-live-notifications.mjs
```

The shell paths assume Git Bash on Windows. On macOS/Linux, use the corresponding `python`/`dotnet` commands and the `$PWD` path for the warehouse mount. The live tests create labeled synthetic records and clean up their bookings/orders where the test implements cleanup; they should not be run against real customer data.

## Evidence boundaries

A passing local test is evidence that the tested behavior worked in this environment on this date. It is not proof of production reliability, universal browser coverage, real-world accuracy, or security certification. Failures that were found and fixed during this release are described in [Release verification](RELEASE_VERIFICATION.md).
