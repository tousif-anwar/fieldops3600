# Repository hygiene

Date: 2026-11-05.

## Removed

| Path | Files | Reason |
|---|---:|---|
| `.tmp/` | 11 | Tracked emulator UI dumps, screenshots, logs, and scratch benchmark/inventory outputs. Recreated on demand by local tooling; not build inputs. |
| `docs/screenshots/web/**/before/` | 42 | Superseded pre-redesign role captures, unreferenced by maintained documentation. Replaced by current `docs/ui-ux/evidence/after-*` images. |
| `docs/screenshots/mobile/before/` | 3 | Superseded mobile captures. |
| `docs/screenshots/mobile/after/00-current*.png` | 2 | Duplicate current-state captures; the role-specific `my-jobs.png` and `account.png` remain. |
| `docs/screenshots/{analytics-dashboard,login-desktop,operations-overview,supervisor-dashboard}.png` | 4 | Replaced by current evidence links in `docs/UI_WALKTHROUGH.md`. |

**Total removed: 62 files.** `docs/screenshots/` dropped from **11 MB to 1.1 MB**. No tracked source, test, migration, contract, or maintained document was deleted.

## Retained

- Current enterprise Home, analytics, replay, responsive, and mobile evidence.
- `docs/presentation/` — pre-existing untracked presentation work. It is large (about 33 MB) and includes MP4/WebM demonstrations. It was preserved because it is user-owned, uncommitted work, not disposable generated output.
- Backend, mobile, warehouse, intelligence, and integration tests.
- Existing case study, architecture decisions, security model, and implementation status.
- Generated local toolchains and caches under `.tools/`, `.local/`, `.venv/`, `node_modules/`, `bin/`, and `obj/`. These are ignored and were not removed; they are not tracked.

## Ignore and build-context changes

- Added `.tmp/` to `.gitignore`.
- Extended `.dockerignore` to exclude `docs/`, `tests/`, `.github/`, `.vscode/`, `.tmp/`, web E2E output, and Playwright reports from root-context builds where they are not build inputs.
- `.env`, generated realms, generated database bootstrap SQL, trained binaries, keys, and build outputs remain ignored.

## Dependency audit

- All 12 production web dependencies have source imports; none was removed. `@hookform/resolvers`, `zod`, and `react-hook-form` are used by the order/booking editors; Recharts is isolated to analytics; SignalR is used by the notification shell.
- Mobile dependencies are exercised by `npm run check` and Expo's compatibility check in CI; no dependency was removed without a verified alternative.
- No package upgrades were made in this pass. Upgrading working, pinned dependencies without a measured security or support need would add risk.
- Lockfiles are retained unchanged.

## Security check

`python scripts/check-secrets.py` passed across 430 repository files at inspection time. Existing local secrets remain in ignored `.env`/generated files and were not printed. No credential was found in the tracked changes, screenshots, or documentation.

This is a repository secret-pattern guard, not a substitute for Gitleaks, Trivy, Semgrep, or a deployment-specific review. Those remain CI/security tasks. No Git history was rewritten.

## Remaining hygiene concerns

- The untracked presentation package is about 33 MB; if it is committed later, media should be reviewed for necessity and stored with an explicit evidence policy.
- The repository still contains large PNG evidence in `docs/ui-ux/evidence/` (about 5 MB). It is retained because it supports role-home and accessibility claims.
- Docker build contexts still include mobile/web assets for root-context service builds until a per-component ignore strategy replaces the shared `.dockerignore`; the current exclusions cover the largest non-build directories.
