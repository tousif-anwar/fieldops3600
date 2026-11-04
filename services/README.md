# Backend services

Six ASP.NET Core executables use a shared host library for authentication, error handling, infrastructure, and API registration. Each executable selects exactly one owned EF Core business model and connects to its own PostgreSQL database. The shared library is a code reuse choice, not a shared database or an in-process replacement for microservices. `Scheduling` and `Workflows` validate resources through authenticated service HTTP requests; downstream state changes propagate through RabbitMQ.

| Service | Owned data | API |
|---|---|---|
| Work orders | Order lifecycle and local inbox/outbox | `/api/work-orders` |
| Technicians | Profiles, skills, certifications, hours, time off | `/api/technicians` |
| Scheduling | Confirmed/cancelled bookings | `/api/bookings`, `/api/scheduling/recommendations` |
| Workflows | Versioned template v1, stage instances, deadlines, receipts | `/api/workflows` |
| Notifications | Persisted notification history and acknowledgment | `/api/notifications`, `/hubs/notifications` |
| Reporting | Immutable replay evidence, delivery attempts, replay projection; reporting facts | `/api/reports`, `/api/replay` |

The independent warehouse is connected with `ConnectionStrings:Warehouse`. When configured, report summaries and CSV/PDF exports query that warehouse and fail explicitly if unavailable. Reporting's local facts remain an event-driven operational projection and are not substituted for an unavailable configured warehouse.

## Build and verification

```powershell
dotnet restore services/FieldOps.Backend.slnx
dotnet build services/FieldOps.Backend.slnx --no-restore
dotnet test tests/backend/FieldOps.Tests.csproj --no-build
```

Tests include deterministic SLA/domain/authorization/replay checks and real PostgreSQL 18 Testcontainers checks. Docker must be available for the complete suite. To run only tests without Docker, use `--filter 'Category!=Integration'` and report the integration tests as unexecuted. On this workspace, the locally installed stable SDK/runtime is `.tools/dotnet/dotnet.exe`; it is excluded from Git.

## Startup configuration

- `ConnectionStrings:Database`: required service-owned PostgreSQL database.
- `ConnectionStrings:Warehouse`: read-only reporting warehouse connection, Reporting only.
- `Database:Initialize`: opt-in SQL migration application. Defaults to false. The local Compose environment enables it. For deployment, run once with a migration identity and `--migrate-only`, then use an application identity without DDL privileges.
- `Auth:Authority`: expected public Keycloak issuer, e.g. `http://localhost:8080/realms/fieldops` in local development.
- `Auth:MetadataAddress`: discovery endpoint reachable from the service network.
- `Auth:Audience`: defaults to `fieldops-api`.
- `Auth:RequireHttpsMetadata`: true outside Development; disabling it outside Development is rejected.
- `RabbitMq:Host`, `RabbitMq:VirtualHost`, `RabbitMq:Username`, `RabbitMq:Password`: broker connection.
- `Messaging:Enabled`: defaults to true. Disabling it is useful for isolated HTTP tests; events then remain in the local outbox.
- `Services:WorkOrders`, `Services:Technicians`, `Services:Scheduling`, `Services:Workflows`: service HTTP base URLs. Requests forward the caller's signed bearer token, never an invented identity header.
- `Sla:DurationSeconds`, `Sla:WarningSeconds`, `Sla:CriticalSeconds`: defaults 1800/1200/1500. Shortening the stage deadline below 1800 seconds outside Development is rejected.
- `Demo:EnableConsumerFailure`, `Demo:FailEventType`: Development-only deterministic first-attempt failure injection for a selected event type. The broker owns retry and `_error` queues.

### Schema migrations

Numbered SQL files live with each service under `migrations`. A transactional PostgreSQL advisory lock serializes deployment; `fieldops_schema_migrations` stores each applied migration ID and SHA-256 checksum. Edited applied migrations fail startup rather than silently changing history. Add a new migration for schema evolution. Scheduling's second migration enforces non-overlap, positive duration, and one confirmed booking per work order. Reporting's second migration protects evidence against ordinary SQL updates/deletions.

`building-blocks/FieldOps.SchemaTool` generated the **initial** EF schema scripts before their first deployment. Do not regenerate an applied initial migration. EF models and SQL migrations must be updated together for future changes. Automatically baselining an unknown pre-existing schema is deliberately unsupported.

## Authentication and access

JWT signature, issuer, audience, expiry, and signing key are validated. Keycloak realm roles map to ASP.NET roles. Team claims accept `team_id` (preferred) and `teamId`. Missing team claims confer no team access. Technicians can read/act on their own assigned work only. Dispatch mutations require Dispatcher/Supervisor/OperationsManager/Administrator. Pause, resume, overrides and prediction decisions require Supervisor/OperationsManager/Administrator plus team access. Replay requires Supervisor or Administrator; rebuilding its projection requires Administrator. Analysts receive warehouse aggregates/exports without customer names or addresses and have no operational mutation grant.

Unknown or foreign objects return 404. Missing/invalid authentication returns 401; a valid identity lacking a policy grant receives 403. Critical updates use expected versions and database concurrency tokens. All form options and conditional fields are validated server-side. Browser/mobile state and device timestamps cannot grant access or change authoritative SLA time.

