# FieldOps 360 API reference

Scope updated 2026-11-05 for eight executable business services: Customers, Assets, Work Orders, Technicians, Scheduling, Workflows, Notifications and Reporting. The [compiled endpoint inventory](ENDPOINTS.md) records exact route patterns, inherited authorization policies and inspected image IDs. This reference explains the public contracts and business checks; it does not claim that every listed route was executed during this documentation pass.

Endpoint definitions are [CustomerApi.cs](../../building-blocks/FieldOps.ServiceHost/CustomerApi.cs), [AssetApi.cs](../../building-blocks/FieldOps.ServiceHost/AssetApi.cs), [OperationsApi.cs](../../building-blocks/FieldOps.ServiceHost/OperationsApi.cs), [ReportingApi.cs](../../building-blocks/FieldOps.ServiceHost/ReportingApi.cs), [customer analytics](../../building-blocks/FieldOps.ServiceHost/CustomerAnalytics.cs), [asset analytics](../../building-blocks/FieldOps.ServiceHost/AssetAnalytics.cs), [gateway Program.cs](../../gateway/Program.cs), and the [private intelligence API](../../intelligence/fieldops_intelligence/api.py).

## Transport, identity and errors

The local served application uses `http://localhost:8088` with a same-origin API proxy. The gateway publishes `http://localhost:5100`. All business routes require a Keycloak signed access token with audience `fieldops-api`. Public web/mobile clients use authorization code with S256 PKCE. The private Python service trusts the Compose network and gateway; it has no independently exposed host port or JWT middleware.

Policy abbreviations below are defined in [Bootstrap.cs](../../building-blocks/FieldOps.ServiceHost/Bootstrap.cs):

| Policy | Allowed roles |
|---|---|
| operational | Technician, Dispatcher, Supervisor, OperationsManager, Administrator |
| execute | Technician, Supervisor, OperationsManager, Administrator |
| dispatch | Dispatcher, Supervisor, OperationsManager, Administrator |
| supervise | Supervisor, OperationsManager, Administrator |
| report | Analyst, Supervisor, OperationsManager, Administrator |
| replay | Supervisor, Administrator |
| admin | Administrator |
| intelligence (gateway) | Dispatcher, Supervisor, OperationsManager, Administrator |

Group and endpoint policies both apply. [Caller](../../building-blocks/FieldOps.ServiceHost/Security.cs) additionally enforces team membership and assigned-technician scope. Technician profile/time-off reads are self-scoped. A privileged role does not automatically bypass object ownership; Administrator is the explicit cross-team exception.

JSON uses camelCase. Instants use ISO-8601 with an offset and persist as UTC. ASP.NET validation/domain failures use RFC Problem Details: 400 invalid input, 401 missing/invalid authentication, 403 role denial, 404 missing or hidden resource, 409 stale version/invalid transition/conflict. Optimizer upstream errors can be 502/503. FastAPI model validation returns 422. Do not treat every 404 as proof that an object does not exist.

## Public route inventory

All paths include the displayed `/api` prefix unless noted otherwise. Tables consolidate identical request rules instead of duplicating the DTO definitions.

