# Technical Q&A for FieldOps 360

This preparation guide answers questions about the inspected implementation. Architecture rationale outside an accepted ADR is a retrospective assessment, not a reconstruction of undocumented design conversations. Execution counts and runtime demonstrations can change during presentation preparation; use the dated [verification record](../testing/VERIFICATION.md) and the presentation evidence matrix for the frozen delivery snapshot. Source implementation, an automated test, a screenshot and a successful native demonstration are different evidence levels.

## Architecture and boundaries

### 1. Why use microservices for a fictional team of about 25 technicians?

The brief explicitly requires six independently deployable business services. Work orders, technicians, scheduling, workflows, notifications and reporting therefore have separate ownership and database identities. The accepted ADR also acknowledges that a modular monolith would reduce operational complexity at this scale; no load evidence proves that six services are necessary for throughput. [ADR 001](../adr/001-service-ownership.md)

### 2. What makes these services independent if they share a host library?

Each thin executable selects its service identity, owns its PostgreSQL database and exposes its own routes. The EF model excludes entities belonging to other service identities, while credentials prevent ordinary runtime access to other stores. Shared bootstrap, persistence and transport code reduces duplication but couples infrastructure upgrades, so independent deployment does not imply independent code evolution. [Role-specific EF model](../../building-blocks/FieldOps.ServiceHost/Persistence.cs)

### 3. Does database-per-service mean six PostgreSQL servers?

The local environment uses separate logical databases and roles on one PostgreSQL container. This establishes application ownership boundaries without pretending to supply physical failure isolation. Separate clusters, replication, managed database hosting and recovery objectives require a deployment decision beyond the current Compose environment. [Compose topology](../../docker-compose.yml)

### 4. Is this strict Clean Architecture or full Domain-Driven Design?

The implementation uses pragmatic separation: pure workflow/replay rules live in Core, and the service host coordinates HTTP, authorization, persistence and transport. It does not create an interface, repository or application-service class for every entity, and the repository does not establish strict DDD compliance. Describe the implemented dependency direction rather than attaching a methodology label. [Pattern assessment](../architecture/patterns.md)

### 5. Why not add a separate deployed service for every worker?

Replay ingestion is hosted by Reporting, while warehouse ingestion is an independent Python worker with its own database connection. Splitting every low-volume consumer into a deployment would increase configuration and operations without measured workload justification. The choice can change if ownership or scaling demands emerge. [Current ownership](../architecture/overview.md)

### 6. Which cross-service calls are synchronous, and which are asynchronous?

Scheduling uses authenticated HTTP to validate order and technician prerequisites, and to call the private optimizer. Business changes publish through RabbitMQ to notification, work-order projection, replay and warehouse consumers. HTTP gives immediate validation feedback, while asynchronous projections permit independent recovery and introduce visible lag. [Operations endpoints](../../building-blocks/FieldOps.ServiceHost/OperationsApi.cs), [consumers](../../building-blocks/FieldOps.ServiceHost/Messaging.cs)

## Transactions and reliable messaging

### 7. How does the transactional outbox avoid a database/broker dual-write gap?

A command adds both the business change and an outbox row to its owning EF unit of work. A background dispatcher publishes retained envelopes and marks publication after broker confirmation. A broker outage can delay propagation without requiring the already committed business command to be recreated. [Persistence and enqueue](../../building-blocks/FieldOps.ServiceHost/Persistence.cs), [dispatcher](../../building-blocks/FieldOps.ServiceHost/Messaging.cs)

### 8. Does the outbox deliver exactly once?

No. A process can publish successfully and die before the database records confirmation, causing another publication. Stable event IDs and consumer inboxes make duplicate delivery safe at the application level; this is at-least-once delivery with idempotent effects, not a broker-wide exactly-once guarantee. [Outbox failure-window comment and implementation](../../building-blocks/FieldOps.ServiceHost/Messaging.cs)

### 9. How could multiple dispatcher replicas avoid publishing the same row simultaneously?

