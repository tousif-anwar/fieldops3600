# Maintenance service completion and entitlement evidence

Implemented locally on 16 November 2026, America/New_York. These changes extend the customer-owned maintenance visit and reuse the existing work-order, scheduling, inbox, audit and transactional outbox boundaries. They do not create another work-order or booking lifecycle.

## Owner-confirmed projection

`MaintenanceVisitConsumer` accepts version-one `WorkOrderCreated.v1` and `WorkOrderCompleted.v1` only from the work-order owner, and `BookingCreated.v1`, `BookingRescheduled.v1` and `BookingCancelled.v1` only from scheduling. Unrelated event types, different declared sources and unsupported event/schema versions do not modify a visit.

The work-order key is the maintenance visit ID. Only a committed dispatch intent with a bound service location can be linked. Work-order events must match the exact agreement, line, customer, team, site, equipment and service category. Booking events must match the committed deterministic job and team. They do not grant entitlement usage.

Processing acquires the existing team `:contracts` PostgreSQL advisory lock and reloads the agreement before checking its inbox event ID. Visit changes, usage, audit evidence, inbox and outbox commit in one transaction. A lost HTTP dispatch response can therefore recover from the authoritative owner's event. Whichever path first links the work order appends `MaintenanceVisitWorkOrderCreated.v1`; the consumer adds it only on the first null-to-job link. Dispatch's HTTP transaction uses the same lock, so a later delivery does not duplicate that evidence.

Scheduling sequence numbers advance the visit's assignment revision monotonically. New bookings and reschedules mark it Scheduled; cancellation of an appointment leaves the service visit Created for dispatch review. Earlier booking revisions cannot undo a later cancellation. Completed service is terminal and cannot be downgraded by a delayed creation or booking event.

## Usage and historical review

A canonical work-order completion records one visit with zero parts cost. It does not invent a material amount, reserve future coverage, or authorize chargeable work. Inventory-derived costing and financial authorization remain separate integration work.

The actual completion instant controls effective dates and usage occurrence time. Current coverage, equipment exclusions and remaining visit allowance must still be eligible. A non-active agreement requires review; an Expired status alone cannot establish whether the previous state was Active or Suspended. An immutable lifecycle status change after the visit's dispatch intent and before completion also requires review, even if the agreement is Active again. Legacy visits without a recorded dispatch event use their generation time as the conservative review boundary.

When coverage is exhausted, changed, suspended, cancelled, expired or otherwise ineligible, the actual service fact remains Completed with its completion event/time. The consumer appends `MaintenanceCompletionReviewRequired.v1`, exposes its reason on the visit and grants no additional usage. It does not retry that business condition indefinitely or erase completed service. Review resolution and any resulting financial authorization remain explicit subsequent work.

The existing unique agreement-line/work-order usage key and terminal completion evidence protect against both redelivery of the same event and a second completion event with a different message ID. Successful visit usage appends `ContractUsageRecorded.v1` and `MaintenanceVisitCompleted.v1` with the source event as causation. The aggregate modification time reflects when recording occurred; usage occurrence retains the actual completion instant.

The manual usage endpoint now requires an owner-confirmed Completed non-maintenance work order whose evaluated agreement, line, customer, team, category and equipment match the requested coverage. Maintenance visits are recorded by the consumer. Manual input is restricted to one visit and zero parts cost until a verified material-cost source exists. Actor-scoped receipts still replay identical requests and reject changed-command reuse.

## Additive schema

`services/customers/migrations/005_maintenance_completion.sql` adds assignment revision, completion timestamp/event, and review-required reason fields to `maintenance_visits`. It constrains completion evidence and adds a unique non-null completion event index. Existing completed rows without new evidence remain valid; history is retained. No applied migration is rewritten.

## Verification

The new `MaintenanceVisitConsumerTests` execute actual customer handlers and transactions on PostgreSQL Testcontainers. They cover concurrent duplicate completion, deterministic lost-response recovery, event ordering, source/reference isolation, exhausted/suspended/cancelled review, suspended-to-expired late delivery, resumed-agreement historical review, outbox failure rollback/retry, and manual handler eligibility/replay. The manual transport test substitutes only the work-order HTTP response contract; live owner integration is a separate check.

The first focused run exposed an insertion-order problem in the synthetic fixture: the database service-location foreign key existed, but EF did not order the new site and bound visit when saved together. The corrected fixture persists the customer/site before the visit, matching the real owner API workflow. The passing focused run then completed 9/9 cases. After adding the historical-state regression, the full backend suite passed **194/194 with zero skips**. Canonical first-link evidence and the aggregate timestamp assertion were added after that run and require the parent's final regression pass.

The parent final regression passed **195/195 backend tests, zero skips**, after the canonical first-link, recording timestamp and lost-response repair changes.

`tests/backend/verify_contracts_http.py` books the generated maintenance order through the real scheduling API, submits every stage of the actual workflow template through the technician identity, waits for work-order completion, and polls the customer agreement until the real broker consumer has recorded its visit and exactly one zero-material-cost usage row. It also verifies that an unrelated uncompleted job and a manual maintenance usage request are rejected. The rebuilt local runtime passed **1/1 in110.3seconds** after migration005. The runtime ACL verifier also passed. This is real local service/broker evidence, not an external or production deployment claim.