| Service | Method and route | Policy | Request / response | Validation, errors and relevant events |
|---|---|---|---|---|
| Gateway | GET /api/session | Authenticated | No body; signed subject/name/team/roles | Does not implement role switching |
| Work Orders | GET /api/work-orders | operational | Visible WorkOrder array, newest first, max 500 | Team/assignment predicate; no server pagination/filter contract |
| Work Orders | GET /api/work-orders/{id} | operational | WorkOrder | 404 hidden/missing |
| Work Orders | POST /api/work-orders | dispatch | CreateOrder → 201 WorkOrder + Location | Registered customer + owned active location, or explicit unregistered exception; authoritative customer/version/address snapshots; optional validated equipment; WorkOrderCreated.v1 |
| Work Orders | PUT /api/work-orders/{id} | dispatch | UpdateOrder → WorkOrder | expectedVersion; allowed lifecycle transition; 409 conflict; WorkOrderUpdated.v1 |
| Work Orders | GET /api/work-orders/by-customer/{customerId} | dispatch | page/pageSize → paged WorkOrder result | Validated visible customer; office team scope |
| Work Orders | GET /api/work-orders/by-asset/{assetId} | operational | page/pageSize → paged WorkOrder result | Office owner lookup; technicians receive only their assigned work and cannot enumerate unrelated equipment |
| Work Orders | PUT /api/work-orders/{id}/asset | dispatch | LinkOrderAsset → WorkOrder | expectedVersion; active equipment must match order customer/location/team; terminal orders cannot change equipment; WorkOrderUpdated.v1 |
| Technicians | GET /api/technicians | operational | Visible TechnicianView array | Technicians see self; other operational roles see permitted team |
| Technicians | GET /api/technicians/{id} | operational | TechnicianView | Self/team scope; 404 hidden/missing |
| Technicians | PUT /api/technicians/{id} | supervise | Technician model → TechnicianView | Version, name, ordered 0–24 working hours, valid timezone; TechnicianAvailabilityChanged.v1 |
| Technicians | GET /api/technicians/{id}/time-off | operational | TimeOff array | Self/team scope |
| Technicians | POST /api/technicians/{id}/time-off | supervise | TimeOffRequest → TimeOff | Positive interval, reason 3–240 chars, same-owner FK; TechnicianTimeOffChanged.v1 |
| Scheduling | GET /api/bookings | operational | Visible Booking array, max 1,000 | Team/assignment scope |
| Scheduling | POST /api/bookings | dispatch | CreateBooking → 201 Booking + Location | Live order/profile/time-off validation, skills/certification/hours, exclusion and unique confirmed-order constraints; BookingCreated.v1 |
| Scheduling | PUT /api/bookings/{id} | dispatch | MoveBooking → Booking | expectedVersion, confirmed status, reason 3–240 chars, revalidated constraints; BookingRescheduled.v1 |
| Scheduling | POST /api/bookings/{id}/cancel | dispatch | Intervention → Booking | expectedVersion and reason; BookingCancelled.v1 |
| Scheduling | POST /api/scheduling/recommendations | dispatch | RecommendationRequest → DispatchCandidate[] | 15–480 minutes, whole-minute start, one UTC day, baseline/optimized allowlist; scoped HTTP reads and independent solver result validation |
| Workflows | GET /api/workflows/templates/default | operational | WorkflowTemplate | Configured immutable default version |
| Workflows | GET /api/workflows/templates/{version} | operational | WorkflowTemplate | Unknown version 404 |
| Workflows | GET /api/workflows?workOrderId={id} | operational | WorkflowView[], max 500 | Optional order filter; own assigned/team objects |
| Workflows | GET /api/workflows/{id} | operational | WorkflowView | 404 hidden/missing |
| Workflows | POST /api/workflows | execute | StartWorkflow → 201 or existing WorkflowView | Confirmed booking, valid order and assigned subject; WorkflowStarted.v1 and StageStarted.v1 |
| Workflows | POST /api/workflows/{id}/submit | execute | SubmitStage → WorkflowView | Expected version, stable 8–128 character key, current unpaused stage, pinned allowlists; FormSubmitted/StageCompleted/StageStarted or WorkflowCompleted |
| Workflows | POST /api/workflows/{id}/pause | supervise | Intervention → WorkflowView | Active workflow, reason, catch-up SLA evaluation; StagePaused.v1 |
| Workflows | POST /api/workflows/{id}/resume | supervise | Intervention → WorkflowView | Expected version and reason; StageResumed.v1 |
| Workflows | POST /api/workflows/{id}/override | supervise | Intervention → WorkflowView | targetStageIndex=current+1, cannot bypass final form or paused state; SupervisorOverrideApplied.v1 |
| Workflows | POST /api/workflows/{id}/assistance | execute | Intervention → WorkflowView | Reason and version; AssistanceRequested.v1; does not pause SLA |
| Workflows | POST /api/workflows/{id}/interventions | supervise | RecommendationDecision → WorkflowView | Active workflow, Accepted/Dismissed, finite risk [0,1], allowed feature keys/reason; RecommendationDecisionRecorded.v1 |
| Notifications | GET /api/notifications | operational | Visible Notification[], max 200 | Technician audience/subject filtering; persisted history is authoritative |
| Notifications | POST /api/notifications/{id}/acknowledge | operational | No body → Notification | Object/audience checks; repeated acknowledgment is a no-op; NotificationAcknowledged.v1 |
| Reporting | GET /api/reports/summary | report | ReportFilters query → metrics/trends/definitions | Team scope, half-open creation cohort, explicit nulls; read-only repeatable-read warehouse snapshot |
| Reporting | GET /api/reports/customers | report | Scoped warehouse aggregate | Registered/active/archived customers, location/contact/consent counts, historical-version and ingestion definitions; no names/contact details/addresses |
| Reporting | GET /api/reports/assets | report | Scoped warehouse aggregate | Equipment/status/warranty/linkage metrics from persisted warehouse data; no serial numbers or QR identifiers |
| Reporting | GET /api/reports/export.csv | report | ReportFilters → CSV attachment | Scoped filtered order rows; more than 10,000 requires narrower filters |
| Reporting | GET /api/reports/export.pdf | report | ReportFilters → PDF attachment | Same row loader/boundary as CSV |
| Replay | GET /api/replay/{workOrderId} | replay | ReplayFilters → state/events/summary | Authorized immutable evidence only, not direct operational DB reads |
| Replay | GET /api/replay/{id}/traces/{traceId}/availability | replay | Retention metadata | Valid trace ID and membership in the authorized order; 200 available, 404 not retained, 503 unreachable/config/timeout |
| Replay | GET /api/replay/{id}/export.csv | replay | CSV event timeline | Separate attempts, uncertainty, occurrence/receipt/processing timestamps |
| Replay | GET /api/replay/{id}/export.pdf | replay | PDF factual incident summary | Redacted customer details, facts separate from inferences |
| Replay | POST /api/replay/projections/rebuild | replay + admin | No body → event/order counts | Rebuilds derived state from originals; does not execute business commands |
| Intelligence | POST /api/intelligence/predict | intelligence | PredictionRequest → advisory probability/factors/version/time | Gateway strips prefix and forwards /predict; Pydantic bounded allowlists; synthetic-trained advisory |
| Intelligence | POST /api/intelligence/optimize | intelligence | OptimizationRequest → assignments/metrics/solver status | Raw submitted synthetic/problem data; does not read operational resources or reserve a booking |
| Notifications | /hubs/notifications (SignalR) | operational | Hub protocol; server event `notification` | Signed token, server-selected technician/team/admin groups; query token accepted only on this path |
| Gateway / services | GET /health/live | Anonymous | Health status | Process liveness |
| Gateway / services | /health/ready | Anonymous | 200/503 health status | Gateway checks eight upstream business-service readiness endpoints; exact method metadata is in ENDPOINTS.md |
| Eight services | /metrics (private network) | Internal deployment surface | Prometheus metrics | Not published as a public gateway API |

