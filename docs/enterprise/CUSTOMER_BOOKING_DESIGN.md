# Customer booking implementation design

Prepared 18 November 2026 from the current repository and capability-one requirements in the enterprise brief. This is a design for the next vertical slice, not implemented or verified booking functionality. All nine requested enterprise capabilities remain in scope.

## Existing authority and gaps

| Current source | Verified behavior and required extension |
|---|---|
| [CustomerPortalApi.cs](../../building-blocks/FieldOps.ServiceHost/CustomerPortalApi.cs) | Signed `CustomerScope` pins customer, team and subject. The portal reads its own orders and appointments; it cannot book, move or cancel. Its appointment query derives permitted order IDs through the work-order owner. |
| [WorkflowEngine.cs](../../building-blocks/FieldOps.Core/WorkflowEngine.cs), `BookingRules` | Validates positive duration up to eight hours, team/availability, category skill, the current fixed `HVAC Safety` certificate requirement, technician-local daily hours, and time off. There are no working-day, territory, travel, lead-time or customer cancellation rules. Certificates are name arrays without expiry evidence. |
| [Models.cs](../../building-blocks/FieldOps.Core/Models.cs), `Booking` | Scheduling owns the canonical work-order/technician/time/status/version record, including the durable service-start claim. Reuse this record as `AppointmentBooking`; do not create another confirmed appointment ledger. |
| [002_booking_constraints.sql](../../services/scheduling/migrations/002_booking_constraints.sql), [003_data_integrity.sql](../../services/scheduling/migrations/003_data_integrity.sql) | PostgreSQL prevents overlapping Confirmed bookings and multiple Confirmed bookings for one order. Allowed statuses currently exclude holds. New capacity states require an additive migration. |
| [AssignmentOfferApi.cs](../../building-blocks/FieldOps.ServiceHost/AssignmentOfferApi.cs) | Supplies shared order locks, assignment revisions, cancellation fences, receipts and capacity checks. Offers are proposals and do not currently reserve technician capacity. |
| [BookingExecutionRules.cs](../../building-blocks/FieldOps.Core/BookingExecutionRules.cs), [006_service_execution_claim.sql](../../services/scheduling/migrations/006_service_execution_claim.sql) | Service start, cancellation and rescheduling share the scheduling order lock. A started booking must remain Confirmed. Preserve this guard in every customer mutation. |
| [Customers.cs](../../building-blocks/FieldOps.Core/Customers.cs), `ServiceLocation` | Stores customer-owned address/status, but no site time zone, territory or route coordinates. The browser zone cannot supply missing site data. |
| [SchedulingRecommendations.cs](../../building-blocks/FieldOps.ServiceHost/SchedulingRecommendations.cs) | Provides staff recommendations for a requested window, not reservable customer options. It explicitly reports unavailable travel data and uses a UTC-day recommendation boundary. Do not relabel this response as travel-validated self-booking availability. |
| [gateway/Program.cs](../../gateway/Program.cs) | The appointment portal route is exact, `/api/customer-portal/appointments`. Extend it to cover new scoped subpaths. The existing per-subject limiter remains active. |

## Ownership and authenticated references

Scheduling owns `AppointmentPolicy`, short-lived `AppointmentOption`, `AppointmentHold` metadata and append-only `BookingAuditRecord`. Customers continues to own sites; technicians continues to own qualifications, hours and time off; work-orders owns eligibility and lifecycle. No new service is required.

`RemoteServices` forwards the caller's JWT. A Customer JWT cannot read the existing operational technician, staff work-order or workflow APIs. Do not broaden those policies or introduce a trusted customer/team header.

Add purpose-specific, Customer-authorized owner reference APIs instead:

- Work-orders returns a scheduling reference only after checking signed customer/team membership against the requested order. Include canonical order, site, category, state and version; reject unqualified intake, terminal orders and missing site references.
- Customers returns only the owned active site's scheduling facts, including its persisted IANA time zone, explicitly configured territory and owner version.
- Technicians exposes a bounded, order-scoped eligibility operation. It must independently validate the caller's owned order/site and derive server-approved requirements, rather than trusting requested skill/team/technician values. Return eligible resource/window decisions without names, other customers' assignments or time-off reasons. Avoid exposing the staff calendar through a new wrapper. If an implementation needs richer private data, add a separately authenticated, least-privilege service port; do not treat a forwarded Customer JWT as service authority.

Owner unavailability is an availability-check failure, not an empty set of valid appointments. Reference checks are point-in-time validations; no distributed transaction is claimed. Scheduling's local cancellation/start fences remain authoritative during commit.

## Explicit policy and availability

Persist versioned policy by authorized team, service category and applicable territory. Require explicit duration, required qualifications, eligible working days/hours, lead time, booking horizon, cancellation cutoff, rescheduling cutoff/limit, slot granularity, option lifetime, hold lifetime and travel-buffer policy. Record how technician certificate validity is established; a name alone must not be described as verified or unexpired evidence.

Self-booking fails closed when applicable policy, active ownership, site time zone, territory coverage or required eligibility data is missing. Local demonstrations may seed clearly synthetic configuration. Do not silently activate self-booking for existing sites or infer territory/time zone from an address or device setting.

Generate candidate instants from real eligible resource windows and current Confirmed/Held occupancy. Validate category duration, skill/certification policy, days/hours, time off, territory, lead/horizon boundaries and configured travel buffers. Store UTC instants; show the site's named zone and offset. Reject nonexistent local times and explicitly resolve or omit ambiguous DST instants. Bound the requested date range and number of generated options.

A configured static travel buffer is a capacity policy, not measured driving time. Do not claim route validation while geocoded/depot/routing data is absent. If policy requires route-based feasibility, suppress self-booking until the required data/provider succeeds.