The PostgreSQL selection uses row locks with `FOR UPDATE SKIP LOCKED`, a bounded batch and a publication transaction. Another dispatcher can process other eligible rows instead of claiming a locked row. This reduces simultaneous work but does not remove the publish-before-database-commit failure window. [Outbox SQL](../../building-blocks/FieldOps.ServiceHost/Messaging.cs)

### 10. How do consumers deduplicate messages?

Operational consumers derive an inbox identity from service name and original event ID and commit it with their projection changes. A repeated ID takes the duplicate path instead of recreating the business effect, while Reporting may still append a separate delivery observation. Notification event IDs also have a unique index. [Consumer transaction](../../building-blocks/FieldOps.ServiceHost/Messaging.cs), [EF indexes](../../building-blocks/FieldOps.ServiceHost/Persistence.cs)

### 11. What happens when a consumer keeps failing?

MassTransit uses bounded retry intervals, then moves a poison message to the endpoint error queue. Reporting has an independent fault consumer that retains sanitized terminal diagnostics and the original event association. Intermediate retry totals stay unknown when the fault contract cannot establish them; automatic poison-message repair is not implemented. [Fault monitor](../../building-blocks/FieldOps.ServiceHost/FaultMonitor.cs), [retry configuration](../../building-blocks/FieldOps.ServiceHost/Bootstrap.cs)

### 12. How does a producer retry publication?

The outbox increments its attempt count, stores an exception type rather than a raw payload-bearing message, and schedules exponential backoff capped at 300 seconds. Retained event identity and occurrence time remain unchanged. This is publication retry evidence, which is separate from a downstream consumer's delivery attempts. [Dispatcher retry policy](../../building-blocks/FieldOps.ServiceHost/Messaging.cs)

### 13. What consistency does a user see immediately after booking?

The Scheduling database commits the booking transaction immediately, but Work Orders learns the assignment through an event projection. The UI or client must wait for that assignment before starting a workflow and must not treat an unrefreshed order as proof that booking failed. There is no distributed transaction spanning the two databases. [Booking/start endpoints](../../building-blocks/FieldOps.ServiceHost/OperationsApi.cs), [order projection](../../building-blocks/FieldOps.ServiceHost/Messaging.cs)

### 14. Which important cross-service race remains unresolved?

A technician profile or time-off change can race the Scheduling service's prerequisite reads. An order cancellation can also race a booking whose assignment event has not yet projected. PostgreSQL protects booking overlap within its database, while these cross-service configuration/lifecycle races remain explicit limitations rather than distributed serializability claims. [Operational limitations](../../services/OPERATIONS_DEMONSTRATION.md)

## Identity and authorization

### 15. What is the difference between OAuth 2.0 and OIDC in this application?

OAuth supplies the authorization-code/token interaction, while OIDC adds identity/session information. Public web and mobile clients use Keycloak code flow with S256 PKCE, and APIs independently validate bearer access tokens. The app does not collect the user's password or use a frontend role switch as authentication. [Browser-auth ADR](../adr/002-browser-auth.md)

### 16. What does PKCE protect, and what does it not protect?

Each login creates a verifier and sends its derived challenge in the authorization request. The token exchange must prove possession of that verifier, limiting the value of an intercepted authorization code. PKCE does not prevent malicious script code from reading a token already held by the browser, so CSP and avoiding unsafe HTML remain important. [Native login implementation](../../apps/technician-mobile/src/auth.tsx), [browser-auth ADR](../adr/002-browser-auth.md)

### 17. Which JWT checks happen at the gateway?

The gateway validates signing key, issuer, audience and lifetime, with configured clock skew. It maps roles only from signed realm claims and applies a special authorization policy to intelligence routes. Backend services validate tokens again, so gateway access alone does not grant object access. [Gateway authentication](../../gateway/Program.cs), [service bootstrap](../../building-blocks/FieldOps.ServiceHost/Bootstrap.cs)

### 18. How do role permissions differ from resource authorization?

A role policy decides whether a caller may perform a class of action such as dispatch, execute or replay. `Caller` and endpoint predicates further check signed team and assigned-technician scope, returning 404 for hidden objects. A Supervisor role is therefore insufficient to read another team's work order. [Resource policy](../../building-blocks/FieldOps.ServiceHost/Security.cs), [live authorization cases](../../tests/backend/verify_resource_authorization_http.py)

