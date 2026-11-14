# Project Overview

## The problem

A regional service operation has to coordinate several decisions that are easy to lose in spreadsheets and chat:

- Which technician has the required skill, certification, working hours, and free capacity?
- Is the assigned technician following the required procedure, and how much SLA time remains?
- Which jobs need a dispatcher or supervisor decision now?
- What evidence exists when a customer dispute or an internal incident is reviewed later?

FieldOps 360 keeps those answers in service-owned records instead of relying on a UI state or an operator's memory. Scheduling validates qualifications and availability before a booking is committed. Workflow stages and SLA deadlines are enforced by the server. Supervisor actions retain a reason and enter the audit stream. Operational Replay reconstructs the incident from immutable events rather than re-running commands.

## Scope

The release is a complete local engineering demonstration of the operational side of field service:

- customer, contact, service-location, and equipment registries;
- work-order intake and lifecycle management;
- qualified technician matching and booking;
- an eight-stage HVAC service workflow;
- server-side SLA warning, critical, and breach milestones;
- supervisor intervention and live notifications;
- warehouse-backed operational reporting;
- append-only operational replay with CSV and PDF exports;
- a React operations portal and an Expo technician application.

The system is intentionally not a production SaaS deployment. There is no multi-tenant billing, no customer sign-in portal, no public cloud deployment, and no claim of regulatory certification.

## Roles

| Role | Primary responsibility |
|---|---|
| Technician | Execute assigned service work and submit the guided workflow. |
| Dispatcher | Create and assign work, resolve scheduling conflicts, and monitor the dispatch board. |
| Supervisor | Monitor active operations, SLA risk, escalations, and workflow quality; use Operational Replay. |
| Operations Manager | Review operational KPIs, workforce utilization, service outcomes, and replay evidence. |
| Analyst | Read warehouse reports, data-quality indicators, and exports without operational mutation rights. |
| Administrator | Manage identity/configuration access and perform privileged replay projection rebuilds. |

Customers are represented in the registry but do not authenticate to this release. A customer portal is a documented future capability, not a hidden feature.

## Design principles

1. **Server-authoritative business state.** A browser countdown or mobile cache never decides whether an SLA is breached or whether a stage is complete.
2. **Owned data.** Each service writes only its own PostgreSQL database. Cross-service reads use authenticated APIs or events.
3. **Transactional evidence.** A critical state change and its outbox event commit together. Consumers deduplicate stable event IDs.
4. **Deterministic operations.** Technician matching, booking validation, workflow rules, SLA evaluation, and repair verification use explicit rules. There is no generative-AI dependency.
5. **Honest presentation.** Empty populations produce null rates and explanatory states rather than invented metrics. The UI distinguishes recorded facts from inferences.
6. **Recoverable failure.** Restart-safe SLA sweeps, outbox retries, inbox deduplication, conflict-aware offline synchronization, and replay evidence make failure visible and recoverable.

## Implemented capabilities

- Six-role Keycloak authentication using Authorization Code + PKCE.
- Team- and technician-scoped access enforced in every service, not only in the UI.
- Customer and equipment registries with versioned history.
- Work-order creation, filtering, assignment, rescheduling, and cancellation rules.
- Baseline and OR-Tools CP-SAT dispatch recommendations with independent feasibility validation.
- PostgreSQL protection against overlapping confirmed bookings.
- Eight-stage guided workflow with conditional fields, drafts, idempotent submissions, and read-only history.
- Persisted 20/25/30-minute SLA milestones in the normal local configuration, with an explicit 20/25/30-second demonstration override.
- Supervisor pause, resume, override, and assistance actions with reasons.
- Deduplicated notifications delivered through a live SignalR hub and retained in history.
- Warehouse reporting for completion, SLA, duration, volume, category, utilization, escalations, and registry coverage.
- Operational Replay with event ordering, causation, delivery attempts, integrity checks, trace availability, and exports.
- Expo technician app with SecureStore-backed PKCE, offline drafts, and a conflict-aware synchronization queue.

## Technology choices

| Layer | Choice | Reason |
|---|---|---|
| Backend | .NET 10, ASP.NET Core, EF Core | Strong typing, explicit service boundaries, mature JWT and PostgreSQL support. |
| Data | PostgreSQL per service plus a reporting warehouse | Transactional ownership, constraints, and a separate analytical read path. |
| Messaging | RabbitMQ with MassTransit | Durable event delivery, retries, and clear consumer boundaries. |
| Identity | Keycloak | Standards-based OIDC, realm roles, and team claims without custom password handling. |
| Web | React 19, TypeScript, Fluent UI, TanStack Query | Accessible components, predictable query state, and a maintainable role-aware portal. |
| Mobile | Expo SDK 58, React Native | Shared TypeScript domain logic and native secure storage. |
| Optimization | OR-Tools CP-SAT | A constrained, explainable scheduling model rather than an opaque heuristic. |
| Analytics | PostgreSQL star schema | Transparent SQL metrics, reproducible tests, and no external warehouse dependency. |

## Delivery boundaries

The release distinguishes four levels of status:

- **Complete and verified:** implemented and exercised in the local stack during this release.
- **Implemented but not runtime-verified:** code and deterministic tests exist, but the specific environment was unavailable.
- **Partial:** a workflow works through the operational UI/API but lacks a described external surface.
- **Not implemented:** no claim is made and no placeholder screen is presented as complete.

The customer portal and native emulator run are in the last category. The detailed status is maintained in [Testing and validation](TESTING_AND_VALIDATION.md).
