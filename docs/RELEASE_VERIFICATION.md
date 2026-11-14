# Release Verification

## Release

| Item | Value |
|---|---|
| Archive | `FieldOps360_Final_Project.zip` |
| Required top-level entries | `docs/`, `client/`, `server/`, `data/` |
| Verification date | 13 November 2026 |
| Source baseline | local `main` working tree after cleanup |
| Runtime | Docker Compose local stack, Windows host |

The archive checksum is reported in the release summary generated with the final ZIP. It is intentionally not embedded in this document because writing the value into the archive would change the archive and invalidate the checksum.

## Changes completed for this release

### AI and agent material removed

- Removed the optional SLA breach classifier, its evaluation artifacts, and `/predict` endpoint.
- Removed the risk-assessment React component, its workflow rendering, and its frontend types.
- Removed the supervisor advisory-decision endpoint and its ML-specific event payload.
- Removed scikit-learn, pandas, NumPy, and joblib as direct requirements. OR-Tools may pull runtime numerical packages transitively; there is no predictive model, training script, model artifact, prompt, embedding, RAG, or LLM service in the release.
- Renamed the deterministic scheduling service from `intelligence` to `optimizer` across the package, Compose service, gateway route, tests, scripts, and documentation.
- Removed the skill-usage report and all old engineering/agent-oriented documentation.
- Removed generated catalog and security-snapshot helper scripts that depended on the deleted documentation tree.

### Defects and consistency fixes

- Aligned the Operations Manager replay policy with the existing UI route: Manager can read replay evidence; Analyst and Technician remain denied.
- Updated the live notification verification input to supply the required unregistered-customer reason instead of relying on obsolete validation.
- Updated the web formatting script after removing the module README.
- Made the database-permission verifier resolve Compose container IDs through `docker compose ps` instead of assuming the default Compose project name, so it works in clean release and renamed project environments.
- Kept the deterministic OR-Tools scheduler, technician qualification rules, booking overlap protection, workflow/SLA logic, notifications, reporting, and replay intact.

### Documentation

The old 43-file documentation tree was replaced with a focused set:

- `docs/README.md`
- `docs/PROJECT_OVERVIEW.md`
- `docs/SYSTEM_ARCHITECTURE.md`
- `docs/FEATURES.md`
- `docs/DATABASE_DESIGN.md`
- `docs/API_REFERENCE.md`
- `docs/INSTALLATION_AND_SETUP.md`
- `docs/USER_GUIDE.md`
- `docs/TESTING_AND_VALIDATION.md`
- `docs/SECURITY.md`
- `docs/PRESENTATION_GUIDE.md`
- this release verification report
- `docs/LICENSE`

Redundant service READMEs, old ADRs, duplicated data reports, generated evidence reports, and obsolete deployment notes were removed. Unique operational facts were carried into the retained documents.

## Source-tree verification results

| Check | Result |
|---|---|
| .NET backend tests | **75 passed, 0 failed** |
| .NET Release build | Passed with 0 warnings and 0 errors |
| Web typecheck and production build | Passed |
| Web tests | **55 passed, 0 failed** |
| Web formatting | Passed |
| Mobile typecheck and tests | **34 passed, 0 failed** |
| Optimizer tests | **10 passed, 0 failed** |
| Optimizer Ruff lint/format | Passed |
| Warehouse PostgreSQL tests | **32 passed, 0 failed** |
| Gateway security tests | **7 passed, 0 failed** |
| Live integration tests | **5 passed, 0 failed** |
| Scoped authorization tests | **3 passed, 0 failed** |
| Optimizer HTTP contract | **1 passed, 0 failed** |
| Browser E2E | **27 passed, 11 intentionally skipped, 0 failed** |
| Live SignalR notification check | Passed |
| Replay layout checks | 5 widths passed |
| Database permissions | Passed |
| Compose configuration | Passed |
| Resilience demonstration | Passed |

The resilience demonstration covered an accelerated SLA breach, workflow-service restart, failed warning delivery and retry, supervisor pause/resume, completed immutable replay, RabbitMQ outage, and outbox recovery.