### 19. Can a technician read colleagues' profiles or time-off records?

The list and individual technician/time-off reads are scoped to the technician's own subject unless the caller has a broader authorized role. This prevents same-team membership from exposing peer profile/time-off data to technicians. The live authorization suite explicitly checks those reads. [Technician endpoints](../../building-blocks/FieldOps.ServiceHost/OperationsApi.cs), [HTTP regression](../../tests/backend/verify_resource_authorization_http.py)

### 20. Why does the web application store tokens in memory?

The accepted choice avoids browser persistent token storage and extra server-session infrastructure in this local deployment. A hard refresh can require reentering the sign-in path, potentially reusing the Keycloak session. A BFF with an HttpOnly session cookie would reduce JavaScript token exposure but needs server sessions and CSRF controls. [ADR 002](../adr/002-browser-auth.md)

### 21. How are mobile credentials and account-switch races handled?

Native credentials use Expo SecureStore, while drafts and queued actions live in separate account-scoped storage. Session generations and serialized credential writes prevent an old refresh result from reviving a logged-out session, including a later login to the same account. Discovery/request deadlines and reconnect retries are source-tested behavior; the final native demo must state its own observed boundary. [Session lifecycle](../../apps/technician-mobile/src/session-lifecycle.ts), [regressions](../../tests/mobile/session-lifecycle.test.ts)

### 22. Why accept an access token in the SignalR query string?

Browser WebSocket transport can require that mechanism, so the gateway and notification service accept it only on the notification-hub path. Ordinary API query tokens do not authenticate requests, and the supplied token must still validate. Logging configuration suppresses framework access information that could otherwise expose hub query credentials. [Gateway path restriction](../../gateway/Program.cs), [black-box gateway tests](../../tests/security/test_gateway.py)

### 23. Is local security equivalent to production readiness?

No. The documented controls include real identity validation, resource boundaries, restricted SQL roles, immutable evidence and scoped scanning. The environment still uses loopback HTTP and synthetic data, and production TLS, MFA/device policy, rotation, retention, restore drills and authenticated assessment remain deployment work. [Threat model and remaining controls](../security/threat-model.md)

## Workflow and SLA correctness

### 24. How does the backend stop a technician skipping stages?

The workflow aggregate stores its current index, stage snapshots and optimistic version. Submission targets the current stage, validates its pinned template and activates the next stage only after a valid transition. Completed history remains read only, and a reassignment request cannot silently count as job acceptance. [Workflow rules](../../building-blocks/FieldOps.Core/WorkflowEngine.cs), [workflow tests](../../tests/backend/WorkflowTests.cs)

### 25. How are dropdown options and conditional fields validated?

Versioned backend JSON defines the allowed options and dependencies. The server checks required visible fields, rejects unknown keys/options and rejects hidden-field answers instead of trusting frontend controls. Web/mobile helpers improve usability, while the backend registry remains the authority. [Template registry](../../building-blocks/FieldOps.Core/Templates.cs), [HVAC v1](../../building-blocks/FieldOps.Core/WorkflowTemplates/hvac-v1.json)

### 26. What does template versioning support today?

A workflow persists its template version, and clients resolve that immutable version instead of always loading the newest default. The registry validates definitions and fails unknown versions explicitly. Only HVAC v1 ships; a runtime template authoring/publishing interface is not implemented. [Versioned registry](../../building-blocks/FieldOps.Core/Templates.cs), [template tests](../../tests/backend/TemplateTests.cs)

### 27. How do optimistic concurrency and command idempotency differ?

An expected version rejects a distinct update based on stale state. An idempotency key identifies the same logical submission so an identical retry can return the retained receipt rather than advancing again. Reusing a key with changed content is invalid; silently changing the version would turn a retry into another command. [Submission endpoint](../../building-blocks/FieldOps.ServiceHost/OperationsApi.cs), [offline queue validation](../../apps/technician-mobile/src/offline/queue.ts)

### 28. Why is the browser countdown not the SLA source of truth?

