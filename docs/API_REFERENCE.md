# API Reference

Current customer intake, assignment-offer, service-start/cancellation fencing and completed-report APIs are documented with ownership and permissions in [Business operations](BUSINESS_OPERATIONS.md#apis-and-events). Offer request/response examples are in [Assignment offers](ASSIGNMENT_OFFERS.md). These extend the earlier endpoint catalog below.

## Base URLs and authentication

| Endpoint | URL |
|---|---|
| Web application | `http://localhost:8088` |
| Gateway | `http://localhost:5100` |
| Keycloak | `http://localhost:8080` |
| Optimizer (private) | `http://optimizer:8000` inside Compose only |

All business APIs require a Keycloak-issued bearer token. The browser and mobile clients use Authorization Code + PKCE. The gateway validates the token, and each service validates it again and enforces its own policy.

Requests should include `Authorization: Bearer <token>`. The SignalR hub additionally accepts the documented query token only on `/hubs/notifications`; other APIs do not accept query authentication.

The gateway adds or preserves `X-Correlation-ID`, strips spoofed internal identity headers, and returns `Cache-Control: no-store` on API responses.

## Role policy summary

| Policy | Roles | Used by |
|---|---|---|
| `operational` | Technician, Dispatcher, Supervisor, Operations Manager, Administrator | Work-order, technician, booking, workflow reads and execution-adjacent operations. |
| `execute` | Technician, Supervisor, Operations Manager, Administrator | Workflow start/submit and assistance requests. |
| `dispatch` | Dispatcher, Supervisor, Operations Manager, Administrator | Customer/asset registries and dispatch mutations. |
| `supervise` | Supervisor, Operations Manager, Administrator | Pause, resume, override. |
| `report` | Analyst, Supervisor, Operations Manager, Administrator | Warehouse summary, registry reports, exports. |
| `replay` | Supervisor, Operations Manager, Administrator | Replay reads and exports. |
| `admin` | Administrator | Replay projection rebuild. |
| `optimizer` (gateway) | Dispatcher, Supervisor, Operations Manager, Administrator | `/api/optimizer/*`. |
| `customer` | Customer | Exact signed organization account, equipment, requests, appointments and safe work-order views. |
| `intake` | Customer, Dispatcher, Supervisor, Operations Manager, Administrator | Requests filtered by signed customer membership or office team. |
| `service-report` | Customer plus operational roles | Completed reports; customer exact order ownership checked separately. |

Resource-level checks further restrict teams and technicians. A valid role does not grant access to another team's order. Technicians see only their own assigned work and profile.

## Gateway and health

| Method | Path | Notes |
|---|---|---|
| `GET` | `/health/live` | Gateway process liveness; anonymous. |
| `GET` | `/health/ready` | Aggregated readiness; anonymous; 503 when a required business service is unhealthy. |
| `GET` | `/api/session` | Signed identity, team, and distinct roles. |
| `GET` | `/health` | Optimizer readiness (private container). |
| `POST` | `/api/optimizer/optimize` | Authenticated proxy to the private optimizer. |

## Customers

| Method | Path | Policy | Purpose |
|---|---|---|---|
| `GET` | `/api/customers` | dispatch | List/search customers. |
| `GET` | `/api/customers/{id}` | dispatch | Customer, contacts, and locations. |
| `POST` | `/api/customers` | dispatch | Create a customer with contacts and locations. |
| `PUT` | `/api/customers/{id}` | dispatch | Update with expected version. |
| `GET` | `/api/customers/{id}/history` | dispatch | Versioned change history. |
| `GET` | `/api/customers/{id}/service-context?workOrderId={orderId}` | operational | Assigned-technician customer context, scoped by work order. |

## Assets

| Method | Path | Policy | Purpose |
|---|---|---|---|
| `GET` | `/api/assets` | dispatch | List/search equipment. |
| `GET` | `/api/assets/{id}` | dispatch | Equipment details. |
| `POST` | `/api/assets` | dispatch | Register equipment. |
| `PUT` | `/api/assets/{id}` | dispatch | Update with expected version. |
| `GET` | `/api/assets/{id}/history` | dispatch | Location and change history. |
| `GET` | `/api/assets/{id}/reference` | dispatch | Office-only asset reference. |
| `GET` | `/api/assets/by-work-order/{workOrderId}` | operational | Assigned-work equipment list. |
| `GET` | `/api/assets/{id}/service-context?workOrderId={orderId}` | operational | Assigned-work equipment context. |

## Work orders

| Method | Path | Policy | Purpose |
|---|---|---|---|
| `GET` | `/api/work-orders` | operational | Team- and role-scoped list. |
| `GET` | `/api/work-orders/{id}` | operational | Order details. |
| `GET` | `/api/work-orders/by-customer/{customerId}?page=&pageSize=` | operational | Customer service history. |
| `GET` | `/api/work-orders/by-asset/{assetId}?page=&pageSize=` | operational | Equipment service history. |
| `POST` | `/api/work-orders` | operational | Create a request. Requires a registered customer/location or an unregistered-customer reason. |
| `PUT` | `/api/work-orders/{id}` | operational | Update title/priority/status with expected version. Cancellation is rejected while a confirmed booking exists. |
| `PUT` | `/api/work-orders/{id}/asset` | dispatch | Link or unlink an asset. |

Create example:

```json
{
  "title": "Rooftop unit not cooling",
  "serviceCategory": "HVAC",
  "priority": "High",
  "teamId": "north",
  "customerId": "00000000-0000-0000-0000-000000000000",
  "serviceLocationId": "00000000-0000-0000-0000-000000000000"
}
```

For a legacy or unregistered customer, omit the customer/location IDs and provide `unregisteredCustomerReason` and a display name/site address.

## Technicians and bookings

| Method | Path | Policy | Purpose |
|---|---|---|---|
| `GET` | `/api/technicians` | operational | Team-scoped technicians; technician role is self-scoped. |
| `GET` | `/api/technicians/{id}` | operational | Profile and availability. |
| `PUT` | `/api/technicians/{id}` | dispatch | Update profile. |
| `GET` | `/api/technicians/{id}/time-off` | operational | Approved time off. |
| `POST` | `/api/technicians/{id}/time-off` | dispatch | Add time off. |
| `GET` | `/api/bookings` | operational | Scoped bookings. |
| `POST` | `/api/bookings` | dispatch | Confirm a booking after revalidation. `201` on success, `409` on conflict. |
| `PUT` | `/api/bookings/{id}` | dispatch | Reschedule with expected version. |
| `POST` | `/api/bookings/{id}/cancel` | dispatch | Reasoned cancellation. |
| `POST` | `/api/scheduling/recommendations` | dispatch | Baseline or optimized candidates. |

Recommendation request:

```json
{
  "workOrderId": "00000000-0000-0000-0000-000000000000",
  "startUtc": "2026-11-20T14:00:00Z",
  "durationMinutes": 60,
  "strategy": "optimized"
}
```

The response is a ranked candidate list. A recommendation never reserves capacity. The confirmed booking endpoint is authoritative.

## Workflows

| Method | Path | Policy | Purpose |
|---|---|---|---|
| `GET` | `/api/workflows/templates/default` | operational | Current template. |
| `GET` | `/api/workflows/templates/{version}` | operational | Versioned template. |
| `GET` | `/api/workflows?workOrderId=` | operational | Scoped workflows. |
| `GET` | `/api/workflows/{id}` | operational | Workflow, stages, deadlines, answers, history. |
| `POST` | `/api/workflows` | execute | Start the workflow for an assigned order. |
| `POST` | `/api/workflows/{id}/submit` | execute | Submit one stage idempotently. |
| `POST` | `/api/workflows/{id}/pause` | supervise | Pause with a reason. |
| `POST` | `/api/workflows/{id}/resume` | supervise | Resume with a reason. |
| `POST` | `/api/workflows/{id}/override` | supervise | Advance exactly one stage with a reason and target stage. |
| `POST` | `/api/workflows/{id}/assistance` | execute | Request supervisor assistance. |

Stage submission:

```json
{
  "expectedVersion": 4,
  "idempotencyKey": "5f15d6e2-3c84-4b9c-aa30-4ab8b4fc55a1",
  "answers": { "assignment": "Accept", "readiness": "Ready" },
  "clientOccurredAtUtc": "2026-11-13T14:00:00Z",
  "offline": false
}
```

The server rejects stale versions, unknown options, missing required fields, and conditional-field violations. The same idempotency key with the same actor and request returns the stored response.

## Notifications

| Method | Path | Policy | Purpose |
|---|---|---|---|
| `GET` | `/api/notifications` | authenticated, scoped | Retained notification history. |
| `POST` | `/api/notifications/{id}/acknowledge` | authenticated, scoped | Acknowledge an alert. |
| WebSocket | `/hubs/notifications` | authenticated role scope | Live notifications. |

## Reports

| Method | Path | Policy | Purpose |
|---|---|---|---|
| `GET` | `/api/reports/summary` | report | Operational KPIs and trends. |
| `GET` | `/api/reports/export.csv` | report | Order-level CSV. |
| `GET` | `/api/reports/export.pdf` | report | Order-level PDF. |
| `GET` | `/api/reports/customers` | report | Customer registry coverage and freshness. |
| `GET` | `/api/reports/assets` | report | Equipment registry coverage and freshness. |

Summary filters accept `from`, `to`, `technicianId`, `serviceCategory`, and `priority`. The summary labels its warehouse data source and refresh time. An empty population returns `null` for rates that cannot be calculated.

CSV exports neutralize formula-leading cells. PDF exports use a deterministic local PDF writer rather than an external rendering service.

## Operational Replay

| Method | Path | Policy | Purpose |
|---|---|---|---|
| `GET` | `/api/replay/{workOrderId}` | replay | Ordered event timeline and reconstructed state. |
| `GET` | `/api/replay/{workOrderId}/export.csv` | replay | Evidence CSV. |
| `GET` | `/api/replay/{workOrderId}/export.pdf` | replay | Evidence PDF. |
| `GET` | `/api/replay/{workOrderId}/traces/{traceId}/availability` | replay | Confirm authorized trace linkage and Jaeger availability. |
| `POST` | `/api/replay/projections/rebuild` | admin | Rebuild read projections from immutable events. |

Replay accepts optional filters for event type, source service, actor, correlation ID, trace ID, and occurrence range. Evidence is returned read-only.

## Event contracts

The principal integration events are:

- `WorkOrderCreated.v1`, `WorkOrderUpdated.v1`, `WorkOrderAssigned.v1`
- `BookingCreated.v1`, `BookingRescheduled.v1`, `BookingCancelled.v1`
- `CustomerCreated.v1`, `CustomerUpdated.v1`
- `AssetCreated.v1`, `AssetUpdated.v1`
- `WorkflowStarted.v1`, `StageStarted.v1`, `FormSubmitted.v1`, `StageCompleted.v1`, `WorkflowCompleted.v1`
- `StageWarningRaised.v1`, `StageCriticalWarningRaised.v1`, `StageSLABreached.v1`
- `StagePaused.v1`, `StageResumed.v1`, `SupervisorOverrideApplied.v1`, `AssistanceRequested.v1`
- `NotificationAcknowledged.v1`
- `OfflineSubmissionSynchronized.v1`

Each envelope carries an event version, stable event ID, work order, actor, source, correlation/causation, trace/span, occurrence/recording time, and sequence. Event payloads are versioned; consumers use the event type and version rather than assuming a single global schema.

## Errors and conflict handling

- `400`: invalid input, unknown option, or rule violation.
- `401`: missing or invalid bearer token.
- `403`: authenticated but not authorized by role/policy.
- `404`: resource absent or intentionally hidden by team/resource scope.
- `409`: stale version, conflicting booking, or invalid lifecycle transition.
- `429`: rate limited by the gateway.
- `502`/`503`: upstream optimizer or dependent service unavailable.

Errors use the ASP.NET problem-details shape (`title`, `status`, `detail`, `traceId` where available). The UI presents the server message rather than inventing a success state.

## Optimizer contract

The optimizer is an internal service; callers should use the gateway. A request contains bounded technicians and jobs with minute offsets:

```json
{
  "technicians": [{
    "id": "tech-01",
    "skills": ["HVAC"],
    "certifications": ["HVAC Safety"],
    "workingHours": { "startMinute": 480, "endMinute": 1020 },
    "availability": [],
    "existingBookings": [],
    "workloadMinutes": 0
  }],
  "jobs": [{
    "id": "00000000-0000-0000-0000-000000000000",
    "requiredSkills": ["HVAC"],
    "requiredCertifications": ["HVAC Safety"],
    "earliestStartMinute": 840,
    "latestEndMinute": 900,
    "durationMinutes": 60,
    "priority": "High"
  }],
  "strategy": "optimized",
  "timeLimitSeconds": 3
}
```

The response includes assignments, unassigned jobs with reasons, solver status, objective bound, runtime, workload metrics, and limitations. The .NET caller independently validates that the selected technician is known, the interval matches the request, and hard constraints hold.