The operational optimizer path is `/api/scheduling/recommendations`. It constructs one appointment from authorized order/staff/booking/time-off data and validates the returned assignment. Direct `/api/intelligence/optimize` evaluates the caller-supplied problem. Neither route confirms an appointment; POST /api/bookings revalidates and commits the reservation.

## Customer registry and equipment

These are independent operational owners, with logical IDs validated through authenticated APIs rather than cross-database foreign keys. Office registry access uses `dispatch`; the Analyst and Technician roles cannot browse customer/contact or equipment registries. Technician context routes use `operational` and additionally validate a visible, assigned work order.

| Service | Method and route | Policy | Contract and important behavior |
|---|---|---|---|
| Customers | GET /api/customers | dispatch | search?, status?=Active/Archived, sort?=name/-name/-created, page=1, pageSize=25; returns `{items,total,page,pageSize}`; pageSize 1–100 |
| Customers | GET /api/customers/{id} | dispatch | CustomerView including contacts and locations; team scoped |
| Customers | POST /api/customers | dispatch | CreateCustomer → 201 CustomerView; optional `Idempotency-Key` 8–128 chars; same key/different body returns 409 |
| Customers | PUT /api/customers/{id} | dispatch | UpdateCustomer → CustomerView; expectedVersion; team is immutable; omitted prior locations are archived and remain addressable by historical jobs |
| Customers | GET /api/customers/{id}/history | dispatch | Up to 500 latest-first private changes with actor, event type, version, changed field names, consent before/after flags and correlation |
| Customers | GET /api/customers/{id}/service-context?workOrderId={id} | operational | Only the order's matching customer and selected location, contacts and explicit consent flags; assigned technician/team checks; no-store |
| Assets | GET /api/assets | dispatch | search?, status?, assetType?, customerId?, serviceLocationId?, sort?=name/-name/-created/-warranty, page=1, pageSize=25; paged result, pageSize 1–100 |
| Assets | GET /api/assets/{id} | dispatch | AssetView with current customer/location, equipment identity, hierarchy reference, warranty and location history |
| Assets | POST /api/assets | dispatch | CreateAsset → 201 AssetView; validates active customer/location and customerVersion, hierarchy, unique serial/QR identity; optional Idempotency-Key |
| Assets | PUT /api/assets/{id} | dispatch | UpdateAsset → AssetView; expectedVersion; validated location/hierarchy/state; append-only change/location history |
| Assets | GET /api/assets/{id}/history | dispatch | Up to 500 latest-first private changes with actor, version, changed fields and correlation |
| Assets | GET /api/assets/{id}/reference | operational | Minimal owner-scoped identity/status for sibling-service validation; technician requests cannot use this to enumerate equipment |
| Assets | GET /api/assets/by-work-order/{workOrderId} | operational | Non-retired equipment for the visible assigned order's customer/team; no global registry access |
| Assets | GET /api/assets/{id}/service-context?workOrderId={id} | operational | Equipment identity, warranty, QR identity and bounded location history only after order/customer/team authorization; no-store |

