# Refactoring results

Date: 2026-11-05. Compare with [REFACTORING_BASELINE.md](REFACTORING_BASELINE.md). All numbers below are local measurements.

## Summary

| Area | Before | After |
|---|---|---|
| Tracked files | 385 | 335 (after new verification/docs files are staged) |
| Tracked debug captures | 11 in `.tmp/` | 0 |
| Superseded screenshots | 51 | 0 removed from maintained paths; current evidence retained |
| `docs/screenshots/` | 11 MB | 1.1 MB |
| Web entry chunk | 553.74 kB (163.31 kB gzip) | 399.92 kB (118.49 kB gzip) |
| Shared runtime chunk | Included in entry | 156.03 kB (45.62 kB gzip), cacheable |
| Analytics/chart payload | 386.80 kB | 369.04 kB charts + 17.85 kB route |
| Initial JS gzip | 163.31 kB | 164.11 kB (flat; no speed claim) |
| Vite >500 kB warning | Present | Removed |
| Web tests | 41 | 49 |
| Home page | 1,015 lines | 783 lines + 360-line typed content module |

## Code changes

1. **Extracted role content from Home.** `figuresFor` and `quickActionsFor` now live in `apps/web/src/pages/home/content.tsx`. The module has one responsibility and is covered by role-by-role tests.
2. **Removed duplicate destination policy.** Home uses `homeDestination` from `src/home.ts`; the local switch was deleted.
3. **Fixed a real mobile drawer accessibility defect.** The backdrop no longer exposes a duplicate “Close navigation” button under the drawer. Escape-to-close was already present and remains. The responsive E2E test now requires a unique control.
4. **Split cacheable vendors.** The final configuration keeps Fluent UI tree-shaken per route instead of forcing the whole library into the initial load. Charts are isolated; shared React/router/query/OIDC code is cacheable.
5. **Fixed the pre-existing mobile type error.** Removed the invalid `initialRouteName` prop from Expo Router's `Stack`; retained the intended callback redirect. Mobile typecheck and tests now pass.
6. **Added a documentation navigation gate.** `scripts/check-docs.py` validates relative Markdown file/image targets in tracked (and this change's) docs. CI runs it in its own job.
7. **Rebuilt onboarding and operations documentation.** Added a screenshot-led README, detailed installation guide, corrected index links, and these engineering records.

## Verification

| Check | Result |
|---|---|
| Backend `dotnet test` | **57/57 passed**, 10 s |
| Web typecheck | Passed |
| Web unit/component tests | **49/49 passed** (10 files) |
| Web production build | Passed; no >500 kB warning |
| Mobile typecheck | Passed |
| Mobile tests | **23/23 passed** |
| Intelligence tests | **18/18 passed** |
| Ruff | Passed |
| Live Playwright suite | **16/16 passed** after the drawer fix |
| Targeted mobile drawer regression | Passed |
| Secret guard | Passed across 430 repository files |
| Documentation links | Run `python scripts/check-docs.py`; CI gate added |

### Browser evidence

The live suite signs in through real Keycloak PKCE and covers all six role Homes, deep-link restoration, unauthorized access, sign-out, responsive reflow/navigation, and keyboard order against `http://localhost:5173`. The first run was **15/16**; the failure exposed the duplicate backdrop control described above. After the fix, the targeted test passed and the full suite was rerun to **16/16**.

No screenshot from this run is presented as proof of backend correctness. Browser evidence is visual/behavioral; API and PostgreSQL behavior remain covered by their own suites.

## What was deliberately not changed

- No framework migration, state-management replacement, or backend rewrite.
- No applied migration edits.
- No API/event contract changes.
- No dependency upgrades or removals; all web production dependencies are used.
- No mobile offline/synchronization rewrite. It is sensitive and was not failing.
- No deletion of unique architecture, delivery, security, or UI/UX knowledge.
- No Git history rewrite.
- No push or deployment.

## Remaining limitations

- No remote CI result was observed.
- Native guided-stage submission and offline queue recovery were not completed on-device.
- No physical-device, screen-reader, 200% zoom, or production hardening pass.
- Bundle initial gzip is flat; caching improved, but runtime speed was not measured with field data.
- Home remains 783 lines; further splitting needs a concrete maintenance/testability benefit.
- Route role arrays remain duplicated between guards and navigation; next refactor should centralize them with authorization tests.
- The presentation package remains untracked user work and is intentionally excluded from this change set.
