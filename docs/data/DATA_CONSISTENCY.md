# Data consistency and business invariants

The **2026-11-05 16:34 UTC** local deployment uses service-owned PostgreSQL transactions and eventual cross-service projections. The [physical catalog](DATA_DICTIONARY.md) establishes SQL-enforced rules; [domain/API source](../../building-blocks/FieldOps.ServiceHost/OperationsApi.cs) establishes validation; executed tests/E2E establish only the scenarios they actually cover.

## Implemented local guarantees

| Invariant | Mechanism / evidence | Remaining limit |
|---|---|---|
| Critical state and outgoing event commit together | Aggregate plus OutboxMessage tracked in one EF SaveChanges transaction | Publisher can redeliver after a crash; no exactly-once broker guarantee |
| Repeated consumer event does not repeat local effect | Inbox receipt plus local projection commit; stable EventId | Consumers must retain receipts for the applicable redelivery horizon |
| Offline/retried stage submission is idempotent | Actor/workflow/key receipt with request hash and saved response; expected Version | Reusing a key with different content conflicts; stale queued versions require explicit recovery, never silent rebase |
| Concurrent confirmed bookings do not overlap | GiST exclusion on technician and `[StartUtc,EndUtc)`; partial unique order index | Independent profile/time-off edits are not locked by the booking transaction |
| Time off belongs to an existing local technician | Same-database FK with RESTRICT; positive interval/version checks | No crew/territory/resource calendar model |
| Workflow has one authoritative order instance | Unique WorkOrderId; pinned template and expected Version | WorkOrderId is an API-validated logical reference, not a cross-database FK |
| Completed workflow stages preserve validation | Ordered engine, required/conditional dropdown fields, server timestamps and aggregate Version | No general inspection authoring, measurements, photo/signature evidence |
| Breach history survives later intervention | Immutable events; stage breached marker retained; explicit role/reason/version | Business override does not fabricate a final completion |
| Original reporting evidence remains append-only at runtime | EF guard, SQL triggers, INSERT/SELECT runtime rights | Database owner/admin can bypass local controls |
| Warehouse duplicates cannot double count | EventId/hash ledger, PKs/unique keys, transaction and ack after commit | Missing source events remain missing until reconciliation |
| Late facts do not regress terminal state | Per-owner source sequence, immutable event facts, SCD2 rules | Source sequences are not globally comparable |

Technician Version, Booking Version, WorkOrder Version and Workflow Version are EF concurrency tokens. `TimeOff.Version` is persisted and checked positive, but the baseline time-off API only creates intervals; there is no general update/delete concurrency workflow. Do not equate a Version column with a fully tested edit lifecycle.

## Cross-service transactions and race boundaries

Scheduling reads the work order, technician and time off through authenticated APIs, then validates eligibility and commits in its own database. A technician profile/time-off change can race those reads; no distributed serializable transaction prevents it. SQL still rejects booking overlap and duplicate confirmed orders. A future calendar change policy needs revalidation/events and explicit conflict resolution across affected bookings.

Booking events update work-order assignment/status asynchronously. Workflow completion updates order completion through a consumer. Clients should display the eventually consistent boundary and refresh. Cancel a confirmed booking before cancelling a Scheduled order and wait for the authoritative projection. Retrying with fabricated versions or editing another service's database is not an acceptable reconciliation strategy.

The warehouse uses local dimension/fact FKs and read-only repeatable-read report snapshots. It does not synchronously validate operational identity or hold operational locks. Registered work orders validate customer/location/version and optional asset references through their owning APIs. Explicit unregistered exceptions require a recorded reason; legacy snapshots are retained without guessed identities. These HTTP checks can race later registry edits, so the order retains the validated revision and authoritative snapshot rather than claiming a distributed transaction.

## Required invariants still missing

| Requirement | Baseline status / required verification |
|---|---|
| Asset belongs to correct customer/location | Implemented owner API validation and local history constraints; full concurrent cross-owner edit/role acceptance remains partial |
| Expired agreement cannot generate maintenance | Missing agreement/recurrence engine; require effective-date/coverage tests |
| Duplicate scheduler run cannot duplicate maintenance orders | Missing occurrence unique key and event-idempotent order generation |
| Parts consumption cannot repeat or make forbidden negative stock | Missing stock ledger/reservation/transaction model; require concurrent commit tests |
| Inspection completion retains original template | Fixed workflow v1 is pinned, but independent inspection version/response/evidence model is missing |
| Repeated delivery cannot issue duplicate invoice | Missing invoice state/unique origin and consumer ledger |
| Financial rounding/currency/precision is correct | Missing pricing/billing model; require decimal arithmetic and explicit rounding policy |
| Equipment alert cannot generate unlimited orders | Missing device/rule/alert and deduplicated generation model |
| Offline field actions replay safely | Implemented for stage submissions only; parts, inspections, photos, signatures and time tracking are absent |

For each new capability, use local PK/FK/unique/check/exclusion rules plus application validation at the correct owner, explicit transaction boundaries, versioned events and replay-safe consumers. Publish only after durable state commit through the existing outbox. Record the real concurrency/failure/reconnect scenarios in the [feature matrix](../engineering/FULL_STACK_FEATURE_COMPLETION_MATRIX.md) before marking a vertical slice complete.

## Asset invariants

| Invariant | Enforcement |
|---|---|
| Equipment belongs to an active, version-matched customer and an active owned location | Customer API validation with expected version before insert/update; no cross-service FK |
| Serial identity is unique within a team, case-insensitively | PostgreSQL partial expression unique index |
| QR identity is unique within a team when present | PostgreSQL partial unique index |
| Hierarchy is acyclic, same-customer, non-retired and at most five levels | Application traversal plus self-referencing FK with RESTRICT |
| Parent cannot be retired while active children exist | Application check under the asset update path |
| Latest location history matches the current customer, location and version | Domain rule plus append-only location table |
| Location and change history are immutable | Mutation-rejecting triggers and service SaveChanges guard |
| Concurrent updates cannot silently overwrite | Integer concurrency token and expected-version check (409) |
| Asset, history and outbox commit atomically | Single EF SaveChanges transaction |
| Analytics cannot accept two different events for one asset revision | Unique `(asset_key, source_version)` plus worker collision check |

Residual risk: customer relocation between validation and commit is not a distributed transaction; the stored `CustomerVersion` makes staleness visible but does not serialize across services.

## Work-order equipment invariants

| Invariant | Enforcement |
|---|---|
| A work order can reference equipment only when it has a registered customer, location and customer version | PostgreSQL `work_orders_asset_requires_registered_customer` check |
| Linked equipment belongs to the same team, customer and service location and is active | Assets `reference` API check before create/link; no cross-service FK |
| Asset references are non-empty UUIDs | PostgreSQL check plus API route validation |
| Closing a work order prevents later equipment changes | Application state check on the link endpoint; stale versions return 409 |
| Equipment links are versioned and auditable | Work-order version increment, outbox `WorkOrderUpdated.v1` event and existing audit trail |
| Older warehouse events cannot erase or overwrite a newer asset link | Source-sequence/occurrence predicate plus `COALESCE` preservation |
| Legacy orders are never attributed to equipment | Nullable column and explicit-reference-only service-history view |
| Asset service history respects team/technician scope | Work Orders `by-asset` query filters team and assigned technician before returning rows |
