# Architecture diagram inventory

These 15 editable Mermaid sources reconstruct the checked-in implementation. They describe the local synthetic-data environment. They do not certify production readiness, successful cloud deployment, or a native feature demonstration.

Source inspection occurred during presentation preparation on 2026-11-05. Application files may continue changing while the presentation is assembled; final presentation evidence should identify the delivered Git revision and current executed test reports.

## Rendered assets and validation

Each Mermaid source has a matching SVG under `rendered/`. These assets were rendered in Chromium with Mermaid 11.12.2 and Segoe UI. All 15 sources passed Mermaid parsing, all 15 exported SVGs parsed as XML, and automated bounds checks found no text outside the SVG view boxes. The exports use native SVG text and contain no `foreignObject` elements. White relationship-label backgrounds preserve contrast in the warehouse ER diagram.

Individual visual review corrected a state-diagram semicolon artifact, overlapping multiline group headings, broken queue-name wrapping and warehouse relationship-label contrast. Detailed sequences and the full star schema remain reference diagrams: use a readable full-width view, focused explanation or appendix placement rather than shrinking the entire diagram into a small slide column. The editable source remains the authoritative diagram content.

## Visual and relationship conventions

- Solid directed edges show synchronous HTTP, database access or local component flow. An edge label identifies any special protocol or permission.
- Dashed directed edges show asynchronous events, best-effort live updates or an explicitly labeled logical reference. The database ownership view uses dashed edges for cross-service identifiers, never for physical foreign keys.
- Database cylinders identify stores. A shared cylinder in the high-level container diagram compresses six separately owned databases; the ownership view expands that boundary.
- Blue identifies application logic, green identifies owned data, gray identifies infrastructure, and amber/red identifies retry, warning, failure or unfinished work where applicable. Text labels carry the meaning independently of color.
- The warehouse ER view shows physical foreign keys within one warehouse. Optional dimension relationships reflect nullable keys. Its seven dimensions and six facts include the additional observed technician time-off fact introduced by migration 004.
- One PostgreSQL container hosts eight separate logical databases locally: six business-service databases, the warehouse and Keycloak. This is database ownership, not eight isolated database servers.
- The sources use no customer addresses, secrets, tokens, generated credentials or private production data.

## Sources and intended use