## Core request contracts

All list responses are arrays. Property names are camelCase. Errors use RFC Problem Details with `status`, `title`, `detail`. Datetimes are ISO 8601 UTC. Stage indices are zero-based. Form answers are `{ "fieldKey": "exact configured option" }`.

| Method/path | Request |
|---|---|
| POST `/api/work-orders` | `{title,customerName,siteAddress,serviceCategory,priority,teamId}` |
| PUT `/api/work-orders/{id}` | `{expectedVersion,title,priority,status}`; only cancellation of unstarted work is a manual status transition |
| POST `/api/bookings` | `{workOrderId,technicianId,startUtc,endUtc,overrideReason?}` |
| PUT `/api/bookings/{id}` | `{expectedVersion,startUtc,endUtc,reason}` |
| POST `/api/bookings/{id}/cancel` | `{expectedVersion,reason}` |
| POST `/api/scheduling/recommendations` | `{workOrderId,startUtc,durationMinutes}`; feasible candidates ranked by booked workload, with explanations |
| GET `/api/workflows/templates/default` | Returns `{version,stages:[{index,name,fields:[{key,label,options,required,conditionField?,conditionValue?}]}]}` |
| GET `/api/workflows?workOrderId={id}` | Authorized workflow array |
| POST `/api/workflows` | `{workOrderId}`; confirmed booking required |
| POST `/api/workflows/{id}/submit` | `{expectedVersion,idempotencyKey,answers,clientOccurredAtUtc?,offline?}` |
| POST `/api/workflows/{id}/pause`, `/resume`, `/assistance`, `/override` | `{expectedVersion,reason,targetStageIndex?}`; override advances exactly one active stage and records the reason |
| POST `/api/workflows/{id}/interventions` | `{expectedVersion,modelVersion,breachRisk,decision:"Accepted"\|"Dismissed",reason}`; advisory decision evidence, no automatic reassignment |
| POST `/api/notifications/{id}/acknowledge` | Empty body; duplicate acknowledgment is harmless |
| GET `/api/reports/summary`, `/export.csv`, `/export.pdf` | Optional `from,to,technicianId,serviceCategory,priority` query filters with a half-open date interval |
| GET `/api/replay/{workOrderId}` | Optional `eventType,service,actor,correlationId,traceId,from,to` |
| GET `/api/replay/{workOrderId}/export.csv`, `/export.pdf` | Authorized incident evidence without customer fields |
| POST `/api/replay/projections/rebuild` | Administrator-only rebuild from immutable evidence |

Stage submissions are idempotent per actor/workflow/key. Reusing a key with different request content fails with 409. An identical duplicate returns the original response; refresh afterward to see any subsequent changes. Concurrent distinct submissions use optimistic concurrency so only one stage transition/outbox transaction commits. An SLA sweep may increment the version before a technician submits; the client must refresh on conflict.

## Reliability and observability

Mutations and outbox entries commit in the same EF transaction. The dispatcher uses PostgreSQL `FOR UPDATE SKIP LOCKED`, broker publish confirmation, persisted backoff, and at-least-once delivery. Each consumer commits its local inbox key and side effects together. RabbitMQ retries failures then retains failed messages in MassTransit's `_error` queue. Do not purge these queues during investigation.

Quartz periodically scans persisted active workflow state. Restarting does not reset deadlines or warnings; catch-up emits each missing 20/25/30-minute milestone once. Approved pauses extend deadlines and preserve already-recorded breaches. Countdown rendering never drives backend transitions. SignalR sends `notification` to authenticated technician/team groups; clients reload persisted notifications after reconnect because live delivery is best effort.

`/health/live` reports process liveness; `/health/ready` checks PostgreSQL reachability. MassTransit registers broker health independently. `/metrics` exposes HTTP and FieldOps publication/delivery/retry/delay counters on the internal service network. OpenTelemetry carries HTTP and MassTransit spans and restores originating trace context during outbox publishing. Logs exclude customer payloads and suppress ASP.NET request-start query logging so SignalR bearer query values are not written by default.

## Material boundaries and remaining limitations

- Booking overlap is strongly protected in PostgreSQL. Technician configuration and time-off are validated remotely at command time; changes racing between that validation and booking commit are not a distributed serializable transaction. An organizational reconfiguration needs coordinated rescheduling.
- The operational baseline does not invent route/travel distances. OR-Tools evaluation and ML inference live in the intelligence component; predictions remain advisory and synthetic-data limitations are explicit.
- Reporting records duplicate/successful replay deliveries and the controlled retry demonstration separately from business events. Generalized intermediate failure evidence from every consumer and a full dead-letter management console remain incomplete; RabbitMQ `_error` queues preserve failed messages.
- Template v1 is immutable backend configuration. Publishing/editing new workflow templates through an administrator UI is not implemented.
- Replay event and stage detail queries are intended for this regional workload. A large evidence archive needs pagination, retention automation, and privileged archival tooling.
- The simple PDF writer produces searchable factual text with multiple pages. It uses built-in Helvetica/ASCII substitution, not branded Unicode typesetting.
