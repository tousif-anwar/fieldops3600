# Contract response and completion targets

Prepared 18 November 2026. The user selected response and completion targets in addition to the existing stage SLA. This is the proposed implementation; no contract SLA code, migration or verification is established by this document. Targets and their clock origin remain unset by default, with no invented target durations.

## Current behavior

[WorkflowEngine.cs](../../building-blocks/FieldOps.Core/WorkflowEngine.cs) applies the configured global `SlaPolicy` to each activated workflow stage. [SlaSweep](../../building-blocks/FieldOps.ServiceHost/Messaging.cs) evaluates Active workflows; pause/resume adjusts that stage's deadline. [SlaAudit.cs](../../building-blocks/FieldOps.ServiceHost/SlaAudit.cs) emits stage milestones, including catch-up during submission, and notifications maps stage warnings/breaches to operational audiences. These are workflow-stage timers, not contract response/completion promises. Preserve their settings, semantics, event names and reporting.

[Contracts.cs](../../building-blocks/FieldOps.Core/Contracts.cs) has no SLA terms. The work-order coverage snapshot in [Models.cs](../../building-blocks/FieldOps.Core/Models.cs) records agreement/line and coverage facts but no deadlines. The work-order consumer applies scheduling revisions and workflow start/completion facts. Booking events carry canonical UTC windows; `BookingServiceStarted.v1` is a scheduling-owned, server-timestamped start claim. `WorkflowCompleted.v1` supplies server completion, which the work-order owner projects and republishes as `WorkOrderCompleted.v1`. Client offline occurrence timestamps are explicitly not authoritative.

## Minimal terms and snapshots

Keep terms in customers and execution in work-orders; add no service.

| Owner | Proposed data |
|---|---|
| Customers | Nullable `MaintenanceContract.SlaClockOrigin`: `WorkOrderCreated` or `AppointmentStart`. Nullable positive, representable `ContractLine.ResponseTargetMinutes` and `CompletionTargetMinutes`. Require an explicit origin when any line enables a target. Null means not configured, not unlimited or compliant. |
| Work-orders | One SLA snapshot per job: source agreement/line/version, immutable target durations/origin/display zone, snapshot version/hash/time, selected booking ID/revision/start, clock revision/origin time, response/completion due times, observed milestone times/source-event IDs, target findings and review reason. Missing origin evidence means WaitingForAppointment or AwaitingEvidence, not a guessed deadline. |
| Work-orders | Append-only SLA evidence for attachment, clock revision, milestone, breach, cancellation and correction. Include before/after deadline, actor or system identity, owner event/booking revision, causation and effective versus recording times. Use uniqueness for snapshot/clock-revision/target/transition and existing inbox deduplication. |

Copy eligible SLA terms through entitlement evaluation and the canonical order creation/classification path. Snapshot terms for that job; later contract renewal, expiry, suspension or term changes do not silently rewrite existing obligations. A pre-service reclassification that changes terms needs explicit versioned replacement evidence. Once execution starts, keep the snapshot fixed and require review for incompatible changes. Preserve legacy rows as unconfigured; do not backfill promises from the global stage policy.

## Clock and milestone rules

Both durations are elapsed UTC minutes from the explicitly selected origin; completion is a total target from that origin, not an implicit duration after response. No weekends, quiet hours, business calendars, travel deductions or stage pauses alter these clocks.

- **WorkOrderCreated:** origin is the canonical work-order creation instant. Booking, rescheduling and appointment cancellation do not restart it.
- **AppointmentStart:** wait for a Confirmed scheduling-owned appointment and use its `StartUtc`, even when it is in the future. A generated maintenance job may exist months before its due visit; creating that job must not start an appointment-based target. No confirmed booking means no active appointment-based deadline.
- **Response milestone:** recommend the existing scheduling-owned `BookingServiceStarted.v1` claim, presented as “Response: service started.” It establishes the system's operational start, not a phone/email response, physical arrival or a completed first form. Do not relabel another stage as response. A different business milestone would require explicit, versioned terms and verified source evidence.
- **Completion milestone:** use canonical owner-confirmed completion, retaining the actual server completion instant rather than broker receipt time. Do not infer success from a workflow screen, queued submission or missing event. Completion without its earlier response evidence remains AwaitingEvidence for that target.

