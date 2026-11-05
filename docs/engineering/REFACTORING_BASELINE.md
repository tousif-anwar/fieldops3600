# Refactoring baseline

Date: 2026-11-05  
Branch: `main`  
Starting commit: `8b1987a`  
Environment: Windows, Docker Compose local stack, Node 24.15.0, npm 12.2.1, .NET SDK 10.0.403, Python 3.14.4.

This record was captured before the repository transformation. It is the comparison point for [REFACTORING_RESULTS.md](REFACTORING_RESULTS.md), not a retrospective reconstruction.

## Repository state

- **385 tracked files** at the start.
- 13 modified tracked files and several untracked presentation documents/assets were already present. They were treated as user work and preserved. The untracked presentation material is not part of this change set.
- Tracked `.tmp/` contained 11 disposable simulator/debug captures.
- `docs/screenshots/` contained 11 MB of role-by-role “before” images plus duplicate current-state captures.
- No tracked build output (`bin/`, `obj/`, `dist/`, `node_modules/`, `.venv/`) was present; all were ignored.
- The local Compose stack was already running with healthy PostgreSQL, RabbitMQ, and Keycloak.

## Pre-existing issue found

The uncommitted mobile `_layout.tsx` change added `initialRouteName="(tabs)"` to an Expo Router `Stack`. Expo Router's typed `Stack` does not accept that prop, so the mobile typecheck failed with `TS2322`. The change was not discarded; the invalid prop was removed while the intended callback redirect was kept. Mobile checks then passed.

## Baseline checks

| Check | Result | Notes |
|---|---|---|
| Backend `dotnet test` | **57/57 passed**, 10 s | Includes PostgreSQL Testcontainers tests |
| Web typecheck | Passed | `tsc -b --pretty false` |
| Web unit/component | **41/41 passed** | 9 files |
| Web production build | Passed | `index` 553.74 kB, `Analytics` 386.80 kB; >500 kB warning |
| Expo typecheck | **Failed** | Pre-existing `initialRouteName` error above |
| Expo tests | **23/23 passed** after the type repair | Offline, form, auth, and presentation tests |
| Intelligence pytest | **18/18 passed** | Synthetic evaluation suite |
| Ruff | Passed | Intelligence package and tests |
| Local endpoints | Keycloak 200, gateway ready 200, web 200 | Vite and Compose both reachable |
| Documentation links | Not yet gated | Several case/name mismatches were visible by inspection |

## Bundle baseline

| Asset | Raw size | Gzip |
|---|---:|---:|
| Main entry `index-CHcqYydu.js` | 553.74 kB | 163.31 kB |
| `Analytics-Dk88OkZI.js` | 386.80 kB | 114.51 kB |
| `WorkOrders-DWD8Oo4B.js` | 132.83 kB | — |

Vite warned that the main chunk exceeded 500 kB. This was a size warning, not proof of a user-facing latency regression; no Lighthouse or field-performance baseline existed.

## Preservation constraints

- Keycloak PKCE, six-role authorization, deep-link return, and in-memory browser tokens.
- Work-order lifecycle, scheduling constraints, eight-stage workflow, versioned forms, and 20/25/30-minute SLA model.
- Transactional outbox, inbox deduplication, retry/dead-letter evidence, and replay immutability.
- Expo SecureStore/offline queue behavior and account isolation.
- Existing API/event/database contracts and applied migrations.
- Synthetic-only data and no committed credentials.
- Pre-existing untracked presentation work.

## Known limitations at baseline

- No remote CI run was initiated.
- No native guided-stage submission or offline-recovery pass was completed.
- No production TLS, backup restoration drill, or external deployment.
- No complete assistive-technology or 200% zoom audit.
- The main web chunk exceeded Vite's advisory threshold.
