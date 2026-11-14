# Features

## Role workspaces

### Technician

- A role-aware Home that presents assigned work, upcoming visits, notifications, and workflow progress.
- “My work” cards showing the order number, customer, site, priority, and eight-stage completion progress.
- A guided workflow with server-defined fields, conditional questions, read-only history, local drafts, and idempotent submission.
- Stage timers, pause indicators, supervisor assistance requests, and explicit offline/online state.
- Equipment context for an assigned job, including serial number, warranty status, and linked service history when the work order references a registered asset.
- Expo mobile app with SecureStore PKCE, job list, job details, forms, photo/notes support, offline drafts, and a synchronization queue.

### Dispatcher

- Operational overview with unassigned work, today's bookings, conflicts, and recent activity.
- Customer/contact/location registry and equipment registry.
- Work-order creation and filtering with validated customer or unregistered-customer reasons.
- Scheduling board with technician availability, baseline and OR-Tools recommendations, booking confirmation, rescheduling, and cancellation.
- Conflict indicators and an audited manual override path.
- Notification inbox and acknowledgment.

Dispatchers do not receive the Analytics navigation item. Reporting access is intentionally limited to Analysts, Supervisors, Operations Managers, and Administrators.

### Supervisor

- Active-operation overview, at-risk stages, overdue work, and escalation queues.
- Workflow inspection with stage timing and recorded answers.
- Reasoned pause, resume, override, and assistance actions.
- Operational Replay with event timeline, delivery evidence, integrity checks, trace availability, and exports.
- Warehouse analytics for completion, SLA, escalation, category, and utilization trends.

### Operations Manager

- Manager Home and operational KPIs.
- Service performance, workforce utilization, contract-maintenance/service categories, and customer outcome reporting.
- Replay access, now aligned with the UI policy.
- Same operational oversight surfaces as a supervisor where the policy permits.

### Analyst

- Analytics-only workspace with completion, SLA, stage-duration, escalation, category, and utilization figures.
- Explicit metric definitions, report scope, freshness, data-source labeling, and CSV/PDF order-level exports.
- Registry coverage insights without access to customer names, addresses, or operational mutations.
- No work-order mutation, no workflow execution, and no replay access.

### Administrator

- Administration page for identity/configuration orientation and links to Keycloak.
- Privileged replay projection rebuild.
- Full operational access subject to the same resource-scope checks.
- No secret values are displayed in the UI.

## Business workflows

### A. Service request

A dispatcher creates a work order for a registered customer/location/asset, or records an explicit reason when the customer is not yet registered. The work order starts in `Created`. Dispatchers can search, filter, update, and cancel eligible orders. Assignment is a projection of a confirmed booking, not an editable free-text field.

### B. Qualified scheduling

The scheduling board sends a requested start, duration, and strategy to the scheduling service. Hard qualification, hours, time-off, and booking constraints are checked before candidates are returned. The dispatcher confirms a candidate; the database transaction revalidates and commits at most one confirmed booking per work order. Concurrent competing bookings receive a conflict rather than a duplicate assignment.

### C. Contract-style maintenance

The current release does not implement contract entitlement objects or an automated contract-billing workflow. Maintenance work can be created as a normal service request with a service category and scheduled through the same qualified-booking path. Contract management is therefore **partial**: the operational appointment path exists, but contract eligibility and entitlement validation are not represented as first-class data.

### D. Installation request

Installation work can be created as a service request and scheduled through the same category/qualification path. There is no separate installation-review or permit-qualification model in this release. This is **partial**, not a completed installation-management workflow.

### E. Technician execution

A confirmed assignment appears in the technician's My Work list. The technician starts the workflow, completes the eight server-defined stages, and submits each stage with an expected version and idempotency key. Conditional fields are evaluated on the server. Completed stages become read-only. A supervisor can pause, resume, request assistance, or advance one stage with a reason. The terminal stage completes the workflow and emits `WorkflowCompleted.v1`.

### F. SLA monitoring

The server records warning, critical, and breach milestones for each active stage. The normal local configuration uses 20/25/30 minutes; the explicit demo override uses seconds. A restart-safe sweep records overdue state and notifications. Approved pauses are excluded from effective duration while preserving earlier breach evidence.

### G. Notifications

Business events are consumed into retained notifications. The SignalR hub sends live updates to authorized clients, while the REST endpoint provides the persisted history. Notifications are deduplicated by event ID and can be acknowledged. The live check verifies that a technician assistance request reaches a supervisor and remains in history.

### H. Reporting

The analytics worker projects events into the warehouse. The reporting API exposes summary metrics, registry reports, and order-level CSV/PDF exports. Empty cohorts return null rates rather than fabricated zeros. Warehouse freshness is returned explicitly. Reporting is eventually consistent.

### I. Operational Replay

Replay shows the recorded event timeline, causation/ordering evidence, delivery attempts, processing status, and integrity verification. It reconstructs state without re-executing commands. CSV and PDF exports are available to authorized roles. The only write operation is an Administrator-only projection rebuild.

### J. Offline operation

The Expo app stores drafts locally and queues submissions with an idempotency key. Retries preserve the original logical submission. Conflicts stop automatic retries and retain the answers for review. The mobile tests cover queue recreation, concurrent flushes, identity changes, transient failures, and conflict behavior. A native emulator run was not completed in this release.

## Deterministic rules

- Technician qualification requires matching skills and certifications.
- Team membership, working hours, approved time off, and confirmed bookings are checked.
- One confirmed booking per work order is enforced by a PostgreSQL partial unique index.
- SLA deadlines and pause accounting are server-side.
- Overrides advance exactly one stage; final completion requires the terminal form.
- Replay is ordered by causation, source sequence, and authoritative occurrence time, with explicit uncertainty for independent services.
- Warehouse durations exclude invalid negative/overlapping evidence and never substitute zero for missing timestamps.

## Explicit non-features

- Generative AI, LLM chat, embeddings, RAG, and model-download scripts are not part of the release.
- Customer self-service login, customer-initiated booking, contract entitlement validation, and installation permitting are not implemented.
- Dispatcher analytics access is not granted.
- Native Android emulator/device certification was not performed.
- There is no production deployment, billing, or multi-tenant provisioning.