A direct policy check after rebuilding the reporting image produced:

- Operations Manager replay: `200`.
- Analyst replay: `403`.
- Technician replay: `403`.

## Clean-extraction verification

The archive was extracted into a separate directory and checked without using the development checkout for execution. The only top-level entries were `docs/`, `client/`, `server/`, and `data/`. The extracted documentation checker passed with 23 links across 12 files. No `node_modules`, build output, `.env`, generated identity/database bootstrap, `.git`, live database data, or temporary media was present.

| Extracted-tree check | Result |
|---|---|
| Mobile dependency install and `npm run check` | **34 passed, 0 failed** |
| Web production image build | Passed (`npm ci` plus TypeScript/Vite build in Docker) |
| .NET backend Release build | Passed with 0 warnings and 0 errors |
| .NET backend tests | **75 passed, 0 failed** |
| Gateway Release build | Passed with 0 warnings and 0 errors |
| Optimizer tests | **10 passed, 0 failed** |
| Compose configuration | Passed |
| Fresh-volume stack startup and readiness | Passed; 15 services up, identity/gateway/web ready |
| Live integration tests | **5 passed, 0 failed** in 240.313 s |
| Scoped authorization tests | **3 passed, 0 failed** in 98.847 s |
| Optimizer HTTP contract | **1 passed, 0 failed** |
| Gateway security tests | **7 passed, 0 failed** |
| Warehouse PostgreSQL tests | **32 passed, 0 failed** |
| Database permissions | Passed |
| Replay policy check | Manager `200`, Analyst `403` |
| Served web entry point | HTTP `200`, expected app title and built asset references |
| Gateway readiness | HTTP `200` |

The extracted web build used the release-only `client/Dockerfile.web` image definition and built successfully from the archive's `client/` tree. The gateway security test on the Windows host required `DOTNET_ROLL_FORWARD=LatestMajor` because the host has .NET 11 RC runtimes but not the .NET 10 runtime; the application itself ran in the .NET 10 service images. The disposable release Compose project was started with a separate project name and fresh volumes, then removed with its volumes. The original development stack was restarted with its pre-existing volumes after verification.

## Release archive status

The archive is assembled from a clean staging tree rather than by zipping the development checkout. It excludes `.git`, dependencies, build output, `.env` secrets, generated Keycloak/PostgreSQL bootstrap files, live database volumes, local test output, and presentation media.

The release staging tree contains:

- `docs/`: the retained documentation and license.
- `client/`: web and mobile source, lockfiles, browser/mobile tests, and a release-only web image definition.
- `server/`: service source, shared libraries, gateway, optimizer, analytics, replay, Compose configuration, runtime infrastructure templates, reproducibility scripts, and tests.
- `data/`: reference migrations, warehouse grants and quality checks, data dictionary, ER diagrams, and seed guidance.

## Remaining limitations

- No customer self-service login or customer portal is implemented.
- No native Android emulator/device run was completed; Expo typechecking and deterministic tests passed.
- No remote CI run is claimed for this release.
- The local stack is HTTP on loopback with generated demonstration credentials and is not production-certified.
- Analytics and replay are eventually consistent; Jaeger retention is in-memory.
- Contract entitlement and installation-permit workflows are partial; they are not first-class data models.
- Full accessibility, load, failover, backup/restore, and penetration testing were not completed.

## Final archive verification

The final archive was extracted into a clean temporary directory, its four top-level directories were confirmed, and its documentation links, source references, Compose configuration, dependency manifests, and secret exclusions were inspected. The extracted client and server were rebuilt, the Compose stack was started from the extracted `server/` tree, and the live wait/health checks were repeated. The final report was then updated and the archive reassembled; the reassembled archive was re-checked for its four-directory structure, documentation links, and secret/dependency exclusions. The checksum changes when documentation changes, so it is reported only in the release summary delivered with the final ZIP.

No customer portal or native Android emulator verification is claimed.
