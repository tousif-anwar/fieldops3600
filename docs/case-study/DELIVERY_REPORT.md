# FieldOps 360 delivery report

Evidence date: November 5, 2026 (November 4 suites are marked as inherited where applicable). This is a working local engineering system with verified operational paths, not a claim that every master acceptance item is complete. Native Android OAuth is verified; native guided workflow/offline recovery, production deployment controls and the remaining limits below stay open. All demonstration data is synthetic.

## 1. Project overview

FieldOps 360 connects service requests, qualified dispatch, guided technician work, supervisor intervention, historical analytics, and incident investigation. It combines six .NET 10 LTS services, React web, Expo mobile, PostgreSQL, RabbitMQ/MassTransit, Keycloak, and Python intelligence. [Architecture](../architecture/overview.md) · [current acceptance state](../IMPLEMENTATION_STATUS.md).

## 2. Business problem and demonstrated outcome

The fictional regional HVAC operation needs defensible assignments, consistent procedures, timely escalation, and an explainable account of service delays. Implemented paths prevent confirmed booking overlap, enforce ordered forms and persistent SLA state, retain supervisor reasons, and reconstruct recorded outcomes. No production deployment, employee productivity gain, or real-world savings is claimed.

## 3. Architecture summary

Web and mobile enter through the authenticated YARP gateway; each service independently validates identity and resource scope. Critical writes are transactional within the owning PostgreSQL database. Outboxes publish integration events; idempotent consumers update notifications, replay, and a separate warehouse. Reporting hosts the replay processor and reads the warehouse through a restricted connection. [C4 and ownership](../architecture/overview.md) · [deployment/data diagrams](../diagrams/data-and-deployment.md).

## 4. Implemented business microservices

| Service       | Implemented responsibility                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Work orders   | Validated creation/updates, lifecycle projection, customer references, version conflicts, integration events.             |
| Technicians   | Team-owned profiles, skills/certifications, working hours, availability, time-off exceptions.                             |
| Scheduling    | Scoped candidate validation, baseline/OR-Tools advice, booking/rescheduling/cancellation, PostgreSQL overlap protection.  |
| Workflows     | Versioned HVAC forms, authoritative stage state, submissions/receipts, SLA sweeps, assistance and supervisor decisions.   |
| Notifications | Deduplicated warnings/escalations, acknowledgments, persisted history, team/user SignalR updates.                         |
| Reporting     | Authorized warehouse metrics/exports, immutable replay ingestion, projections, incident summaries and trace availability. |

The six hosts share infrastructure code while owning separate databases and restricted runtime identities. [Service/API guide](../../services/README.md) · [host implementation](../../building-blocks/FieldOps.ServiceHost/Bootstrap.cs).

## 5. Web and mobile capabilities

The web app implements role-aware navigation, order management, dispatch, eight-stage forms, supervisor controls, analytics, notifications, and replay playback/filtering/exports. [Web guide](../../apps/web/README.md) · [actual UI walkthrough](../UI_WALKTHROUGH.md).
The Expo SDK 58 technician app implements PKCE/SecureStore integration, jobs/schedule/details, conditional forms, countdowns, assistance, account-isolated drafts and a durable synchronization queue with backoff, stable idempotency and explicit conflicts. Typecheck, 17 tests, compatibility checks, and Android Hermes export passed. A native debug APK is built and installed on the local emulator. A reproduced run completed the real Keycloak PKCE login as `technician`, returned through `fieldops360://oauth/callback`, exchanged a `fieldops-mobile` token, and rendered the authenticated **My jobs** dashboard for Jordan Rivera. Force-stop and relaunch restored the SecureStore session with no new authorization. Guided stage submission and offline queue recovery were not exercised on-device; iOS execution requires macOS. [Mobile guide](../../apps/technician-mobile/README.md).

## 6. Workflow and SLA design

The default pipeline is Accepted → Travel/Arrival → Inspection → Diagnosis → Repair/Service → Quality Verification → Customer Confirmation → Completion. Immutable JSON template v1 supplies backend-validated allowlists and conditional fields; each instance retains its version. Acceptance cannot silently advance a reassignment request. Expected versions and idempotency receipts protect submissions. [Template](../../building-blocks/FieldOps.Core/WorkflowTemplates/hvac-v1.json) · [workflow rules](../../building-blocks/FieldOps.Core/WorkflowEngine.cs).
Normal deadlines are 30 minutes, with persisted 20/25/30-minute warning/critical/breach milestones. Server UTC time is authoritative; approved pauses extend effective duration while preserving earlier breach evidence. Quartz sweeps recover after restart. The development-only 30-second demonstration verified deadline recovery, retry, breach, acknowledgment, pause/resume, advisory review and completion. [Policy and state design](../workflows/design.md).