The server persists UTC start/deadline data and evaluates thresholds using its clock. A Quartz sweep checks durable active state after restart, and a late submission evaluates missing threshold transitions before completion. Closing the app, changing device time or retaining an offline draft does not pause the server clock. [SLA engine](../../building-blocks/FieldOps.Core/WorkflowEngine.cs), [sweep](../../building-blocks/FieldOps.ServiceHost/Messaging.cs)

### 29. What are the SLA thresholds and pause semantics?

The normal policy warns at 20 minutes, raises a critical warning at 25 and records breach at 30. Authorized pause/resume requires a reason and excludes approved paused time from effective duration while preserving an already recorded breach. Shortened policies and failure injection are Development-only settings, and deterministic tests use explicit clocks instead of waiting 30 minutes. [Policy and transitions](../../building-blocks/FieldOps.Core/WorkflowEngine.cs), [SLA audit regressions](../../tests/backend/SlaAuditTests.cs)

### 30. Is a supervisor override the same as a successful technician submission?

An override is a separately authorized, reasoned and audited transition. It advances one active stage through its own path and must not fabricate a technician's successful final completion. Replay preserves the actor and action type so an investigator can distinguish normal completion from supervisory control. [Override endpoint and event](../../building-blocks/FieldOps.ServiceHost/OperationsApi.cs), [workflow rules](../../building-blocks/FieldOps.Core/WorkflowEngine.cs)

## Dispatch and predictive intelligence

### 31. What ultimately prevents two concurrent confirmed bookings overlapping?

PostgreSQL has a GiST exclusion constraint on technician identity and half-open appointment ranges for Confirmed bookings. A partial unique index also permits only one confirmed booking per order, and a check requires positive duration. Application prechecks give useful messages, while the database constraint closes the concurrent-write race. [Actual constraints](../../services/scheduling/migrations/002_booking_constraints.sql), [PostgreSQL tests](../../tests/backend/PostgresIntegrationTests.cs)

### 32. How does eligibility validation differ from optimization?

Eligibility enforces hard conditions such as qualification, availability, working hours, time off, duration and overlap. Optimization ranks or selects among feasible choices using its objective and time limit. Booking confirmation rechecks the constraints because a recommendation does not reserve capacity. [Dispatch validation and adapter](../../building-blocks/FieldOps.ServiceHost/SchedulingRecommendations.cs)

### 33. Is the operational optimizer a real route optimizer?

The operational adapter sends actual scoped staff/booking/hour data to OR-Tools for one fixed appointment and validates the returned assignment. Real routing coordinates and traffic data are unavailable, so operational estimated travel remains null. The separate multi-job synthetic evaluation uses an explicit depot-distance proxy and does not prove route-level travel feasibility. [Operational adapter](../../building-blocks/FieldOps.ServiceHost/SchedulingRecommendations.cs), [evaluation](../../intelligence/evaluation/REPORT.md)

### 34. What did the measured optimizer comparison show?

On the recorded six-technician/22-job synthetic dataset, both strategies assigned all 22 jobs. The baseline and time-limited solver returned travel proxies of 647 and 619 minutes, workload standard deviations of 47.17 and 47.96 minutes, and measured runtimes of 6.38 and 3048.46 ms. The solver status was FEASIBLE rather than proven optimal, so this is one measured tradeoff instead of a general improvement guarantee. [Dated report](../../intelligence/evaluation/REPORT.md)

### 35. How does the SLA model avoid obvious target leakage?

The dataset uses one observation per stage and excludes work-order/employee identifiers, final duration and outcome-derived predictors. Chronological partitions assign the first 60% to training, the next 20% to calibration and the final 20% to evaluation. Preprocessing and fitting cannot use the final partition's future labels. [Dataset and training](../../intelligence/fieldops_intelligence/prediction.py), [prediction tests](../../tests/intelligence/test_prediction.py)

### 36. What are the useful model results and their limits?

The dated synthetic report records calibrated logistic F1 0.7540 versus rule F1 0.4424, with ROC-AUC 0.8248 and PR-AUC 0.8373. Its false-alert rate is also higher, 0.2424 versus 0.1703, so improved synthetic detection has a cost. These measurements establish no real-world accuracy, personnel ranking validity or production alert benefit. [Model evaluation](../../intelligence/evaluation/REPORT.md)

