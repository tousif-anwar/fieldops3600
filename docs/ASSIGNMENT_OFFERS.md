# Assignment offers and scheduling integrity

Scheduling owns assignment invitations and confirmed bookings. A pending invitation does not change the work order status, promise a confirmed customer appointment, reserve parts, or reserve technician capacity. Dispatch can choose a direct booking or an offer to one eligible technician. Only one pending offer may exist per work order.

## Workflow and permissions

| Command | Authorized caller | Rules and result |
|---|---|---|
| Create | Dispatcher, Supervisor, OperationsManager, Administrator in team scope | Work order must be Created or Scheduled and have no confirmed booking. Skills, HVAC Safety certification, availability, team, local working hours, time off, and current appointment conflicts are checked. Creates Pending. |
| Accept | Exact offered Technician in the same team | Rechecks current work order, qualifications, time off, hours, and capacity. Creates Confirmed booking and Accepted offer in one scheduling transaction. |
| Decline | Exact offered Technician in the same team | Requires 3–500 character reason. Creates Declined; order remains available for another offer. |
| Revoke | Dispatch role in team scope | Requires 3–500 character reason. Creates Revoked. |
| Expire | Scheduling worker | At expiry, creates Expired and an outbox event. The 15 second sweep resumes after restart; reads and accept validation apply expiry immediately. |
| Direct booking | Dispatch role in team scope | Revalidates booking rules, then revokes an existing invitation in the same transaction as the confirmed booking. |

The appointment must begin in the future when an offer is issued. Expiration must be later than the server's current UTC instant, within 24 hours, and no later than appointment start. Appointments retain the existing maximum eight hour duration rule. Expiration is evaluated against server time, never the device clock. UTC instants are stored; working hours use the technician's configured time zone.

Terminal offer states are Accepted, Declined, Revoked, and Expired. Terminal offers cannot be accepted again. Reoffering creates a new record; previous responses and reasons remain available to authorized office staff and the target technician.

## API

All routes require bearer authentication and service-side authorization:

```text
GET  /api/assignment-offers[?workOrderId=uuid]
POST /api/assignment-offers
POST /api/assignment-offers/{id}/accept
POST /api/assignment-offers/{id}/decline
POST /api/assignment-offers/{id}/revoke
```

Create body:

```json
{
  "workOrderId": "00000000-0000-0000-0000-000000000001",
  "technicianId": "tech-01",
  "startUtc": "2026-11-16T14:00:00Z",
  "endUtc": "2026-11-16T15:00:00Z",
  "expiresAtUtc": "2026-11-13T20:00:00Z",
  "idempotencyKey": "client-generated-operation-uuid"
}
```

Response commands use `{ "expectedVersion": 1, "idempotencyKey": "operation-uuid", "reason": "Required for decline and revoke" }`. Accept returns the offer with its confirmed `bookingId`. Clients refresh bookings after acceptance and allow for the work-order projection's event delivery delay. Commands require connectivity; offline queues must never accept or reserve assignments.

Offer DTO fields: `id`, `workOrderId`, `technicianId`, `teamId`, `workOrderNumber`, `title`, `siteAddress`, `serviceCategory`, `priority`, `startUtc`, `endUtc`, `expiresAtUtc`, `status`, `version`, `createdAtUtc`, `respondedAtUtc`, `reason`, `bookingId`, `requiredSkills`, and `requiredCertifications`. Title and address are operational snapshots validated when dispatch issues an offer. Integration events deliberately omit them.

Lists are team scoped; a technician sees only their own offers. A candidate can read the exact unstarted work order while their own Pending offer is live. The work-order service verifies the invitation against scheduling on every such read. Expiry, decline, and revocation remove candidate access immediately. This grant never permits starting service without a confirmed booking.

## Concurrency, retries, and events

Create and response commands require a client-generated operation key of 8–128 characters. Receipts bind the actor, command, operation key, and request hash. Identical retries return the stored response; changing the payload while reusing a key produces 409. The client must preserve its operation key after an unknown network result.

Scheduling uses transaction-scoped PostgreSQL advisory locks per work order to serialize offers, acceptance, and direct allocation. The partial unique pending-offer index protects invitation exclusivity. The existing unique confirmed-booking index and exclusion constraint remain the final protection against two assignments for one order or overlapping technician appointments. Offer response, booking, idempotency receipt, and outbox records commit together; failure rolls them all back.