## 7. Security implementation and evidence boundary

Keycloak public clients use authorization code/S256 PKCE; password grant is disabled. Signed audience/role/team claims, backend policies and resource checks restrict assigned technician work, supervisor teams, analyst aggregates and replay access. Browser tokens are in memory; mobile tokens use platform secure storage. Client timestamps and role headers do not confer authority.
Migration owners are separate from six runtime app identities; replay evidence/delivery tables permit runtime SELECT/INSERT, and warehouse writer/reader grants differ. Live permission and foreign-resource tests passed. Gitleaks, scoped Semgrep and Trivy checks were clean in their documented scopes. ZAP's pre-login passive scan recorded zero failures and four warning categories; it did not authenticate or establish ASVS compliance. [Threat model/RBAC](../security/threat-model.md) · [verification scope/findings](../testing/VERIFICATION.md).

## 8. Intelligent dispatch optimization

Operational advice checks skills, certification, local working hours, availability, time off and confirmed bookings. The Scheduling Service calls the private OR-Tools adapter with actual scoped inputs and independently validates its answer; it never labels a failed optimizer as a successful baseline fallback. Recommendations do not reserve capacity. Real operational travel is explicitly null because geocoded routing data is unavailable. [Adapter](../../building-blocks/FieldOps.ServiceHost/SchedulingRecommendations.cs).
On one reproducible synthetic six-technician/22-job dataset, both strategies assigned all 22 jobs. Baseline versus optimized depot-travel proxy was 647 versus 619 minutes; workload SD was 47.17 versus 47.96 minutes; measured runtime was 6.38 versus 3048.46 ms. The bounded solver returned FEASIBLE, not proven optimal. This is a measured tradeoff on one dataset, not a general performance-improvement claim. [Evaluation](../../intelligence/evaluation/REPORT.md).

## 9. Predictive SLA model and evaluation

A calibrated scikit-learn logistic model is compared with a rule baseline. The first chronological 60% train, the next 20% calibrate, and the last 20% evaluate; one observation per stage prevents cross-partition stage leakage. Identifiers and outcome-derived features are excluded. [Features/training source](../../intelligence/fieldops_intelligence/prediction.py).
Measured synthetic logistic results: precision 0.7739, recall 0.7350, F1 0.7540, ROC-AUC 0.8248, PR-AUC 0.8373, Brier 0.1708 and false-alert rate 0.2424. Rule F1 was 0.4424 with false-alert rate 0.1703. Median/p95 single-observation latency was 19.819/35.241 ms excluding network transit. Higher synthetic detection therefore also produced more false alerts. [Report and calibration evidence](../../intelligence/evaluation/REPORT.md).
Advice shows probability, factors, timestamp, model version and proposed intervention; unavailable operational features are explicit user-confirmed assumptions. Supervisor accept/dismiss reasons and submitted provenance are audited. Predictions do not automatically reassign work, penalize staff, or establish real-world predictive accuracy.

## 10. Operational Replay architecture and demonstration

Operational transaction → outbox → RabbitMQ → reporting consumer → immutable original event text/hash and separate delivery observations → replay projection → investigation API → console. Causation/source sequence precede timestamp tie-breaking; missing evidence and independent-order uncertainty remain visible. Playback reconstructs state without executing business commands. [Replay model](../../replay/event-store/README.md) · [ordering rules](../../building-blocks/FieldOps.Core/ReplayEngine.cs).
The completed resilience scenario retained 40 distinct audit events, one breached Travel/Arrival stage, two stage-control interventions and four supervisor actions/advisory decisions, with final observed outcome Resolved. The incident distinguished the original deadline, pause-adjusted deadline, actual completion and effective delay; no root cause was invented. This count includes separately typed diagnostic evidence and must not be described as 40 independent business actions.
The terminal-fault demonstration independently found the original Notifications message in its RabbitMQ error queue, requeued inspected messages, and verified immutable MessageProcessingFailed/DeadLetterRecorded diagnostics. Retry totals remain unknown when the fault contract does not establish them. A successful Reporting delivery is not evidence that the failed Notifications consumer recovered. Local evidence: `artifacts/demo-resilience.json` and `artifacts/demo-terminal-fault.json`; these generated files are ignored, not shipped credentials or production records.
The authenticated trace-availability endpoint checks work-order/team access and recorded trace association before querying internal Jaeger, returning only availability/reason/count metadata. An authorized missing trace and an unreachable provider remain distinct; no public trace link appears before confirmation. A retained business trace with 27 spans was verified on 2026-11-05. CSV/PDF exports preserve relevant recorded evidence and redact customer details.

