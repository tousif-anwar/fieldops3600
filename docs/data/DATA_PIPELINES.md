# Data pipelines and event contracts

This document describes source inspected against the **2026-11-05 16:34 UTC** live schema capture. No new cloud pipeline or general-purpose CDC service was found. The authoritative implementation is [Messaging.cs](../../building-blocks/FieldOps.ServiceHost/Messaging.cs), [AuditEvent envelope](../../building-blocks/FieldOps.Core/Models.cs), [warehouse worker](../../analytics/ingestion-worker/worker.py) and [bounded archive backfill](../../analytics/ingestion-worker/backfill.py).

## Operational event path

1. A command validates authorization, resource scope, expected version and business rules. Its own aggregate and `outbox_messages` entry commit in one local EF transaction.
2. The outbox dispatcher publishes the stable EventId using MassTransit/RabbitMQ, with attempts, next retry time and sanitized failure metadata retained locally. A crash between publication and marking published may redeliver.
3. Each .NET service consumer uses a local inbox receipt and commits its projection/event effects together. Its retry/error queue is independent. Reporting retains original event TEXT and integrity hash plus separate delivery/fault observations.
4. The independent Python worker consumes the `FieldOps.Core:AuditEvent` exchange into durable `fieldops-warehouse`. It validates supported schema, canonicalizes/hashes the envelope, checks identity collision, inserts ledger and safe staging, and projects dimensions/facts in the same database transaction. It acknowledges after commit.
5. Python ingestion has bounded retry routing through `.retry`, then `.error`, publisher confirmation and nack/requeue when failure routing fails. Dead letters require investigation; no general automatic repair service exists.

No exactly-once delivery is assumed. Outbox publication, per-consumer inbox receipts, warehouse EventId hashes and workflow HTTP request receipts solve different duplicate/failure problems. Events are not emitted before the state transaction commits.

## Shared versioned envelope

`AuditEvent` carries EventId, EventType (`*.v1`), EventVersion, SchemaVersion, WorkOrderId, optional WorkflowId/StageInstanceId, actor ID/role, source service, CorrelationId/CausationId, trace/span IDs, authoritative occurrence and recorded timestamps, source-local SequenceNumber, and EventPayload. Technician/time-off/customer/asset registry events use Guid.Empty WorkOrderId and carry their own stable IDs in payload. Sequences from different services do not define a global order. Device time is not substituted for authoritative server time.

| Producer | Existing event family | Downstream purpose |
|---|---|---|
| customers | CustomerRegistered.v1, CustomerUpdated.v1 | Customer source-version and location projections; safe counts/classification, no contact values |
| assets | AssetRegistered.v1, AssetUpdated.v1 | Current asset dimension and per-revision change fact; no serial/QR identities |
| work-orders | WorkOrderCreated.v1, WorkOrderUpdated.v1, WorkOrderCompleted.v1 | Reporting originals/replay; warehouse order metadata/lifecycle |
| technicians | TechnicianAvailabilityChanged.v1, TechnicianTimeOffChanged.v1 | Warehouse technician SCD2 and time-off capacity; original evidence |
| scheduling | BookingCreated.v1, BookingRescheduled.v1, BookingCancelled.v1 | Work-order assignment/status projection; warehouse booking snapshot; replay |
| workflows | WorkflowStarted.v1, WorkflowCompleted.v1; FormSubmitted.v1, OfflineSubmissionSynchronized.v1; StageStarted.v1, StageCompleted.v1, StageWarningRaised.v1, StageCriticalWarningRaised.v1, StageSLABreached.v1, StagePaused.v1, StageResumed.v1; SupervisorOverrideApplied.v1; AssistanceRequested.v1; RecommendationDecisionRecorded.v1 | Order progression/completion; alerts; stage facts, breaches/interventions and replay |
| notifications | SupervisorNotificationCreated.v1, NotificationAcknowledged.v1 | Persisted-notice lifecycle and original evidence; no standalone notification warehouse fact |
| reporting fault observer | MessageProcessingFailed.v1, DeadLetterRecorded.v1 | Diagnostic evidence separate from the original business event; unknown retry totals stay unknown |

The event inventory describes actual source families, not a promise that every event yields a fact row. For example, assistance notifications and fault diagnostics can be retained/staged without a dedicated analytical subject. Customer and Asset registry event families are implemented and versioned. InspectionCompleted/PartConsumed/MaintenanceOccurrence/InvoiceIssued/EquipmentAlert families remain absent.