### 37. Can predictions automatically reassign or penalize technicians?

The private intelligence service returns advisory probability, factors, model version and a suggested intervention. A supervisor reviews visible assumptions and records an accepted/dismissed decision with a reason; the model does not directly book, pause or mutate workflow state. The submitted provenance is audit evidence, not a cryptographically verified model-result receipt. [Intelligence contract](../../intelligence/README.md), [decision endpoint](../../building-blocks/FieldOps.ServiceHost/OperationsApi.cs)

## Warehouse and metric semantics

### 38. Why maintain a separate analytical warehouse?

A separate worker consumes redacted event envelopes into dimensional facts without connecting to operational databases. Reporting can run historical queries independently of command-service table layout and uses a read-only warehouse identity. This adds ingestion lag and schema/projection work, so freshness and eventual consistency stay visible. [Worker and warehouse design](../../analytics/README.md)

### 39. What are the fact grains and dimension strategy?

The six current fact grains are work order, stage instance, booking, distinct breach event, distinct supervisor-intervention event and observed time-off exception identity. Seven dimensions use surrogate/natural keys; migration 004 and worker helpers implement SCD2 technician epochs, while other dimensions such as supervisor retain type-1 corrections. Migration 005 adds exclusion protection against overlapping technician epochs, but complete earlier history still depends on the source events retained for reconstruction. The customer reference remains explicitly unresolved and synthetic instead of inventing a pseudonymous operational identifier. [Initial star schema](../../analytics/migrations/001_star_schema.sql), [technician history/time off](../../analytics/migrations/004_technician_scd2_and_time_off.sql), [database guards](../../analytics/migrations/005_database_invariants.sql)

### 40. How does warehouse ingestion handle duplicates and late events?

The ingestion ledger deduplicates event IDs and rejects the same ID with changed canonical content. Source-local sequence guards prevent late authoritative updates from regressing terminal state, while late metadata can fill unknown fields. Sequences from different services are not compared as a total global order. [Projection implementation](../../analytics/ingestion-worker/worker.py), [warehouse regressions](../../tests/warehouse/test_projection.py)

### 41. What does completion rate mean, and why do nulls matter?

Completion rate uses completed orders divided by orders with known creation metadata in the selected half-open creation-date cohort. Unknown durations and empty denominators return null rather than an invented zero, while an observed zero remains valid. Date filters, exports and displayed definitions must preserve those distinctions. [Warehouse queries](../../building-blocks/FieldOps.ServiceHost/WarehouseQueries.cs), [cohort correction](../../analytics/migrations/003_known_creation_cohorts.sql)

### 42. How is technician utilization calculated?

It clips confirmed appointment minutes to an explicit UTC interval and divides by overlapping local-shift capacity across the retained SCD2 technician epochs, using timezone/DST rules. Migration 004 excludes weekends by default and subtracts recorded time off; missing authoritative hours, timezone or range still yields unknown capacity. This appointment-overlap population can include orders created before the report interval, so it differs intentionally from creation-cohort order metrics. Separate overlapping time-off records currently sum clipped absence minutes and cap them at shift length rather than computing an interval union, which can overstate absence. A deployed migration establishes code availability, while retained-history completeness and a fresh regression run remain separate evidence. [Current capacity SQL](../../analytics/migrations/004_technician_scd2_and_time_off.sql), [data interpretation](DATA_ARCHITECTURE.md)

### 43. What do the additional analytical patterns represent?

SLA compliance trends group completed stages by UTC completion day, while the duration distribution includes only known completed effective durations. Intervention trends group recorded supervisor actions by UTC date; escalation share counts selected orders with a breach, and scheduling coverage counts selected orders with a confirmed booking. These are defined warehouse populations, not evidence that optimization improved operational efficiency. [Analytics queries](../../building-blocks/FieldOps.ServiceHost/WarehouseAnalytics.cs)

### 44. What does archive backfill prove?

