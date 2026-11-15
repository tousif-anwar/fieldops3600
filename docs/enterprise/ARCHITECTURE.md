# Enterprise capability architecture

Audit date: 15 November 2026. Baseline: `1ea2dffb0bc476326faadb9db3832b1f6733ec0e`, the current `main` source when enterprise work began. This document separates observed implementation from the proposed extension boundaries; it does not certify any of the nine requested capabilities as complete.

## Existing ownership

The eight ASP.NET Core service hosts share implementation assemblies but run with distinct `ServiceIdentity` values, models, PostgreSQL databases, and runtime accounts. This is shared source, not permission to query another service's database. [Bootstrap](../../building-blocks/FieldOps.ServiceHost/Bootstrap.cs) configures the host; [Persistence](../../building-blocks/FieldOps.ServiceHost/Persistence.cs) selects each service's owned entities. [Gateway routes](../../gateway/Program.cs) forward signed authorization and enforce authenticated ingress. [Business operations](../BUSINESS_OPERATIONS.md) records the existing lifecycle and feature boundaries.

| Owner | Authoritative records and existing integration point |
|---|---|
| customers | Customers, contacts, consent, locations, and append-only changes; signed customer membership resolved by `CustomerScope` |
| assets | Equipment identity, customer/location references, warranty date, hierarchy, location history |
| work-orders | Canonical work-order state, service request intake and qualification, assignment projection |
| technicians | Team, skills/certification labels, local working hours, availability and time off |
| scheduling | Confirmed bookings, exclusive offers, allocation revisions, execution claims and recommendation requests |
| workflows | Pinned HVAC templates, ordered stage answers, drafts/idempotent submissions, SLA state, interventions and completed service reports |
| notifications | Retained operational inbox and acknowledgment; event consumption and best-effort SignalR |
| reporting | Append-only audit/delivery observations, replay projections, warehouse-backed reports |
| optimizer | Private Python/FastAPI OR-Tools advice, independently validated by Scheduling |
| gateway / clients | YARP authenticated routing; React 19/TypeScript/Vite/Fluent UI operations and customer portal; Expo/React Native technician client |

No authoritative inventory, contract, estimate, invoice, provider-delivery, object-media, or executable Dataverse aggregate exists in this baseline. A free-text parts answer, warranty date, or conceptual Dataverse mapping is not such an aggregate.

## Extension decisions

Implement one verified slice at a time in the requested dependency order. These are target ownership decisions, not a claim that their implementation exists yet.

| Capability | Boundary | Reason / required integration |
|---|---|---|
| Customer booking | Extend Scheduling | Reuse `Booking`, order allocation locks, skill/availability checks, overlap constraints, execution claims and booking events. Customer-safe options/holds and policy must not create a second appointment source of truth. |
| Inventory | One new Inventory bounded context | On-hand, reservations, movements, transfers and consumption must commit against one stock ledger. The atomicity boundary differs from Work Orders and Assets. Work-order references remain logical and are validated through the owner API. |
| Contracts and recurrence | Commercial modules in one bounded context | Coverage, remaining allowance, usage and recurrence need consistent commercial decisions. Generated visits create existing work orders; Scheduling remains the assignment authority. |
| Estimates and authorization | Commercial modules | Immutable revision snapshots, exact decimal totals and customer authorization evidence share the financial boundary. Approval does not authorize arbitrary later modifications. |
| Billing / costing | Commercial modules | Consume immutable inventory-consumption and approved-estimate facts, retain source IDs, separate cost from charge, and prevent duplicate/covered-service billing. No payroll or payment-card processing is implied. |
| External communication | Extend Notifications | Add persisted preferences/consent, template rendering, delivery attempts and provider adapters to its existing inbox/outbox infrastructure. Local sink acceptance is never external delivery. |
| Secure media | Workflow-owned metadata and a storage port | Owner/assignment/customer checks belong with service evidence. Binary objects remain outside PostgreSQL; sessions, checksums, scan results, access and retention records remain transactional metadata. |
| Dataverse / Power Automate | Optional integration adapter/worker | Core aggregates emit versioned facts without Microsoft-specific dependencies. External identifiers, mappings, conflict policy, checkpoints and retry/audit records belong in the adapter. Actual tenant metadata must validate mappings. |
| Production readiness | Extend deployment/release infrastructure | Preserve service isolation; add controlled environment-specific release, TLS, durable state, backup/restore and immutable-artifact evidence. Kubernetes and certification are not assumed. |

This deliberately avoids nine new service deployments. Inventory has a justified stock-transaction boundary. A Commercial context can hold separate contract, estimate and invoice modules without cross-database financial transactions. Media, notification and booking work should extend established owners. Reassess the optional adapter's independent process only against actual credentials, isolation and deployment needs.

## Cross-context invariants