## Warehouse transformation, late data and quality

Only safelisted scalar/array fields enter staging: team/technician, category/priority/status/order number, relevant timestamps, stage metadata/pause/SLA, booking/time-off identity/interval/version, supervisor, skills/certifications and published availability. Customer names, addresses, selected answers and time-off reasons are excluded. The original operational/reporting store has a different retention/privacy boundary.

Accepted events are incremental. An identical EventId/hash is a no-op; changed content under the same ID is rejected. Out-of-order starts cannot erase completed/breached stages; late booking creation cannot revive a cancelled/rescheduled booking; work-order metadata compares only authoritative owner sequence. Placeholder facts/dimensions permit late metadata, but unknown creation rows do not inflate reporting denominators. SCD2 resolves historical technician versions by occurrence and source sequence.

Freshness is eventual: `ingested_at_utc` and order `last_ingested_at_utc` expose observation times. No enforced production freshness SLO, lag alert threshold or guaranteed maximum delay has been established. Reporting reads a consistent read-only repeatable-read snapshot. Warehouse ingestion never reads operational databases directly.

## Reconciliation and recovery

`backfill.py` accepts archived original JSONL envelopes, compares identity/hashes, and defaults to read/count mode. `--apply` validates the archive before projecting missing events in a bounded transaction; replay is idempotent and preserves late terminal state. An operator must validate archive provenance, completeness and access separately. Matching hashes for supplied files cannot prove every original event was archived.

Before repairing a failed event, preserve its original body, EventId, fault metadata, correlation and queue identity; determine schema/validation causes; fix the implementation or data according to ownership; then redeliver the original and verify ledger/fact reconciliation. Do not purge queues, rewrite immutable events, or fabricate replacement IDs to silence errors. Automated backups, off-host archive completeness and tested production recovery remain separate requirements.

New subjects must add migrations, redaction/source mapping, grain, incremental/dedup/late rules, tests, quality/reconciliation and reporting exposure as one slice. [Completion matrix](../engineering/FULL_STACK_FEATURE_COMPLETION_MATRIX.md) prevents an endpoint or table alone from being labeled complete.

## Asset registry pipeline

`AssetRegistered.v1` and `AssetUpdated.v1` are committed to the asset owner's transactional outbox with the asset, location history and change row, then published to RabbitMQ. The warehouse worker validates team scope, opaque identifiers, classification, timestamps and source version; it upserts the customer identity, then `dim_asset` only when the incoming `source_version` is higher. Duplicate delivery is a no-op through the ingestion ledger; a different event carrying an already accepted asset revision is rejected. Stale versions do not overwrite newer state. Freshness is `max(last_ingested_at_utc)`; the report labels this as eventual consistency. Serial numbers, QR identities, customer names, addresses and contact values never enter analytical staging or the warehouse. Manufacturer/model classification attributes are explicitly allowed; arbitrary free text is excluded.

## Work-order asset reference pipeline

`WorkOrderCreated.v1` and `WorkOrderUpdated.v1` include the opaque `assetId` in their allow-listed safe payload. The warehouse worker writes it to `fact_work_order.asset_reference` only when the incoming event wins the existing source-sequence/occurrence ordering gate; an older or duplicate event cannot erase or replace the link. A later update without `assetId` preserves the existing value via `COALESCE`. Invalid UUID evidence is rejected by PostgreSQL and retried/dead-lettered through the existing ingestion path. Serial numbers and QR identities remain outside the event contract and warehouse.

## Customer registry and original-event recovery

`CustomerRegistered.v1` and `CustomerUpdated.v1` publish opaque customer/location IDs, team, source version, classification/status and consent/contact/location counts. The projector retains exact source-version snapshots, resolves inferred order-before-customer placeholders, rejects changed content for an accepted version and prevents late older versions from replacing current attributes. No name/address/contact value is loaded into analytical staging.

The local [registry reconciliation tool](../../scripts/reconcile-registry-warehouse.py) reads original owner outbox evidence through read-only SQL, validates existing ledger hashes, reprojects supported registry events and confirms publication before acknowledging matching error-queue deliveries. This operator repair path is separate from normal ingestion, which never reads owner databases. The executed repair reconciled 20 originals (12 already ledgered and 8 previously missing) and confirmed 8 error-queue redeliveries, preserving all originals and event identities. Later synthetic records followed the corrected grants and normal broker path. Supplied evidence completeness and a production restore rehearsal remain separate requirements.
