# Local operational demonstration and evidence

Use the generated local Keycloak accounts and synthetic data only. Start the normal environment with the root deployment guide before applying the optional demonstration settings below. The browser URL and identity redirect URI must match the generated Keycloak realm (`localhost:5173` in the Vite development flow; see the web README for the Compose browser origin).

## Verified command paths

The live suite `python tests/integration/test_live_api.py -v` exercises real Keycloak Authorization Code + PKCE, the gateway, all six services, RabbitMQ, immutable replay, and the warehouse. It creates explicitly synthetic records. It checks role boundaries, technician assignment scope, simultaneous overlapping-booking rejection, authorized pause/resume, all eight form stages, duplicate request receipts, offline synchronization metadata, replay integrity and traces, and CSV/PDF exports. It does not prove every requirement in the master brief.

`python tests/backend/verify_optimizer_http.py -v` exercises the actual Scheduling Service → private intelligence `/optimize` HTTP adapter. It compares the operational baseline and optimized advice for the same real scoped appointment, checks a feasible selected technician, solver status, measured runtime, unavailable travel labeling, and invalid-input rejection. It cancels the labeled unbooked verification order afterward. It does not benchmark performance improvements or reserve a booking.

Run backend domain and PostgreSQL concurrency/migration tests with:

```powershell
dotnet build services/FieldOps.Backend.slnx
dotnet test tests/backend/FieldOps.Tests.csproj --no-build
```

Tests using Testcontainers require access to the Docker engine and test runner IPC. A restricted Windows process can compile successfully while being unable to connect to testhost named pipes or loopback sockets. Such a run is **aborted**, not a test pass or a failed business assertion. Record actual executed counts from the TRX output and use an appropriately authorized local shell.

## Accelerated SLA and one controlled consumer failure

Create a local Compose override file, for example `infrastructure/docker/compose.demo.local.yml`, containing:

```yaml
services:
  workflows:
    environment:
      Sla__DurationSeconds: "30"
      Sla__WarningSeconds: "20"
      Sla__CriticalSeconds: "25"
  reporting:
    environment:
      Demo__EnableConsumerFailure: "true"
      Demo__FailEventType: StageWarningRaised.v1
```

Apply it using both files on every demonstration command:

```powershell
docker compose -f docker-compose.yml -f infrastructure/docker/compose.demo.local.yml up -d --build workflows reporting
```

The application rejects accelerated deadlines and failure injection outside `ASPNETCORE_ENVIRONMENT=Development`. These are backend configuration flags; a browser or mobile device cannot advance server time. Existing active stages retain their persisted deadlines, so create a **new** workflow after enabling accelerated thresholds. Do not mix a normal-duration existing stage with the accelerated test and interpret the resulting threshold policy as a production measurement.

1. Sign in as Dispatcher, create a synthetic HVAC order for team `north`, request a feasible appointment recommendation, and confirm a booking.
2. Sign out and sign in as the assigned Technician (`tech-01` for the primary generated account). Start the workflow. Leave its current form unsubmitted.
3. The server's first missing warning appears at approximately 20 seconds, the critical warning at 25 seconds, and breach at 30 seconds. The one-second Development sweep and broker processing add observable scheduling/delivery latency; do not expect exact millisecond arrival.
4. Sign in as Supervisor. Inspect the overdue stage, persisted notification, stage deadline and event history. Acknowledge the alert, approve a pause with a reason, then resume. An existing breach remains evidence even when approved pause time extends the effective deadline.
5. In Replay, inspect the warning's original occurrence/recording time and its separate delivery attempts. The controlled Reporting consumer failure should produce a `Failed` first attempt followed by a successful retry. There should be one logical warning event, with its original event ID and occurrence time preserved.
6. Complete the remaining forms. Refresh a workflow after any 409 version conflict because a server SLA transition may have incremented its version while the form was open. Reusing an identical submitted operation's key returns its original receipt.
7. Open the incident summary, which reports observed stage deadlines, completion time, effective delay, supervisor action reasons, final observed outcome and related trace identifiers. Download CSV and PDF and compare them with the recorded evidence. Missing completion is explicitly unknown; the report does not invent a root cause.

Applying the normal Compose file again restores normal settings for newly created stages:

```powershell
docker compose up -d workflows reporting
```

Retain or clearly label demonstration workflows that already have accelerated persisted deadlines. Changing environment variables is not a history rewrite.

## Broker outage and recovery