- Work Orders keeps its existing canonical lifecycle. Inventory/contract/approval/invoice state is related business state, not replacement work-order status strings.
- Customer identity comes from signed `customer_id`, `team_id`, `sub` and role claims. No JSON body or trusted-looking forwarding header can grant membership. Owner APIs must validate customer, asset and order relationships.
- The existing seven-role `Caller.From` logic does not recognize proposed InventoryManager, ContractManager or Finance roles. Any new privilege needs signed realm-role provisioning, explicit endpoint policy, team checks and tests; a hidden navigation item is not an authorization boundary.
- Scheduling uses PostgreSQL allocation advisory locks in [AssignmentOfferApi](../../building-blocks/FieldOps.ServiceHost/AssignmentOfferApi.cs). New hold/booking/reschedule/cancel paths must take the same lock and revalidate availability at commit time. Offered or displayed capacity is not committed capacity.
- Inventory operations need a consistent lock order, database constraints and transactions. Available quantity is on-hand minus reserved. Reserving, transfer receipt, consuming, returning and adjusting need actor/correlation/reason and stable operation IDs. A client cache never writes a balance directly.
- Commercial values use `decimal`, explicit currency precision and rounding. Persist approved/issued snapshots and their source hashes, not a recalculation from mutable rate tables.
- Cross-service references are opaque IDs plus deliberate snapshots. Use owner APIs before commands and versioned events for downstream convergence. Do not add cross-service foreign keys or read another owner's tables.

## Reliability patterns to retain

[Messaging](../../building-blocks/FieldOps.ServiceHost/Messaging.cs) implements a transactional outbox. A dispatcher locks due outbox rows with `FOR UPDATE SKIP LOCKED`, publishes stable event IDs, and stores retry attempts/backoff. Publication is at least once: a crash after broker confirmation can republish. Consumers retain inbox IDs and commit projection changes in a transaction; retries and fault evidence remain explicit.

New commands should follow the existing actor-scoped [idempotency receipt](../../building-blocks/FieldOps.Core/Models.cs) pattern: stable key, request hash, stored response and transactionally committed side effects. Exact replay returns the original result; key reuse with a different request returns a conflict. Version checks and database uniqueness protect concurrent submissions. Do not replace this with a process-local cache.

`AuditEvent` supplies stable event ID, versioned type, actor, correlation, source service, sequence, trace and related order/workflow/stage IDs. Inventory and financial consumers must deduplicate source facts and preserve their origin. Unknown event types must not invent unrelated order facts in Reporting; review its generic projection behavior when adding non-order events.

## Migration and runtime integration checklist

Append numbered SQL under the owning `services/<service>/migrations` directory. [SchemaMigrator](../../building-blocks/FieldOps.ServiceHost/SchemaMigrator.cs) embeds migration resources, normalizes line endings, stores SHA-256 digests, serializes with a PostgreSQL advisory lock and refuses edited applied history. Runtime identities do not own schemas or migration history. Test fresh install, repeated apply, preserved old data, failed-transaction rollback, constraints and race behavior; never reset an existing volume to make a migration pass.

A new host requires deliberate updates to: service project and solution; owned model registration and mapping; embedded SQL resources; `Bootstrap` endpoint/policy/worker registration; gateway route/cluster/readiness; Compose runtime and separate migration job; database owner/runtime provisioning in `scripts/local_databases.py`; non-destructive bootstrap/reconciliation; broker permissions/consumer bindings; monitoring; CI and real regression tests. Existing migration-owner credentials must not enter runtime containers.

## External and production boundaries

Local email/SMS sink, object-store development backend and mocked Dataverse HTTP contracts are valuable test fixtures, not proof of external delivery or Microsoft interoperability. Actual provider credentials, an authorized tenant/schema, target infrastructure, DNS/TLS/secret store, operational owners, legal retention rules and signature jurisdiction must be established before their corresponding live/legal/production claims. Continue independent implementation while those inputs are unavailable; retain exact unverified gates in the handoff/readiness matrix.

The existing Compose stack is explicitly Development: local HTTP auth discovery, Keycloak `start-dev`, generated synthetic users, loopback-published tools and single-host volumes. It provides PostgreSQL/RabbitMQ persistence, non-root .NET application images, internal metrics/tracing, migration/runtime separation and readiness endpoints. These controls do not establish a staging release, tested backup restoration, high availability or certification. The public GitHub Pages presentation is not a production deployment of the authenticated business platform.

## Applied skills

The installed `dotnet-security` instructions were read in full and applied to signed-role/owner enforcement, parameterized SQL distinctions, middleware error handling and file/media trust boundaries. The installed `container-iac-security` instructions were read in full and applied to the Development/production distinction, non-root images, secret separation, internal bindings and backup/TLS gaps. No skill executable or untrusted installer was run by this audit. Repository behavior and tests remain the authority; skill examples are not evidence of platform certification.