Each opaque option is scoped to customer/team/actor/order and stores its exact resource/window, relevant owner/policy versions and expiration. The client selects an option ID; it cannot supply an arbitrary technician, duration or UTC window. An option is a short-lived offer of availability and does not reserve capacity.

## Holds and the single capacity ledger

Use the existing `bookings` table for occupied capacity: introduce Held, Released and Expired states plus separate hold metadata for ownership, expiration, intent and optional original booking reference. Retain Confirmed/Cancelled history. Add a unique active Held row per work order, and retain the unique Confirmed row per work order.

The exclusion constraint must cover Held and Confirmed, so dispatch booking, offer acceptance and customer holds cannot allocate the same resource/window. Rescheduling needs an explicit same-order exception: the original Confirmed booking and its replacement Held row may overlap. A viable constraint adds work-order inequality to the resource/range exclusion, with separate one-Held/one-Confirmed uniqueness constraints. Test this against PostgreSQL; merely changing the predicate to include Held would wrongly reject overlapping reschedule holds.

Expired Held rows still block a database exclusion until their persisted state changes. Add a worker and mutation-time cleanup; do not use the current clock in a partial-index predicate. Coordinate expiry and every capacity writer with one documented lock order. Recheck exact expiration under the mutation lock, and use concurrency predicates so expiry and confirmation cannot both win. No hold expiration releases a Confirmed appointment or a service-start claim.

Update `RequireCapacity`, staff direct booking, booking moves, assignment acceptance and cancellation intent handling to respect Held capacity. A work-order cancellation must resolve its live customer holds before reserving cancellation. A pending technician offer remains a proposal; a successful competing customer commitment revokes it through the existing audited path.

## Mutation workflows

All commands recheck signed ownership, applicable policy, current eligibility, cancellation fence and service-start state. Use the shared scheduling order lock and consistent capacity-lock ordering. Reload tracked state after locking. A database conflict returns 409 and refresh guidance; it never becomes a successful optimistic appointment.

| Command | Transactional result |
|---|---|
| Hold option | Validate non-expired scoped option and current versions; expire relevant stale holds; claim one Held capacity row and evidence. Identical retries return the same hold; another order competing for its resource/window loses. |
| Confirm hold | Revalidate ownership, hold expiry, policy and source eligibility; promote its canonical Booking to Confirmed, append audit/receipt/outbox and increment the existing assignment revision. |
| Reschedule | Retain the original Confirmed row while obtaining a replacement hold. On confirmation, require the original version and unstarted service, release the hold row and move the original Booking atomically. Failure/hold expiry leaves the original appointment intact. Shared locking decides races with service start. |
| Cancel appointment | Enforce the configured cutoff, expected booking version and unstarted service; cancel the canonical booking, release its pending reschedule hold, and append evidence/receipt/outbox. Do not imply cancellation of the underlying work order. |

Receipts include actor/customer/order/operation scope and a hash of the complete command. Replay a successful identical command after resource authorization; reject changed-payload reuse. Preserve operation IDs across response-loss retries. The portal refreshes the authoritative booking after a command instead of treating a historical receipt as current status.

Reuse `BookingCreated.v1`, `BookingRescheduled.v1`, `BookingCancelled.v1` and `NextAssignmentRevision`, preserving existing work-order and maintenance-visit projections and dispatch visibility. Holds are not Confirmed booking events. Append booking audit, receipt and outbox in the same local transaction. Existing internal notifications may react; external customer delivery remains a later capability and is not proven by event publication.

## Implementation and acceptance gates

1. Add Core appointment rules and scheduling persistence; append the next unused scheduling migration after 007. Add customer-owned site time-zone/territory data and needed technician-owned eligibility data through their own migrations. Preserve applied migrations, existing appointments and isolated runtime permissions.
2. Implement owner reference ports and one scheduling mutation engine reused by the customer and existing allocation paths. Add scoped appointment routes and the gateway catch-all. Return minimal customer DTOs and server-calculated allowed actions.
3. Extend the current Fluent portal with real options, expiring hold/confirmation, committed status, reschedule and cancel. Show site-zone times, expiry/conflict recovery, missing-policy and owner-failure states. Never queue an offline confirmation as a committed booking.
4. Prove the matrix below with domain tests, real PostgreSQL transactions/constraints, authenticated HTTP, existing dispatch regressions and actual desktop/phone browser journeys. Add the tests to CI and record exact local versus external evidence.

| Area | Required negative/concurrent proof |
|---|---|
| Scope and sources | Other customer/team/actor/order IDs; changed site/category/policy; forged resource/window; missing owner; owner timeout; staff routes remain unauthorized to Customer. |
| Time and policy | Exact option/hold expiry, lead/cutoff boundaries, site zone differing from device/technician, DST gaps/folds, local midnight, weekly hours, duration, time off, certification, territory and travel-buffer failures. |
| Capacity and recovery | Two customers competing for one slot; hold versus dispatch/offer acceptance; duplicate commands; changed operation payload; abandoned hold; expiry versus confirmation; rollback/outbox failure and response loss. |
| Lifecycle | Reschedule hold overlapping its own original appointment; failed reschedule preserves original; cancel/reschedule versus begin-service; pending work-order cancellation; monotonic projection revisions; no duplicate Confirmed job or repeated notification request. |
| Interface and migration | Fresh/upgrade databases and retained history; append-only audit/runtime ACLs; real options→hold→confirm→dispatch; reschedule/cancel; desktop/phone bounds, offline/conflict recovery and accurate named-zone display. |

No code, endpoint, migration or test in this phase is established by this document. Production infrastructure, actual routing/provider data and later notification delivery require their own evidence.