Booking-created, rescheduled, and cancelled events use a durable per-work-order scheduling revision from `assignment_revisions`, rather than each booking's local version. Revisions advance under the same allocation lock and roll back with the command transaction. This lets the work-order projection ignore late events from an earlier appointment without clearing a newer assignment. Offer events retain their own offer version and do not advance the confirmed-assignment sequence.

Outbox events are `AssignmentOfferCreated.v1`, `AssignmentOfferAccepted.v1`, `AssignmentOfferDeclined.v1`, `AssignmentOfferRevoked.v1`, and `AssignmentOfferExpired.v1`. Each includes `offerId`, `workOrderId`, `teamId`, `technicianId`, `status`, `startUtc`, `endUtc`, `expiresAtUtc`, `bookingId`, and `reason`. Acceptance also publishes the existing `BookingCreated.v1` event for work-order assignment and warehouse projections. Existing inbox deduplication and notification persistence apply.

Cancellation and rescheduling require a current confirmed booking version, a Created or Scheduled work order, and no service workflow. Once a workflow exists, its appointment is retained and office staff must manage the active service. Active-service transfer is intentionally unsupported; silently changing the technician would leave a workflow assigned to the wrong person.

Before persisting a new workflow, the workflow service calls `POST /api/bookings/{id}/begin-service` with the caller's bearer identity. Scheduling acquires the same allocation lock used by cancellation and rescheduling and sets `ServiceStartedAtUtc`, increments the booking version, and publishes `BookingServiceStarted.v1`. Repeating this command returns the original claim without another event. Cancellation and rescheduling reject a claimed appointment, including the interval before the workflow row is committed. A database check also prevents a claimed booking becoming Cancelled. Thus a simultaneous cancellation and workflow start cannot both acquire the appointment.

The scheduling claim and workflow row belong to different databases. If workflow persistence fails after the claim commits, retrying workflow creation reuses that claim and completes creation. There is no automatic timeout that releases claimed capacity and no unaudited release endpoint. An abandoned claim requires operational recovery; an audited supervisor release/active-service handoff policy remains future work.

Work-order cancellation also uses a scheduling-owned fence. Before committing cancellation of a Created order, the work-order owner calls `POST /api/scheduling/work-orders/{id}/cancel-intent`. Under the allocation lock, scheduling rejects any confirmed appointment, persists `work_order_cancellations`, and revokes pending invitations. Direct booking, offer creation, acceptance, and service start all reject fenced orders. The intent is idempotent and publishes `WorkOrderCancellationReserved.v1` once. A simultaneous new booking and cancellation intent cannot both commit, including when the work-order assignment projection is delayed.

If the work-order database write fails after the intent commits, the fence remains. Dispatch refreshes the work order and retries cancellation with its current version; retrying the scheduling intent succeeds without duplicating it. Capacity is never reopened by a timeout or by losing the HTTP response. A future policy for abandoning cancellation would require a separate audited command; none is exposed in this implementation.

## Verification and limits

```powershell
.\.tools\dotnet\dotnet.exe test tests/backend/FieldOps.Tests.csproj --filter 'FullyQualifiedName~AssignmentOffer|FullyQualifiedName~BookingExecution'
python tests/backend/verify_assignment_offers_http.py
python tests/backend/verify_scheduling_races_http.py
```

The first command runs domain transitions and real PostgreSQL concurrency, rollback, constraints, expiration, and service-start/cancellation race tests. The second requires a rebuilt local Compose stack and real generated Keycloak accounts. It checks authenticated offer creation, decline/reoffer, concurrent acceptance retries, operation-key misuse, direct booking revocation, expiration audit events, notification delivery, role isolation, and qualification rejection. Synthetic orders are labeled; bookings and unstarted test orders are released afterward.

The third command runs real HTTP races for cancellation intent versus booking and service start versus appointment cancellation. When service start wins, it completes the eight-stage workflow through normal APIs and retains the labeled completed service evidence. It also verifies the deployed warehouse consumes a Pending offer's ledger/staging event while leaving the job unassigned with no booking. This local-stack check reads using the deployed analytics container's existing database identity and does not write database rows directly.

Service-owned scheduling transactions protect allocation inside the scheduling database. Technician profile changes and approved time off reside in another service; they are rechecked over authenticated APIs but are not one distributed serializable transaction. A concurrent qualification/time-off change after validation is still a limitation. The work-order assignment display is eventually consistent through RabbitMQ. No claim is made for multi-technician broadcast offers, certification expiration dates, real-time travel estimates, parts readiness, paid compensation, or automatic customer appointment confirmation.