## 11. Data warehouse and analytics

An independent worker stages redacted events into seven dimensions and five fact grains: order, stage instance, booking, breach event and supervisor intervention. Three versioned migrations, event/hash deduplication, source-local sequence guards, late-event enrichment and null unknown durations protect historical meaning. Reporting uses team-scoped, parameterized queries and known-creation cohorts. [Warehouse design, lineage and recovery](../../analytics/README.md).
The dashboard exposes volume/completion/SLA/stage/category/utilization aggregates, freshness, drill-down and CSV/PDF exports. Utilization clips booking and local-shift intervals with timezone/DST rules; insufficient boundaries/metadata remain null. A supplied-original-event archive can be reconciled and applied transactionally; automatic archive acquisition and independent source-completeness manifests remain operational work. Live quality checks found zero defects; 26 PostgreSQL cases passed.

## 12. Design patterns and tradeoffs

DI and options keep dependencies/configuration explicit; the state machine centralizes workflow legality; strategy separates baseline and solver advice; OIDC/HTTP adapters isolate external boundaries. Transactional outbox plus idempotent inbox provides at-least-once delivery without pretending it is exactly once. CQRS replay and dimensional projections permit investigation/reporting without cross-database operational joins.
Shared host infrastructure reduces duplication but couples infrastructure upgrades. Eventual read models can lag committed commands; bounded optimization may be feasible without optimality. In-memory browser sessions favor token containment over reload persistence. Type-1 dimensions limit historical staff/capacity interpretation. [Pattern locations, alternatives and tradeoffs](../architecture/patterns.md) · [ADRs](../INDEX.md).

## 13. Actual test and scan results

| Executed check              | Result                                                                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend / gateway           | 54/54 backend tests; six hosts build with zero warnings/errors; 7/7 gateway process checks (re-run 2026-11-05).                                     |
| Live HTTP                   | 3/3 lifecycle tests, 3/3 resource-authorization cases, 1/1 real optimizer-adapter contract.                                                         |
| Web                         | Production build, 33/33 unit/component tests and passing `format:check` (2026-11-05); 10/10 desktop/mobile browser checks from the prior evidence date. |
| Replay layout               | Five Chromium viewport checks at 1512/1280/1024/760/390; long option text no longer expands the document.                                           |
| Mobile / intelligence       | 17/17 mobile tests plus typecheck (2026-11-05); 18/18 intelligence tests re-run 2026-11-05; compatibility/Hermes export from the prior evidence date. |
| Native Android OAuth        | Real Keycloak login, `fieldops360://oauth/callback`, `fieldops-mobile` token exchange, authenticated dashboard and SecureStore restore after force-stop (2026-11-05); guided stage/offline recovery not exercised. |
| Warehouse / bootstrap       | 26/26 PostgreSQL cases and zero quality defects re-run 2026-11-05; 5/5 bootstrap checks; live runtime grants verified.                               |
| Reliability / observability | Restart/retry/breach/broker recovery passed; terminal-fault/error-queue evidence passed; 6/6 metrics targets up, Grafana login healthy and 27 retained spans verified (2026-11-05). |

These suites overlap; their counts are not a fictional independent coverage percentage. Full commands, scan scope and remaining ZAP warnings are in [executed verification](../testing/VERIFICATION.md). Native APK/emulator tests, authenticated penetration testing, load benchmarks and a complete WCAG audit are not counted as passed.

## 14. CI/CD and deployment instructions