| Editable source | Primary idea | Repository evidence |
|---|---|---|
| [01 System context](01-system-context.mmd) | Six roles, platform boundary, identity and optional traces | [Role policies](../../../building-blocks/FieldOps.ServiceHost/Bootstrap.cs), [resource authorization](../../../building-blocks/FieldOps.ServiceHost/Security.cs), [trace availability](../../../building-blocks/FieldOps.ServiceHost/TraceProbe.cs) |
| [02 Containers](02-container-architecture.mmd) | Real runtime containers and synchronous/asynchronous paths | [Compose](../../../docker-compose.yml), [YARP routes](../../../gateway/Program.cs), [event consumers](../../../building-blocks/FieldOps.ServiceHost/Messaging.cs), [warehouse worker](../../../analytics/ingestion-worker/worker.py) |
| [03 Components](03-workflow-components.mmd) | Workflow endpoint, domain rules, atomic state/outbox and sweep | [Operations API](../../../building-blocks/FieldOps.ServiceHost/OperationsApi.cs), [workflow rules](../../../building-blocks/FieldOps.Core/WorkflowEngine.cs), [templates](../../../building-blocks/FieldOps.Core/Templates.cs), [persistence](../../../building-blocks/FieldOps.ServiceHost/Persistence.cs) |
| [04 Deployment](04-local-deployment.mmd) | Loopback ingress, private network, owner migrations and runtime grants | [Compose](../../../docker-compose.yml), [service Dockerfile](../../../infrastructure/docker/Dockerfile.service), [schema migrator](../../../building-blocks/FieldOps.ServiceHost/SchemaMigrator.cs), [grant policy](../../../infrastructure/postgres/grants-warehouse-runtime.sql) |
| [05 Authentication](05-authentication-sequence.mmd) | Real code/S256 PKCE with repeated gateway/service checks | [Browser identity](../../../apps/web/src/auth.tsx), [native identity](../../../apps/technician-mobile/src/auth.tsx), [YARP validation](../../../gateway/Program.cs), [service validation](../../../building-blocks/FieldOps.ServiceHost/Bootstrap.cs) |
| [06 API request](06-api-request-and-outbox.mmd) | Order creation commits before eventual reporting visibility | [Create endpoint](../../../building-blocks/FieldOps.ServiceHost/OperationsApi.cs), [event factory/persistence](../../../building-blocks/FieldOps.ServiceHost/Persistence.cs), [outbox dispatch](../../../building-blocks/FieldOps.ServiceHost/Messaging.cs) |
| [07 Events and failure](07-event-driven-communication.mmd) | Durable fanout, independent queues, retries and terminal evidence | [MassTransit registration](../../../building-blocks/FieldOps.ServiceHost/Bootstrap.cs), [consumer](../../../building-blocks/FieldOps.ServiceHost/Messaging.cs), [fault monitor](../../../building-blocks/FieldOps.ServiceHost/FaultMonitor.cs), [Python retry topology](../../../analytics/ingestion-worker/worker.py) |
| [08 Workflow state](08-guided-workflow-state.mmd) | Eight ordered stages, current-form validation and guarded progression | [HVAC JSON v1](../../../building-blocks/FieldOps.Core/WorkflowTemplates/hvac-v1.json), [state rules](../../../building-blocks/FieldOps.Core/WorkflowEngine.cs), [instance constraints](../../../services/workflows/migrations/002_data_integrity.sql) |
| [09 SLA lifecycle](09-sla-lifecycle.mmd) | Durable 20/25/30-minute thresholds and preserved breach evidence | [Policy/evaluation](../../../building-blocks/FieldOps.Core/WorkflowEngine.cs), [Quartz sweep](../../../building-blocks/FieldOps.ServiceHost/Messaging.cs), [causal milestone events](../../../building-blocks/FieldOps.ServiceHost/SlaAudit.cs), [development override](../../../infrastructure/docker/compose.demo.yml) |
| [10 Database ownership](10-database-architecture.mmd) | Logical databases, tables and cross-service reference boundaries | [Role-specific model](../../../building-blocks/FieldOps.ServiceHost/Persistence.cs), [scheduling exclusion](../../../services/scheduling/migrations/002_booking_constraints.sql), [technician FK](../../../services/technicians/migrations/003_relationship_integrity.sql), [append-only evidence](../../../services/reporting/migrations/002_append_only_evidence.sql) |
| [11 Warehouse ER](11-warehouse-star-schema.mmd) | Fact grain and actual dimension/ledger relationships | [Initial star schema](../../../analytics/migrations/001_star_schema.sql), [SCD2 and time off](../../../analytics/migrations/004_technician_scd2_and_time_off.sql), [database invariants](../../../analytics/migrations/005_database_invariants.sql), [projection logic](../../../analytics/ingestion-worker/worker.py) |
| [12 Dispatch optimization](12-scheduling-optimization.mmd) | Feasible appointment advice, independent validation and final reservation | [Operational adapter](../../../building-blocks/FieldOps.ServiceHost/SchedulingRecommendations.cs), [booking validation](../../../building-blocks/FieldOps.Core/WorkflowEngine.cs), [CP-SAT](../../../intelligence/fieldops_intelligence/scheduling.py), [measured synthetic evaluation](../../../intelligence/evaluation/REPORT.md) |
| [13 Replay](13-operational-replay.mmd) | Original evidence, separate delivery observations and read-only reconstruction | [Ordering/reconstruction](../../../building-blocks/FieldOps.Core/ReplayEngine.cs), [delivery semantics](../../../building-blocks/FieldOps.Core/DeliveryObservations.cs), [investigation API](../../../building-blocks/FieldOps.ServiceHost/ReportingApi.cs), [fault evidence](../../../building-blocks/FieldOps.ServiceHost/FaultMonitor.cs) |
| [14 Offline mobile](14-mobile-offline-synchronization.mmd) | Owner-scoped persistence, stable retries and explicit conflicts | [Durable queue](../../../apps/technician-mobile/src/offline/queue.ts), [runtime/cache](../../../apps/technician-mobile/src/runtime.tsx), [session generation guard](../../../apps/technician-mobile/src/session-lifecycle.ts), [backend submission](../../../building-blocks/FieldOps.ServiceHost/OperationsApi.cs) |
| [15 CI validation](15-ci-validation.mmd) | Configured build/test/security pipeline and its evidence boundary | [GitHub Actions workflow](../../../.github/workflows/validate.yml), [source secret guard](../../../scripts/check-secrets.py), [live notification test](../../../apps/web/scripts/check-live-notifications.mjs), [runtime grant verifier](../../../scripts/verify-database-permissions.py) |

## Accuracy notes for the presenter

The Workflows aggregate persists stage snapshots in JSONB. There is no separately normalized operational stage-transition table. A work order, booking and workflow retain identifiers across service boundaries; the application validates those prerequisites through HTTP rather than using cross-database foreign keys.

The outbox publishes at least once. A crash after broker confirmation and before publication-state commit can publish the same event again. Inbox/event-ledger identities deduplicate the business action, while delivery observations preserve useful retry evidence. A successful Reporting delivery does not establish that a failed Notifications consumer recovered.

A 25-minute critical warning still targets the technician. The 30-minute breach triggers supervisor escalation. A sweep can catch up several missing milestones after downtime, so diagram positions are policy milestones, not guaranteed wall-clock arrival times. The development demonstration explicitly substitutes seconds for minutes.

The current checked-in warehouse contains technician SCD2 and observed time-off support. Its reconstruction is limited by retained source events, and missing authoritative capacity stays unknown. Other dimensions do not automatically become SCD2. Verify the applied migration and test evidence before describing these additions as runtime-demonstrated.

Operational optimization evaluates one fixed appointment with actual scoped data. The synthetic multi-job benchmark is a separate path. Zero route/depot coordinates in the operational adapter mean travel remains unavailable; recommendations reserve no capacity until final booking rechecks constraints and commits.

Replay playback changes a read cursor and reconstructed state. It never executes a booking or workflow command. Trace IDs survive independently of bounded Jaeger retention. The application checks order membership and availability before offering the separate engineering trace link.

Native drafts and query caches use AsyncStorage, without application-level encryption. Native tokens use SecureStore. Automatic queue retries honor backoff; a user-triggered synchronization can ignore timing while preserving blocked conflicts/failed operations and stable operation identity. Client time never determines SLA deadlines.

The CI diagram describes configured command paths. It does not claim a remote Actions run, production cloud deployment, signed mobile release, complete ASVS assessment or full accessibility certification.