`CreateCustomer` contains `displayName`, `customerType`, `teamId`, `preferredChannel`, `contacts[]`, `locations[]` and optional `status=Active`. `UpdateCustomer` replaces `teamId` with `expectedVersion`. Customer types are Residential/Commercial; status is Active/Archived; preferred channel is None/Email/Phone. An active customer needs at least one active location. Maximums are 25 contacts and 100 retained locations.

Contacts contain optional `id` (preserve when editing), `fullName`, nullable `email`/`phone`, `isPrimary`, `emailConsent` and `phoneConsent`. At least one contact detail is required; at most one primary contact is allowed. Consent requires its corresponding contact detail; Email/Phone preference requires a consenting contact. Responses include server-owned `consentUpdatedAtUtc`. Locations contain optional `id`, `name`, `addressLine1`, nullable `addressLine2`, `city`, `region`, `postalCode`, two-letter uppercase `countryCode`, nullable `accessNotes` and `status=Active`. New child records omit IDs; updates preserve IDs from the same customer.

`CreateAsset` contains `name`, `assetType`, `manufacturer`, `model`, `serialNumber`, nullable `qrCode`, `criticality`, `customerId`, `serviceLocationId`, `customerVersion`, nullable `parentAssetId`, `installedAtUtc` and nullable `warrantyEndUtc`. `UpdateAsset` adds `expectedVersion` and `status`. Asset types are HVAC/Refrigeration/Electrical/Plumbing/Controls/Other; criticality is Low/Medium/High/Critical; status is Active/Inactive/Retired. Installation/warranty order, hierarchy cycles/depth and same-customer parent ownership are validated. An equipment record is not a connected telemetry device; IoT registration/telemetry APIs are not implemented by these routes.

Customer and asset changes enter their transactional outboxes and the reporting/warehouse consumers. Customer payloads omit names, addresses and contact details; asset payloads omit serial/QR identity. Their aggregate events use `workOrderId=Guid.Empty` and carry `customerId`/`assetId` in the payload, preventing a phantom work-order fact. Historical work orders retain original customer/address snapshots and nullable registered IDs; migrations do not infer a customer identity from a name.

## DTO dictionary

| DTO | Fields |
|---|---|
| CreateOrder | title, serviceCategory, priority, teamId; registered customerId + serviceLocationId, or customerName + siteAddress + unregisteredCustomerReason; optional assetId |
| UpdateOrder | expectedVersion, title, priority, status |
| LinkOrderAsset | expectedVersion, assetId? (null removes an existing link) |
| CreateBooking | workOrderId, technicianId, startUtc, endUtc, overrideReason? |
| MoveBooking | expectedVersion, startUtc, endUtc, reason |
| StartWorkflow | workOrderId |
| SubmitStage | expectedVersion, idempotencyKey, answers: object of string choices, clientOccurredAtUtc?, offline=false |
| Intervention | expectedVersion, reason, targetStageIndex? |
| TimeOffRequest | startUtc, endUtc, reason |
| RecommendationRequest | workOrderId, startUtc, durationMinutes=60, strategy=baseline |
| RecommendationDecision | expectedVersion, modelVersion, breachRisk, decision, reason, predictedAtUtc?, features? |
| ReportFilters | from?, to?, technicianId?, serviceCategory?, priority? |
| ReplayFilters | eventType?, service?, actor?, correlationId?, traceId?, from?, to? |
| PredictionRequest | serviceCategory, stageIndex, technicianWorkload, historicalStageDurationMinutes, elapsedMinutes, progress, priority, previousDelays, equipmentCategory |
| OptimizationRequest | technicians[], jobs[], strategy=optimized, timeLimitSeconds=3 (0.1–10) |

Supervisor, workflow-stage and SLA report filters are not currently in the actual report endpoint signature. Do not promise those query parameters because they appeared in the original requirements.