Define one exact boundary consistently; matching current stage conventions means `now >= due` is overdue and a milestone strictly before due meets the target. Test the exact due instant. A valid early start/completion before a future appointment origin is an early achievement, not a negative elapsed duration; retain its actual timestamp. Reject impossible/contradictory facts into review rather than fabricating times.

## Booking changes and delayed evidence

Use scheduling's per-order assignment revision, not booking-local version, to ignore older appointment changes. Store source booking ID and revision with every clock change.

For appointment-based clocks, an accepted pre-service reschedule may revise origin/deadlines, with full old/new evidence. Once service has started, freeze the clock against later delivery of older booking events. The start claim includes the authoritative appointment window and revision, allowing reconciliation if it arrives before BookingCreated. A reschedule after an already elapsed deadline must not erase a historical breach: retain the prior clock/finding and record revision/review explicitly. Distinguish when the owner changed the appointment from when the broker delivered that change.

Appointment cancellation before service removes that appointment-based active clock and leaves the job WaitingForAppointment; it does not cancel a creation-based clock or the work order. Canonical work-order cancellation stops unresolved target monitoring while retaining previous deadlines, milestones and breach evidence. A conflicting late completion/cancellation requires review, not silent history replacement.

New SLA ingestion must validate source service, supported event/schema version, work-order/team/booking references and monotonic revisions. Existing inbox protects identical redelivery; semantic milestone keys protect different message IDs for the same fact. Select valid canonical milestone timestamps deterministically. Persist source facts so a delayed valid milestone can correct a prior “overdue observed” finding. Append a correction linked to the original breach/notification; never delete the alert, pretend receipt time was occurrence time, or report both findings as independent breaches.

## Evaluation, API and user interface

Add a work-orders-owned sweep over configured, unresolved targets. Serialize it with milestone/clock updates using the same local aggregate lock/version. Commit finding, append-only evidence and transactional outbox together. Repeated sweeps produce one transition per target/clock revision; catch up at milestone processing too. A failed aggregate must not starve unrelated jobs. Cancellation propagates and failed transactions remain retryable. No warning percentage or critical threshold is inferred; initially emit configured target breaches only.

Use separate versioned `ContractSla…` event types with target kind, snapshot/clock revision, origin, due, observed/effective time, source references and finding. Do not emit `StageSLABreached.v1` without a real stage. Extend internal supervisor notifications and reporting with separate target counts; duplicate events cannot create repeated requests. This does not prove external customer delivery or legal compliance.

Expose nullable terms in agreement creation/detail/renewal and a supervise-authorized, versioned terms amendment with reason, hash receipt and before/after evidence. Require the operator to select clock origin when enabling either duration. Copy terms into renewal drafts without copying execution clocks/findings. Show response/completion target, explicit origin, named display zone, deadline, actual milestone and honest state: unconfigured, waiting, pending, met, late, cancelled or review. Keep the existing stage timer separately labelled. Customer reads remain scoped to its agreements/jobs; technicians remain scoped to assigned work.

Append new customer and work-order migrations with nullable legacy defaults, positive-duration/origin/state checks, evidence uniqueness and UPDATE/DELETE/TRUNCATE rejection. Add EF append-only guards and runtime SELECT/INSERT-only evidence grants. Do not edit applied migrations or reinterpret old stage metrics.

## Required proof before enabling

Test unset terms, one/both targets, missing origin, invalid durations and unchanged stage behavior; future maintenance generation with no premature clock; creation versus appointment origins; UTC elapsed arithmetic across DST; exact deadline and early achievement; monotonic booking/reschedule/cancel revisions; start/completion before booking delivery; duplicate and delayed facts; corrected overdue findings; outbox rollback/retry and concurrent sweep/milestone; contract amendment/renewal snapshot isolation; authorization, migration upgrades and append-only ACLs. Then run real booking→start→completion→SLA evidence/notification journeys and desktop/phone controls. Pending business configuration is represented by unset terms, not invented numbers or a claim that targets passed.
