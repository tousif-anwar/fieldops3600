# Analytical warehouse

The Python worker consumes the durable `FieldOps.Core:AuditEvent` fanout exchange, stages a redacted payload, and writes an independent PostgreSQL star schema. It never connects to operational databases. Event ID and canonical payload hash enforce deduplication and detect changed duplicate evidence. Queue acknowledgment occurs after commit. Failed messages move through a durable 2-second retry queue and then `.error` after five attempts.

`migrations/001_star_schema.sql` defines seven conformed dimensions and five facts. Grain: one work order, one stage instance, one booking, one distinct breach event, and one distinct intervention event, including accepted/dismissed predictive recommendations. Dimensions use surrogate keys and unique natural keys. They currently use type-1 corrections; historical SCD2 staff/team membership and working-hours history are not implemented and must not be inferred. Late events fill missing facts and never clear completed stages or breach history. Replay evidence remains in reporting's separate event store.

Migrations run once, transactionally, under a PostgreSQL advisory lock and a `warehouse.schema_migration` ledger. Migration 002 adds source-local sequence tracking, lifecycle projection, explicit SLA status, and local working-hours/timezone fields. Migration 003 keeps summary numerators in the same known-creation cohort as their denominators. Existing retained staging rows originally lacked source sequences; their upgrade uses the latest occurrence from the authoritative Work Order Service as an explicitly limited legacy fallback. New events retain their source sequence. Sequences from separate services are never compared as a total order.

Newer Work Order Service versions protect category, priority, number, and source status from late creation/update events. Booking cancellation arriving before creation remains cancelled while late metadata can fill missing appointment times and technician keys. A rescheduled interval cannot be overwritten by an older creation event. Workflow start/completion facts and current confirmed bookings derive the lifecycle status without regressing terminal completion. Completed stages with an unknown start time have null duration rather than an invented zero.

Customer names, addresses and form answers are excluded from warehouse staging. The customer dimension holds an explicit unresolved synthetic reference until a pseudonymous customer identifier is published. Freshness is last successful ingestion, not a promise that no event is delayed.

Reporting queries `ConnectionStrings:Warehouse` with parameterized team/date/technician/category/priority filters. Completion uses a half-open UTC creation-date cohort with known creation metadata; service duration includes dispatch wait; stage duration excludes approved pauses. UTC trend buckets explicitly convert timezone rather than depending on the database session setting. Active jobs require recorded InProgress state. At-risk/overdue counts use ingested server warning/breach evidence and are eventually consistent.

Utilization selects appointments by overlap with the requested UTC range, including jobs created before it. Booked minutes are clipped to the interval. Its denominator sums the overlap of each technician's published local working shifts with the interval, using the published timezone and PostgreSQL timezone rules for DST. A valid timezone, authoritative hours, and both boundaries are required; otherwise capacity and utilization are null. Report intervals are limited to 366 days. Current published hours are used for historical ranges because SCD2 working-hours history is pending. Time off and weekends are not excluded; these limitations appear in API metric definitions. Capacity is a schedule-based measure and does not prove actual productive time.

Run real PostgreSQL tests after starting Compose:

```powershell
docker compose build analytics-worker
docker compose run --rm -v "${PWD}:/repo:ro" migrate-warehouse python /repo/tests/warehouse/test_projection.py -v
docker compose run --rm -v "${PWD}:/repo:ro" analytics-worker python /repo/analytics/quality-tests/run_checks.py
```

The 26-case PostgreSQL suite covers duplicate/colliding events, source-local late ordering, terminal lifecycle protection, cancelled booking enrichment, reschedule preservation, UTC bucketing under a different session timezone, DST capacity, partial ranges, team scope, unknown metadata, prediction decisions, metric denominators and archive recovery. Every test rolls back its synthetic records. `quality-tests/checks.sql` lists checks expected to return zero rows.

## Historical backfill and reconciliation

`ingestion-worker/backfill.py` accepts JSONL containing unchanged original `AuditEvent` envelopes from a retained archive. Do not reconstruct these from the enriched replay API or strip properties: their canonical hashes must match the ingestion ledger. The default mode reports distinct, matched and missing source events and the archive SHA256 without changing the database. `--apply` validates all retained hashes before projecting missing events in one transaction. Changed duplicate IDs fail; ordinary duplicates remain no-ops. The same late-event rules as live ingestion preserve terminal state. Transactions are bounded to 10,000 rows/50 MiB; split larger archives. The command never accesses operational databases or prints payloads/credentials.

```powershell
# Mount an existing trusted archive under .local; it remains ignored by Git.
docker compose run --rm -v "${PWD}:/repo:ro" analytics-worker python /repo/analytics/ingestion-worker/backfill.py /repo/.local/archive.jsonl
docker compose run --rm -v "${PWD}:/repo:ro" analytics-worker python /repo/analytics/ingestion-worker/backfill.py /repo/.local/archive.jsonl --apply
docker compose run --rm -v "${PWD}:/repo:ro" analytics-worker python /repo/analytics/quality-tests/run_checks.py
```

Reconcile again after application: `missingBefore=0` and matching archive/ledger hashes establish event-level coverage for that supplied archive. Quality checks independently test fact invariants. This does not prove that the archive contains every source event; retention completeness and independent source manifests remain an operator responsibility. Automatic archive acquisition and reconciliation against every operational database's live totals are not implemented.
