# Functional and nonfunctional requirements

The target organization is a fictional regional HVAC team of about 25 technicians and 100–150 daily orders. Those figures describe the business scenario, not a measured load-test capacity.

| Capability | Acceptance boundary |
|---|---|
| Identity | Keycloak code + PKCE; signed issuer/audience/expiry, roles and team subject; native SecureStore and browser in-memory tokens |
| Orders / dispatch | Team-scoped create/update, lifecycle rules, qualification/hour/time-off checks, nonoverlapping confirmed bookings, reasoned changes |
| Workflow | Eight ordered version-pinned forms, allowed conditional answers, immutable completed history, optimistic concurrency and idempotency |
| SLA | Persisted UTC start/deadline, 20/25/30 minute thresholds, restart catch-up, authorized pause/resume, preserved breach evidence |
| Supervisor | Persisted escalations/acknowledgment, urgent-first views, reasoned intervention, advisory risk and history |
| Mobile | Assigned jobs/schedule, dropdown stages, drafts, owner-scoped queue, backoff, conflicts, online/offline feedback |
| Analytics | Independent redacted dimensional warehouse, incremental/late ingestion, quality checks, archive backfill, defined metrics and scoped exports |
| Dispatch intelligence | Baseline and actual OR-Tools advice using one scoped appointment; separate reproducible multi-job evaluation |
| Predictive intelligence | Chronological synthetic train/calibrate/test, calibrated probability, feature factors, advisory accept/dismiss provenance |
| Investigation | Append-only original events and attempts, causation/source ordering, historical playback, filters, trace retention check, factual CSV/PDF summary |

Correctness is strongest within an owning database: booking exclusion and workflow transition/version checks are transactional. Cross-service read models are eventually consistent. No distributed serializability is claimed for profile/time-off edits racing bookings or cancellation racing an unprojected booking.

Security targets include broken object authorization checks, minimal database grants, redacted analytics, no committed secrets, scoped replay and validated input. This local HTTP environment is not certified against ASVS. Production requires deployment-specific TLS, trust, MFA, rotation, retention and backup controls.

Usability targets include light Fluent UI, responsive task-based navigation, visible labels/status/focus, large touch controls, keyboard operation and progressive disclosure. WCAG 2.2 AA is a target; browser checks and component tests do not constitute a complete screen-reader/contrast audit.

Reliability targets include atomic outbox, stable message identity, idempotent inboxes, retry/error queues, restart-safe deadlines, separately retained delivery evidence and recoverable projections. SignalR is best effort; persisted notification history is authoritative. The resilience demonstration measures behavior, not a production recovery SLA.

Maintainability targets include supported runtimes, role-isolated shared infrastructure, versioned SQL/JSON, explicit contracts, CI command paths, deterministic clocks, measured model/solver reports and coherent Git milestones. There are no invented throughput, uptime, predictive accuracy or travel-improvement guarantees.