From the root: `python scripts/init-local.py`, `docker compose up -d --build`, `python scripts/wait-local.py`, then `python scripts/verify-database-permissions.py`. Open `http://localhost:8088`; enable monitoring with `docker compose --profile monitoring up -d`. Existing volumes require non-destructive runtime/identity reconciliation; do not delete volumes to conceal migration problems. [Deployment/recovery runbooks](../operations/LOCAL_DEPLOYMENT.md).
GitHub Actions defines backend, web, mobile, intelligence, integrated Compose/browser, security and container validation paths, with pinned action references and retained test artifacts. Local command paths were exercised; no remote workflow run, external deployment or push is claimed. [Workflow](../../.github/workflows/validate.yml).

## 15. Architecture documentation index

Use the [documentation index](../INDEX.md) for C4 context/container/component views, service boundaries, ERD/star-schema/deployment/event/data/trust diagrams, all 22 interaction sequences, requirements, API/event conventions, RBAC, workflow/SLA/forms, mobile/offline design, intelligence evaluation, replay, tests and runbooks. [Requirements](../architecture/REQUIREMENTS.md) distinguishes implementation from remaining acceptance work; the UI screenshots are actual synthetic-runtime captures, not substitute test results.

## 16. Incremental Git history

Reviewed on `main` through checkpoint `e905545` on 2026-11-05; the native acceptance evidence is recorded in the current docs update. Verified earlier milestones include `56d2e56` foundation, `6e584cb` gateway, `8fb96c1` domain/SLA/replay, `6257006` persistent services, `6350c77` intelligence and `071b003` mobile, followed by preserved integration, security and template checkpoints. The resume audit added `cb0051c` (restored regression test), `5502841` (formatting required by CI) and `15b455d` (analytics label fix and new view coverage). This is real incremental history, not fabricated commits; use `git log --oneline` and `git status` for later checkpoints. No commit or push is performed by this report.

## 17. Reproducible demonstration

Start the healthy normal stack and monitoring profile, then run the ordinary live lifecycle/authorization/optimizer commands in [verification](../testing/VERIFICATION.md). For the controlled local resilience scenario:

```powershell
docker compose -f docker-compose.yml -f infrastructure/docker/compose.demo.yml up -d workflows reporting
python scripts/demo-resilience.py
python scripts/demo-terminal-fault.py
```

The scripts create labeled synthetic records, preserve immutable evidence, and restore ordinary service configuration in `finally`. The second independently verifies/requeues the inspected error-queue message. Investigate the resulting order in Replay, compare its timeline/summary/export and trace availability, then review warehouse freshness. See [full demonstration and operational limits](../../services/OPERATIONS_DEMONSTRATION.md); never apply failure injection or accelerated thresholds outside Development.

## 18. Known limitations and acceptance still open

- Native Android OAuth, token exchange and SecureStore restore are verified. Guided stage submission, offline queue recovery, notification delivery and physical-device behavior remain unverified; no signed mobile release or iOS execution is claimed.
- Cross-service profile/time-off edits and cancellation racing an unprojected booking are not distributed serializable transactions; cancel a confirmed booking before its order. SignalR is best effort; persisted history is authoritative.
- Only immutable HVAC template v1 is shipped; runtime template authoring is absent. Not every proposed analytic chart/filter or administrative screen is implemented. Mobile AsyncStorage drafts are not application-encrypted.
- Operational routing/travel, multi-day route optimization, SCD2 staff/hour history and time-off/weekend capacity exclusions are absent. Advisory snapshots are submitted evidence, not cryptographically verified model-result receipts.
- Generic terminal failures are recorded, but every intermediate consumer attempt and automatic poison-message repair are not implemented. Jaeger retention is bounded/in-memory; a trace identifier is not a retention guarantee.
- Production TLS, MFA/device policy, secret rotation, approved retention/backups, restore drills, full accessibility assessment and authenticated security review need deployment-specific completion. Remote CI and external deployment remain unexecuted.

## 19. Portfolio case study

The engineering result is an inspectable chain from authenticated service demand to conflict-protected dispatch, ordered field execution, advisory intervention and preserved incident evidence. Its strongest demonstration is the same synthetic incident viewed as authoritative workflow state, delayed/retried messaging, a warehouse fact, a factual export and a correlated trace. Measured solver/model results and explicit unknowns make the tradeoffs reviewable.
The next acceptance priorities are native guided workflow/offline validation, final clean-repository/deployment reconciliation, production hardening and validated operational retention/restore practice. The portfolio should present the executed evidence and these boundaries together, rather than equating a broad feature list with production readiness.
