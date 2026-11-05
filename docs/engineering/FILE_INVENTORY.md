# File inventory

Inventory date: 2026-11-05. This is a human-readable summary; the path-level, machine-readable record is [file-inventory.csv](file-inventory.csv).

## Disposition model

- **Essential source** — required to build or run a supported component.
- **Essential verification** — tests, fixtures, security checks, and reproducible evidence.
- **Essential operations** — Docker, identity, database bootstrap, monitoring, and CI.
- **Documentation** — maintained architecture, runbooks, UI/UX evidence, and delivery records.
- **Retained local-only** — ignored toolchains, emulator state, and generated caches. These are not tracked and are not part of the deliverable.
- **Removed** — confirmed disposable debug captures and superseded screenshots. Removal is listed in [REPOSITORY_HYGIENE.md](REPOSITORY_HYGIENE.md).

## Baseline by area

| Area | Tracked at baseline | Purpose | Disposition |
|---|---:|---|---|
| `apps/web/` | 92 total under `apps` (web + mobile) | React portal, tests, E2E, and Expo app | Essential |
| `docs/` | 132 | Architecture, operations, security, UI/UX, presentation, evidence | Essential; obsolete images removed |
| `services/` | 32 | Six ASP.NET Core hosts and service guide | Essential |
| `building-blocks/` | 27 | Domain rules, host bootstrap, persistence, security, APIs | Essential |
| `tests/` | 25 | Backend, integration, mobile, security, warehouse tests | Essential |
| `scripts/` | 14 | Bootstrap, readiness, reconciliation, verification | Essential operations |
| `intelligence/` | 12 | Model, API, evaluation, requirements | Essential |
| `analytics/` | 12 | Warehouse SQL, ingestion worker, quality tests | Essential |
| `infrastructure/` | 11 | Dockerfiles, Keycloak, PostgreSQL, monitoring | Essential operations |
| `gateway/` | 3 | YARP gateway source and guide | Essential |
| `replay/` | 1 | Replay evidence model | Essential |
| `.tmp/` | 11 | Simulator/debug screenshots, UI dumps, benchmark scratch | **Removed** |
| Root and `.github/` | 12 | README, license, contribution, Compose, CI, editor config | Essential |

## Current state after cleanup

- **323 tracked files** immediately after removing `.tmp/` and obsolete screenshots.
- **12 new files** are introduced by this transformation: the Home content module and its test, the installation guide, six engineering records, the docs checker, the inventory CSV, and `global.json`.
- **335 tracked files** expected after the change set is staged. The exact count is rechecked before commit.
- **102 image/video assets remain under `docs/`**, including current UI/UX evidence and the pre-existing untracked presentation package. They are not interchangeable: the UI/UX evidence supports the accessibility and role-home claims; presentation media supports the separately supplied presentation.

## Deliberately retained

- `.env.example` (names only; no values), `.gitignore`, `.dockerignore`, editor and Semgrep configuration.
- Applied SQL migrations and warehouse schema files. Historical migrations are not rewritten.
- The full backend test project, including Testcontainers coverage.
- Existing architecture decisions and delivery/case-study documents.
- Pre-existing untracked presentation documents, rendered diagrams, and media. They are user work and were not deleted or restaged.

## Not part of the tracked repository

`node_modules/`, `.venv/`, `bin/`, `obj/`, `dist/`, `.expo/`, `coverage/`, `.tools/`, `.local/`, `artifacts/`, and generated Keycloak/database bootstrap files are ignored or generated. The local `.tools/` directory contains the Android SDK, JDK, Gradle, and .NET SDK used for verification; it is intentionally outside Git and was not deleted.

## Files with special sensitivity

- Root `.env`: generated local secrets; ignored, never read into reports or screenshots.
- `infrastructure/keycloak/realm.generated.json`, `infrastructure/postgres/init.generated.sql`: generated credentials/grants; ignored.
- Mobile SecureStore and offline queue source: contains security-sensitive behavior but no secret values.
- `docs/ui-ux/evidence/`: synthetic local data only; no customer or credential content.
