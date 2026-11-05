# Presentation delivery report

Working handoff snapshot: 2026-11-05. Source content, diagrams and reference documents are prepared. Root is completing deck export, PDF, script and final recording validation. Pending outputs below are deliberately not represented as delivered or verified. Replace their state only after the actual file and validation exist.

## 1. PowerPoint

Requested destination: `docs/presentation/FieldOps360_Complete_Technical_Presentation.pptx`.

Current state: source JSON is prepared; final PPTX export, every-slide rendering, notes verification and application inspection are pending at this snapshot.

## 2. PDF

Requested destination: `docs/presentation/FieldOps360_Complete_Technical_Presentation.pdf`.

Current state: final export and page-by-page formatting validation pending. The PDF must correspond to the final PowerPoint rather than an earlier draft.

## 3. Slide count

The two inspected source files define **62 entries: 50 main slides and 12 technical appendix slides**. The final exported slide/page count still requires confirmation.

Sources: [slides 1–25](slides-part1.json), [slides 26–62](slides-part2.json). All source entries contain speaker notes and evidence references.

## 4. Presentation duration

The main source allocation totals **2,400 seconds, a nominal 40-minute presentation**. Appendix slides do not count toward that allocation.

This is an automated timing plan, not a human rehearsal. Main notes contain approximately 4,846 words. Delivery pace, clip overlap, account transitions and live recovery affect actual duration. The presenter should rehearse within the requested 30–45-minute range and use shorter supplementary excerpts when necessary.

## 5. Presenter script

Requested destination: `docs/presentation/PRESENTER_SCRIPT.md`.

Current state: per-slide source narration and timings exist; root is generating the final readable script with transitions, demo cues, terminology and sources. Verify consistency with the exported notes and final encoded clip durations.

## 6. Architecture diagrams

Fifteen editable Mermaid sources and their rendered assets cover:

1. System context.
2. Container architecture.
3. Workflow components.
4. Local deployment and trust boundaries.
5. Authentication sequence.
6. API request and outbox.
7. Event-driven communication and failure.
8. Guided workflow state.
9. SLA lifecycle.
10. Database ownership.
11. Warehouse star schema and history.
12. Scheduling optimization.
13. Operational Replay.
14. Mobile offline synchronization.
15. CI validation.

Use the [diagram inventory](diagrams/DIAGRAM_INVENTORY.md) for source references and line semantics. These show the implemented self-hosted stack, not invented AWS/Azure deployments. Final slide-level readability review remains part of package validation.

## 7. Web demonstration videos

The actual served app, real Keycloak PKCE and live backend were recorded for all six roles. The current [capture manifest](demos/web/recording-manifest.json) reports six successful capture sequences with no harness errors. Raw files present:

- [Dispatcher walkthrough](demos/web/dispatcher-walkthrough.webm).
- [Technician walkthrough](demos/web/technician-walkthrough.webm).
- [Supervisor walkthrough](demos/web/supervisor-walkthrough.webm).
- [Manager walkthrough](demos/web/manager-walkthrough.webm).
- [Analyst walkthrough](demos/web/analyst-walkthrough.webm).
- [Administrator walkthrough](demos/web/administrator-walkthrough.webm).

The manifest includes actual order creation, recommendation/booking, role navigation, Replay playback, incident PDF and CSV downloads where recorded. Navigation alone does not demonstrate form submission, rescheduling or every failure path. Distribution MP4 encoding, codec/duration metadata, content review and playback validation are pending at this handoff. Record exact final MP4 paths after those steps; raw capture success is not their substitute.

## 8. Native Android demonstration videos

No final native video file is claimed at this snapshot. Root is recording the installed Android application under `docs/presentation/demos/android/`; diagnostic initial-attempt footage remains private.

