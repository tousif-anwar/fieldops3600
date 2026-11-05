# Documentation consolidation

Date: 2026-11-05. This records what moved, what remains authoritative, and what was removed.

## Principle

One authoritative document per topic. Existing detailed documents were preserved where they carried unique architecture, security, operational, or evidence value. No document was replaced with a generic summary.

## Changes

| Area | Change | Authoritative location |
|---|---|---|
| Repository entry point | Rewrote the short overview into a screenshot-led README with business context, architecture, services, setup, verification, docs index, and limits. | `README.md` |
| Installation | Added a complete fresh-install, source-development, test, upgrade, monitoring, reset, and troubleshooting guide. | `docs/INSTALLATION.md` |
| Navigation | Rebuilt the index around onboarding, architecture/data, product/operations, security/verification, UI/UX, and engineering. | `docs/INDEX.md` |
| Link correctness | Fixed the case-sensitive design-system link and stale screenshot links. | `docs/INDEX.md`, `docs/UI_WALKTHROUGH.md` |
| UI walkthrough | Replaced old dashboard/“before” images with current role, analytics, replay, work-order, and mobile evidence. | `docs/UI_WALKTHROUGH.md` |
| Contribution | Added installation/docs links, component verification commands, screenshot policy, and a PR checklist. | `CONTRIBUTING.md` |
| Engineering evidence | Added baseline, inventory, hygiene, quality audit, results, and this consolidation record. | `docs/engineering/` |
| Skills | Extended the execution record with this pass's measurements, limitations, and availability notes. | `docs/engineering/SKILL_USAGE.md` |

## Preserved without consolidation

These documents were reviewed and intentionally retained because they contain distinct, accurate detail or delivery history:

- `docs/IMPLEMENTATION_STATUS.md` — current component acceptance and open risks.
- `docs/operations/LOCAL_DEPLOYMENT.md` — deep recovery, broker, readiness, and upgrade runbook.
- `docs/architecture/*`, `docs/adr/*`, `docs/security/*`, `docs/workflows/*`, `docs/diagrams/*` — architectural and security reasoning.
- `docs/testing/VERIFICATION.md` — command/evidence map.
- `docs/ui-ux/*` — research, audit, journeys, IA, role Home, design system, writing, accessibility, and usability evidence.
- `docs/case-study/DELIVERY_REPORT.md` — delivery narrative with evidence boundaries.
- `docs/presentation/*` — pre-existing untracked presentation work. It was not moved, rewritten, or staged.

## Removed documentation assets

Only superseded screenshot trees, duplicate current-state captures, and tracked `.tmp` debug artifacts were removed. The mapping and counts are in [REPOSITORY_HYGIENE.md](REPOSITORY_HYGIENE.md). No unique explanatory document was deleted.

## Link validation

`scripts/check-docs.py` resolves relative links and image targets in maintained Markdown, ignores external/anchor links, and reports missing paths. It is run locally and in the new CI documentation job. This prevents the case-sensitive and stale-image-link class of failure found in the baseline.

## Known documentation gaps

- Some feature docs still describe behavior at a level below full API field-by-field reference; source contracts remain authoritative.
- The case study and implementation status are snapshots and must be refreshed after future functional work.
- The untracked presentation package is outside the maintained documentation build until its owner commits or removes it.
- No automated spelling/grammar gate exists; the UX writing review remains a human document.