The bounded command reconciles unchanged original JSONL envelopes against ledger hashes and can transactionally project missing events with the same late-event rules. Repeating the same archive is idempotent, and a changed duplicate fails rather than rewriting evidence. Matching the supplied archive proves coverage for that archive, not that the operator retained every original source event. [Backfill command](../../analytics/ingestion-worker/backfill.py)

## Replay and incident investigation

### 45. Is Operational Replay an event-sourced command system?

No. Operational aggregates remain authoritative, while Reporting retains immutable audit originals and builds a separate read projection. Playback moves a historical cursor and reconstructs recorded state without executing service commands or querying every operational database. This supports investigation without making the replay journal an alternate mutation engine. [Replay reconstruction](../../building-blocks/FieldOps.Core/ReplayEngine.cs), [store design](../../replay/event-store/README.md)

### 46. Why not order everything by timestamp?

Device clocks and service arrival times do not establish a reliable total business order. Replay applies causation edges and authoritative source-local sequence edges, then uses timestamps/event IDs for deterministic selection among otherwise independent events. The result flags uncertain order, missing causal parents and cycles instead of hiding incomplete evidence. [Ordering algorithm](../../building-blocks/FieldOps.Core/ReplayEngine.cs)

### 47. How are business events separated from delivery retries?

The immutable original event keeps its stable ID and source occurrence/recording timestamps. Separate append-only delivery rows describe consumer identity, observed attempts, processing status and terminal faults. A failed Notifications delivery can coexist with a successful Reporting delivery, and the UI must not interpret the latter as recovery of every consumer. [Delivery semantics](../../building-blocks/FieldOps.Core/DeliveryObservations.cs), [fault evidence](../../building-blocks/FieldOps.ServiceHost/FaultMonitor.cs)

### 48. How strong is the audit store's immutability?

EF guards, SQL triggers and restricted runtime SELECT/INSERT grants block ordinary evidence modification/deletion. SHA256 verifies that retained original text still matches its stored integrity value, which is why the original body uses text rather than normalized jsonb. A database owner or host administrator can defeat these controls; a same-database hash is not an independent digital signature or backup. [Evidence mapping/guard](../../building-blocks/FieldOps.ServiceHost/Persistence.cs), [append-only migration](../../services/reporting/migrations/002_append_only_evidence.sql)

### 49. Can every recorded trace ID still open in Jaeger?

Trace retention is independent of replay retention and Jaeger is bounded/in-memory locally. The authenticated availability endpoint first checks order/team scope and that the trace ID belongs to retained order evidence, then queries internal Jaeger with a bounded timeout. It distinguishes not-retained from unreachable and only exposes aggregate availability metadata. [Trace probe](../../building-blocks/FieldOps.ServiceHost/TraceProbe.cs), [investigation API](../../building-blocks/FieldOps.ServiceHost/ReportingApi.cs)

### 50. Does the incident summary infer why a technician was late?

The summary reports observed stage deadlines, completion/delay, failures, interventions and outcome. It labels inferences separately and does not manufacture a root cause from temporal coincidence. This is particularly important when an offline action, a consumer failure and an SLA breach occur near one another without proof of causality. [Summary rules](../../building-blocks/FieldOps.Core/IncidentSummary.cs), [summary tests](../../tests/backend/IncidentSummaryTests.cs)

## Mobile, testing and operations

### 51. How does the offline queue preserve a logical action across process death?

It persists owner, workflow/stage, expected version, original client time, answers and stable idempotency key before sending. A retained sending item can retry the same logical request after restart, while owner locks serialize local mutations across remounts. Client time remains evidence and cannot change server SLA enforcement. [Queue implementation](../../apps/technician-mobile/src/offline/queue.ts), [queue regressions](../../tests/mobile/offline-queue.test.ts)

### 52. What does the queue do on conflict or failed authorization?

A 409 becomes a durable conflict requiring review instead of automatic version rebasing. Nontransient 400/403/404 errors become failed actions, while connection/transient/authentication failures back off and retry with the original operation identity. Manual synchronization can ignore retry timing for pending/sending entries, but it does not force blocked conflicts or failed actions through. [Status and retry rules](../../apps/technician-mobile/src/offline/queue.ts)