Verified preparation includes debug APK build/install, real PKCE token exchange, a callback-route correction and SecureStore-backed authenticated Home restoration after force-stop/relaunch. Fresh recording of the final login-to-Home round trip and native stage submission, assistance, offline queue/reconnect/conflict steps require individual confirmation. Use the [native ledger](PRESENTATION_READINESS.md) to add only actual observed outcomes and validated file paths.

A native application video must come from the emulator/device, not a web preview. No iOS execution, physical-device certification or signed store release is claimed.

## 9. Feature coverage matrix

[FEATURE_DEMO_MATRIX.md](FEATURE_DEMO_MATRIX.md) accounts for **57 discovered feature entries**, associated roles, business purposes, owners/databases, APIs, web/native locations, evidence, procedures and media sequence IDs. It also lists explicit partial/planned/environment-blocked capabilities.

W1–W6 group web/role sequences, A1–A3 group native execution/resilience, and E1 groups engineering supplements. The matrix does not claim that every entry has a successful recording. [EVIDENCE_MATRIX.md](EVIDENCE_MATRIX.md) maps 37 principal claims to source, tests, schema and runtime boundaries.

## 10. API documentation

[API_REFERENCE.md](API_REFERENCE.md) provides the actual route/method/policy/DTO/error catalog, sanitized contract examples and event-envelope explanation. It distinguishes the scoped operational scheduling adapter from raw submitted intelligence optimization.

Current report filters are date, technician, category and priority. A requirement for supervisor/stage/SLA filters does not make those endpoint parameters implemented.

## 11. Data architecture documentation

[DATA_ARCHITECTURE.md](DATA_ARCHITECTURE.md) documents owned databases, physical tables/keys, operational constraints/indexes, outbox/inbox/receipts, immutable evidence, warehouse grain/lineage/history, quality and recovery.

Current warehouse source includes **seven dimensions and six facts**, with technician SCD2 and observed time off in migration 004 and additional guards in 005. Root confirmed both in the live ledger. Retained-event completeness and overlapping-time-off sum/cap behavior remain explicit limitations. This supersedes older type-1-only prose elsewhere.

## 12. Representative code walkthroughs

| Example | Requirement and execution path | Main evidence |
|---|---|---|
| Work-order creation and outgoing event | Signed object scope, input validation, aggregate plus outbox SaveChanges | [OperationsApi](../../building-blocks/FieldOps.ServiceHost/OperationsApi.cs), [persistence](../../building-blocks/FieldOps.ServiceHost/Persistence.cs), live API tests |
| Outbox publication and inbox/fault evidence | Recoverable at-least-once delivery, stable event ID, separate attempts | [Messaging](../../building-blocks/FieldOps.ServiceHost/Messaging.cs), [FaultMonitor](../../building-blocks/FieldOps.ServiceHost/FaultMonitor.cs), controlled resilience/fault artifacts |
| Form and SLA transition | Pinned choices, expected version, authoritative UTC, late catch-up | [WorkflowEngine](../../building-blocks/FieldOps.Core/WorkflowEngine.cs), [SlaAudit](../../building-blocks/FieldOps.ServiceHost/SlaAudit.cs), deterministic and PG cases |
| Operational optimizer adapter | Scoped staff/availability, explicit strategy, independent solver answer validation | [SchedulingRecommendations](../../building-blocks/FieldOps.ServiceHost/SchedulingRecommendations.cs), [solver](../../intelligence/fieldops_intelligence/scheduling.py), HTTP contract |
| Native durable queue/session | Stable owner/key/version/time, backoff/conflicts and stale-refresh guard | [queue](../../apps/technician-mobile/src/offline/queue.ts), [session lifecycle](../../apps/technician-mobile/src/session-lifecycle.ts), mobile tests |

These are focused implementation paths, not screenshots of hundreds of unreadable lines. Architecture alternatives and costs are discussed as retrospective assessment unless an ADR records the original decision.

## 13. Test evidence summary

Latest local presentation-preparation runs reported by root:

| Suite | Result |
|---|---|
| Backend | 57/57 passed |
| Web | 41/41 passed, nine files |
| Mobile | 23/23 passed plus TypeScript |
| Warehouse | 32/32 real PostgreSQL cases passed |
| Gateway | 7/7 real-process cases passed |

Logs are ignored under .local/presentation-*-tests.log; backend TRX is under artifacts/presentation-tests. These suites overlap and must not be summed into a fictional coverage percentage. Historical intelligence, browser, static-security, resilience, WebSocket and observability checks retain their own dates/scopes in the [evidence matrix](EVIDENCE_MATRIX.md) and [verification record](../testing/VERIFICATION.md).

Fresh isolated Compose verification passed seven migration jobs, readiness, runtime schema boundaries and warehouse quality, then removed only its own disposable project. This establishes local first startup, not a production backup restore drill. No remote successful GitHub Actions run or external deployment is claimed.

## 14. Technical Q&A

[TECHNICAL_QA.md](TECHNICAL_QA.md) contains **60 evidence-based questions and answers** covering architecture alternatives, distributed transactions, security, timers, scheduling, synthetic ML, warehouse history, replay, offline behavior, testing, deployment and limitations.

The guide distinguishes native code/tests from observed device behavior and corrects stale warehouse assumptions.

## 15. Known presentation limitations

- Final PPTX/PDF exports, exported notes, every-slide review and video playback checks remain pending at this handoff.
- The nominal duration is an automated estimate; no human timed rehearsal is claimed.
- Web recordings are silent raw captures pending distribution encoding/inspection; narration comes from the presenter script unless an audio track is actually recorded.
- Native recording coverage is step-specific and still being finalized.
- Local source links and clips require the delivered folder/repository layout; no unverified public demo destination or QR code is promised.
- Security/accessibility evidence is scoped. The presentation does not certify ASVS, WCAG 2.2 AA, production uptime, adoption or real-world predictive effectiveness.

## 16. Missing or unverified demonstrations

The final readiness record must explicitly close or retain: fresh native login callback/Home return, native form submission/assistance, offline persistence/reconnect/manual sync/conflict handling, final MP4 playback and any feature not visibly exercised in the web manifest.

There is no general interactive Digital Operations Simulator, real route/traffic optimization, native background push, runtime template authoring UI or complete in-app staff/time-off/identity CRUD. Some capabilities are API-only or source-tested and belong in the supplement with that boundary. A broad workspace tile does not override backend Replay permissions.

## 17. Git boundaries

- Presentation starting commit: **a21f558**.
- Ending delivery commit: **pending final artifact/application-fix review and commit**.
- Existing intermediate history is preserved. No push, external deployment or publication is authorized or claimed.

Root should replace the ending field only after the final verified commit exists, then report actual working-tree state. Do not invent a historical implementation narrative or rewrite earlier commits.

## 18. Delivery instructions

1. Follow [DEMO_SETUP.md](DEMO_SETUP.md), check readiness and choose the intended synthetic order/incident.
2. Open the final PowerPoint with presenter notes and keep the matching PDF/script locally available.
3. Present main slides 1–50 within the rehearsed time. Reserve slides 51–62 for questions.
4. Use prepared authenticated role contexts for the short live segment; use the validated supplementary recordings for full role/feature coverage.
5. Keep native and web demonstrations distinct. State a failed, missing or historically captured outcome accurately.
6. Keep credentials, personal windows and unrelated notifications off screen. Never bypass authentication or rewrite data to recover a demo.
7. Use [PRESENTATION_READINESS.md](PRESENTATION_READINESS.md) to close package/rendering/media/secret/timing checks before calling the presentation final.
8. Use [SKILL_AND_DESIGN_RESEARCH.md](SKILL_AND_DESIGN_RESEARCH.md) for research/skill provenance and [TECHNICAL_QA.md](TECHNICAL_QA.md) for technical follow-up.

