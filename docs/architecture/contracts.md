# HTTP and event contracts

Gateway prefix `/api`; every business route requires a signed `fieldops-api` access token. Role policies are repeated in the owning service. Resource checks further restrict teams and technician assignments. Requests use JSON, UTC ISO-8601 instants and server-owned string/UUID identifiers. Known validation conflicts return RFC Problem Details with 400, 404 or 409; authentication/permission failures return 401/403.

| Method / path | Policy | Contract |
|---|---|---|
| GET `/session` | Authenticated | Subject, name, team, signed roles |
| GET/POST `/work-orders` | Operational / dispatch | List visible orders; create `{title,customerName,siteAddress,serviceCategory,priority,teamId}` |
| GET/PUT `/work-orders/{id}` | Operational / dispatch | Visible order; update `{expectedVersion,title,priority,status}` |
| GET/PUT `/technicians/{id}` | Operational / supervise | Profile, skills, certifications, timezone, working hours, availability and version |
| GET/POST `/technicians/{id}/time-off` | Operational / supervise | Exceptions `{startUtc,endUtc,reason}` |
| GET/POST `/bookings` | Operational / dispatch | Visible bookings; create `{workOrderId,technicianId,startUtc,endUtc,overrideReason?}` |
| PUT `/bookings/{id}` | Dispatch | Reschedule `{expectedVersion,startUtc,endUtc,reason}` |
| POST `/bookings/{id}/cancel` | Dispatch | `{expectedVersion,reason}` |
| POST `/scheduling/recommendations` | Dispatch | `{workOrderId,startUtc,durationMinutes,strategy}`; explanations and feasible staff |
| GET `/workflows/templates/default` | Operational | Version, stage names and conditional option allowlists |
| GET `/workflows/templates/{version}` | Operational | Immutable configuration pinned by an existing workflow; unknown version returns 404 |
| GET/POST `/workflows` | Operational / execute | Filter by `workOrderId`; start `{workOrderId}` after booking validation |
| POST `/workflows/{id}/submit` | Execute | `{expectedVersion,idempotencyKey,answers,clientOccurredAtUtc?,offline?}` |
| POST `/workflows/{id}/pause`, `/resume`, `/override` | Supervise | `{expectedVersion,reason,targetStageIndex?}` |
| POST `/workflows/{id}/assistance` | Execute | `{expectedVersion,reason}`; does not pause SLA |
| POST `/workflows/{id}/interventions` | Supervise | Advisory model provenance, probability, accepted/dismissed decision and reason |
| GET `/notifications` | Operational | Persisted visible notification history |
| POST `/notifications/{id}/acknowledge` | Operational | Authorized acknowledgment, audit event |
| GET `/reports/summary`, `/export.csv`, `/export.pdf` | Report | Warehouse filters: `from`, `to`, `technicianId`, `serviceCategory`, `priority` |
| GET `/replay/{workOrderId}` | Replay | Optional `eventType`, `service`, `actor`, `correlationId`, `traceId`, `from`, `to` |
| GET `/replay/{id}/export.csv`, `/export.pdf` | Replay | Redacted factual incident evidence and trace metadata |
| GET `/replay/{id}/traces/{traceId}/availability` | Replay | Requires trace membership in the scoped order; retained/not retained/unreachable status and aggregate span count |
| POST `/replay/projections/rebuild` | Administrator | Recover derived replay state from immutable events |
| POST `/intelligence/predict`, `/optimize` | Authorized dispatch/supervision | See `intelligence/README.md`; advisory only |

The SignalR endpoint is `/hubs/notifications`. Browser transport query tokens are accepted only for that hub path. Disconnected clients reconcile from persisted notification history.

## Envelope

`FieldOps.Core.AuditEvent` is published to MassTransit's durable fanout exchange `FieldOps.Core:AuditEvent` using the MassTransit JSON envelope (`message` contains the business event). Required fields: `eventId`, `eventType` including `.v1`, `eventVersion`, `workOrderId`, optional `workflowId` and `stageInstanceId`, `actorId`, `actorRole`, `sourceService`, `correlationId`, optional `causationId`, `traceId`, `spanId`, `occurredAtUtc`, `recordedAtUtc`, source `sequenceNumber`, `eventPayload`, and `schemaVersion`.

Consumers add their own receipt/processing timestamps and delivery attempts. They never replace source occurrence time. Event IDs are stable across publication retries. The warehouse rejects an event ID reused with different canonical content. New schema versions must be explicitly supported; unknown warehouse versions are quarantined after bounded retries.

Work-order events omit customer names and addresses. Workflow payloads include authoritative stage snapshots and selected answers, so replay access is privileged. Reprocessing a logical event never represents a second business action; retry counts live on separate attempt records. A missing causal parent or independent cross-service order is surfaced as uncertainty.

Event ownership: work-order lifecycle belongs to Work Orders; booking lifecycle to Scheduling; availability to Technicians; stage and SLA lifecycle to Workflows; acknowledgment and delivery notices to Notifications. Reporting owns projections, not source business state. Analytics worker owns warehouse facts and ingestion ledger only.