### 53. Does secure token storage encrypt mobile drafts?

No. Native tokens use SecureStore, but cached queries, drafts and the queue use account-scoped AsyncStorage. Account namespaces prevent ordinary cross-account UI access without supplying application-level encryption against a compromised device. Real customer data needs device management, local encryption/retention and explicit remote-wipe/logout policy. [Mobile storage design and limits](../../apps/technician-mobile/README.md)

### 54. What proves the mobile experience works natively?

APK generation, installation, real OAuth return, session restoration, stage submission and offline recovery are distinct checks. The current documented native entry evidence covers the authenticated dashboard, persisted-session restore and guided-stage entry, while on-device stage submission/offline recovery must remain separately labeled unless the final recording verifies them. Source tests or a Metro bundle cannot substitute for those demonstrations. [Dated execution boundary](../testing/VERIFICATION.md)

### 55. How do tests cover concurrency and time without fragile sleeps?

Pure workflow rules accept explicit timestamps, and backend tests drive warning/pause/breach transitions deterministically. PostgreSQL/Testcontainers cases exercise actual exclusion, concurrency and immutability behavior instead of mocking the database's guarantees. Browser, signed-identity HTTP, mobile persistence and intelligence tests add different evidence layers; their counts are overlapping suites, not a single independent coverage percentage. [Backend cases](../../tests/backend/PostgresIntegrationTests.cs), [clock-driven workflow tests](../../tests/backend/WorkflowTests.cs)

### 56. Is the GitHub Actions pipeline validated in the cloud?

The checked-in workflow configures builds, tests, dependency/secret/security checks and an integrated Compose/browser job using pinned action references. Local command execution demonstrates those paths locally. No remote successful run, external deployment or production adoption is established by the YAML alone. [Actual pipeline](../../.github/workflows/validate.yml)

### 57. What does observability add beyond the replay journal?

OpenTelemetry traces describe technical request/message work, Prometheus captures service metrics, and structured logs aid diagnosis with correlation IDs. Replay preserves a longer-lived business/evidence model with explicit ordering and delivery semantics. A missing span does not invalidate a retained business event, and a healthy liveness endpoint does not prove business dependencies are ready. [Telemetry](../../building-blocks/FieldOps.ServiceHost/Telemetry.cs), [gateway readiness](../../gateway/Program.cs)

### 58. How are schema-owner permissions separated from runtime access?

One-shot migration jobs apply versioned schema changes using owner credentials, then exit. Long-running services use restricted application roles, while warehouse ingestion and reporting have distinct writer and read-only identities. Live permission verification checks prohibited operations and runtime DSNs; production still requires secret rotation and backup/restore discipline. [Migration runner](../../building-blocks/FieldOps.ServiceHost/SchemaMigrator.cs), [live grants verifier](../../scripts/verify-database-permissions.py)

### 59. What is the Digital Operations Simulator status?

The repository has deterministic domain/model/solver scenarios and local resilience scripts for accelerated SLA, retry, terminal faults and broker outage. Those scripts are not a general interactive simulator for arbitrary absence, demand surge and operational what-if modeling. Present a broader Digital Operations Simulator as planned work unless a separate inspected implementation establishes it. [Existing resilience procedure](../../services/OPERATIONS_DEMONSTRATION.md), [evaluation scenarios](../../intelligence/fieldops_intelligence/evaluate.py)

### 60. Which improvements would you prioritize, and why?

This is a retrospective prioritization: complete native submission/offline/conflict demonstrations, finish target-specific TLS/identity/secrets/restore controls, and run a full accessibility assessment before real users depend on the system. Then validate load and operational routing data before making scalability or travel-saving claims, and verify retained technician/time-off history and overlapping-absence handling against the intended working calendars. SCD2 technician history already exists in current source; further work concerns historical completeness, validation and calendar semantics rather than adding the pattern for the first time. The current evidence supports a substantial local engineering system while keeping those release gates visible. [Current data model and caveats](DATA_ARCHITECTURE.md), [known limits and resume state](../IMPLEMENTATION_STATUS.md)