Use only the local Compose broker. Stop `rabbitmq`, create a new synthetic work order, and verify that the HTTP mutation still commits with its local outbox record. The UI must not pretend that assignment, notifications or analytics have already propagated. Restart the broker, wait for consumers to reconnect, and verify that the existing event reaches reporting and the warehouse without another order creation.

```powershell
docker compose stop rabbitmq
# Create one labeled synthetic order through the authenticated application.
docker compose start rabbitmq
```

Inspect persisted notification history and the event timeline after reconnect. Compare the producer's occurrence/recording time with Reporting's received/processed time. Publication is at-least-once; consumers deduplicate their event IDs. Do not delete queues, reset outboxes, or fabricate arrival timestamps to make the demonstration look instantaneous.

If a consumer still fails after MassTransit's configured retry intervals (1, 3 and 10 seconds), inspect its `<endpoint>_error` queue. Preserve the message ID, fault metadata and original body. Reporting's separate fault monitor appends `MessageProcessingFailed.v1` and `DeadLetterRecorded.v1` diagnostic evidence without duplicating the original business action. It records sanitized exception type names and the failed consumer when recognized, not raw exception messages or stack traces. Terminal retry counts remain unknown when not established by the fault contract. Automatic dead-letter repair and a generalized record of every intermediate failure across all consumers are not implemented.

To exercise retry exhaustion locally, add `Demo__AlwaysFailConsumer: "true"` alongside `Demo__EnableConsumerFailure: "true"` and one selected `Demo__FailEventType` on **one** business consumer. For example, setting it on Notifications for `AssistanceRequested.v1` tests a consumer failure while Reporting can still ingest the original assistance event. Create a new assistance request; wait for retries to exhaust, then check both the error queue and Replay's terminal diagnostics. Remove the failure override afterward. The monitor has its own queue and is not disabled by the Operational consumer's injected failure. The permanent-failure configuration is rejected outside Development.

## Trace interpretation

HTTP requests create OpenTelemetry traces. Outbox publication restores the original trace context into a `FieldOps` producer activity; MassTransit spans can then appear in the same trace. Background SLA transitions create new trace roots because no HTTP request caused the timer to fire. Notification and work-order projection events preserve causal/correlation metadata from the input event.

- A correlation ID groups a business operation; it is not itself a trace ID or proof of ordering.
- Producer event time, broker delivery attempt time and consumer processing time describe different observations.
- Missing/expired Jaeger spans do not erase immutable business events. Trace retention is configured independently from replay retention.
- A stored trace ID is not a guarantee that the trace is still queryable. The authenticated `/api/replay/{workOrderId}/traces/{traceId}/availability` endpoint first verifies team access and that the trace belongs to this order, then checks internal Jaeger with a three-second timeout. It returns aggregate availability/count only. An expired trace is 404 `not_retained`; an unreachable service is 503 with an explicit reason. The browser opens a public Jaeger trace link only after an available response.
- Independent events without a complete causation relationship may have uncertain relative order. Replay marks uncertainty rather than treating client timestamps as a reliable total order.
- Current notification live delivery is best effort after its database transaction commits. A disconnected client reloads persisted history; there is no guarantee that every transient SignalR message is delivered once.

## Current operational limitations

Technician qualifications, availability and working hours are validated through service requests before a booking is committed. The PostgreSQL exclusion constraint strongly protects overlapping confirmed bookings, but concurrent cross-service profile/time-off edits are not a distributed serializable transaction.

Cancel a confirmed booking first, wait for the work-order projection to return to `Created`, then cancel the work order. The Work Order update API rejects direct cancellation in the `Scheduled` state with HTTP 409 and an explicit booking-first instruction. Automatic cross-service cancellation is not implemented. A cancellation racing an as-yet-unprojected new booking remains a cross-service consistency limitation; event-driven status projection is not a distributed lock.

Dispatch optimization currently evaluates one fixed appointment against the team's actual scoped data. It is not a multi-day route optimizer. Real travel coordinates are unavailable and the operational adapter returns `estimatedTravelMinutes: null`. The separate reproducible optimizer evaluation uses explicitly synthetic depot coordinates.

Prediction advice uses a model evaluated on synthetic data. Operational UI inputs that are not sourced from the current workflow are user-confirmed assumptions. The supervisor decision event stores the submitted advisory snapshot/provenance; it is not a cryptographically verified model-result receipt or an automated personnel decision.

Use the repository's implementation status and actual test reports for acceptance claims. This guide is a reproducible procedure, not a statement that every demonstration step has already passed.