## Sanitized contract walkthrough

These values illustrate the actual request/response shape. They are authored synthetic examples, not captured response logs or benchmark evidence. Replace IDs with the actual preceding response when executing.

For registered work, first create or select a customer and location, then send their `customerId` and `serviceLocationId`. The server copies the authoritative name/address and customer version. The standalone example below exercises the explicitly permitted unregistered-customer path; the exception reason is required and persisted. Invalid or partial registered references cannot fall back silently to free text.

```http
POST /api/work-orders
Authorization: Bearer <access-token>
Content-Type: application/json

{"title":"Synthetic rooftop unit inspection","customerName":"Synthetic Customer","siteAddress":"100 Demonstration Avenue","serviceCategory":"HVAC","priority":"High","teamId":"north","unregisteredCustomerReason":"Synthetic walkthrough for an explicitly unregistered customer."}
```

201 response excerpt (server generates number, ID and creation instant):

```json
{"id":"60000000-0000-4000-8000-000000000001","number":"WO-20261104-ABC123","status":"Created","technicianId":null,"version":1,"teamId":"north"}
```

```http
POST /api/scheduling/recommendations
Content-Type: application/json

{"workOrderId":"60000000-0000-4000-8000-000000000001","startUtc":"2026-11-09T15:00:00Z","durationMinutes":60,"strategy":"optimized"}
```

Each candidate contains `technicianId`, `technicianName`, `score`, `bookedMinutes`, `estimatedTravelMinutes`, `explanation[]`, `strategy` and optional solver/runtime/objective metadata. Operational `estimatedTravelMinutes` is null because recorded geocoded travel is unavailable.

```http
POST /api/bookings
Content-Type: application/json

{"workOrderId":"60000000-0000-4000-8000-000000000001","technicianId":"tech-01","startUtc":"2026-11-09T15:00:00Z","endUtc":"2026-11-09T16:00:00Z"}
```

Wait for assignment projection, then authenticate as the assigned technician:

```http
POST /api/workflows
Content-Type: application/json

{"workOrderId":"60000000-0000-4000-8000-000000000001"}
```

```http
POST /api/workflows/60000000-0000-4000-8000-000000000002/submit
Content-Type: application/json

{"expectedVersion":1,"idempotencyKey":"synthetic-accept-0001","answers":{"assignment":"Accept","readiness":"Ready"},"offline":false}
```

The response is the entire WorkflowView: id, workOrderId, technicianId, teamId, templateVersion, currentStageIndex, version, status, stages, startedAtUtc and completedAtUtc. Each stage retains start/deadline/completion/pause/SLA/answers state. A stale version returns 409; do not change the key to disguise an identical retry. Reusing one key with a different request body returns 409.

## Event contract and code walkthrough references

[AuditEvent](../../building-blocks/FieldOps.Core/Models.cs) contains stable event ID/type/version, work order/workflow/stage identity, actor/role/service, correlation/causation, trace/span, occurrence/recording time, source sequence, payload and schema version. MassTransit wraps it in a JSON `message` envelope. Retry attempts are separate [delivery observations](../../building-blocks/FieldOps.Core/DeliveryObservations.cs), not new business actions.

Use these focused examples in the presentation:

1. [Order endpoint and Enqueue](../../building-blocks/FieldOps.ServiceHost/OperationsApi.cs): authorization, validation, aggregate + outbox in one SaveChanges.
2. [OutboxDispatcher / consumer](../../building-blocks/FieldOps.ServiceHost/Messaging.cs): locked publish, retry, inbox and post-commit live delivery.
3. [WorkflowEngine](../../building-blocks/FieldOps.Core/WorkflowEngine.cs) and [SlaAudit](../../building-blocks/FieldOps.ServiceHost/SlaAudit.cs): authoritative transitions and threshold catch-up.
4. [SchedulingRecommendations](../../building-blocks/FieldOps.ServiceHost/SchedulingRecommendations.cs): operational adapter and independent result validation.
5. [Offline queue](../../apps/technician-mobile/src/offline/queue.ts): durable logical operation, owner scope, backoff and explicit conflict.

Evidence tests: [live API](../../tests/integration/test_live_api.py), [resource access](../../tests/backend/verify_resource_authorization_http.py), [optimizer HTTP](../../tests/backend/verify_optimizer_http.py), [gateway](../../tests/security/test_gateway.py). See [feature completion matrix](../engineering/FULL_STACK_FEATURE_COMPLETION_MATRIX.md) for scope and execution-status distinctions.

