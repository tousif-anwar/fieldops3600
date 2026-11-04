# Analytical warehouse

The Python worker consumes the durable `FieldOps.Core:AuditEvent` fanout exchange, stages a redacted payload, and writes an independent PostgreSQL star schema. It never connects to operational databases. Event ID and canonical payload hash enforce deduplication and detect changed duplicate evidence. Queue acknowledgment occurs after commit. Failed messages move through a durable 2-second retry queue and then `.error` after five attempts.

`migrations/001_star_schema.sql` defines seven conformed dimensions and five facts. Grain: one work order, one stage instance, one booking, one distinct breach event, and one distinct intervention event. Dimensions use surrogate keys and unique natural keys. They currently use type-1 corrections; historical SCD2 staff/team membership is not implemented and must not be inferred. Late events fill missing facts and never clear completed stages or breach history. Replay evidence remains in reporting's separate event store.

Customer names, addresses and form answers are excluded from warehouse staging. The customer dimension holds an explicit unresolved synthetic reference until a pseudonymous customer identifier is published. Freshness is last successful ingestion, not a promise that no event is delayed.

Reporting queries `ConnectionStrings:Warehouse` with parameterized team/date/technician/category/priority filters. Completion uses a half-open UTC creation-date cohort; service duration includes dispatch wait; stage duration excludes approved pauses. Utilization requires an explicit range and published working hours, uses calendar-day capacity, and does not yet subtract time off or weekends. These limits are included in API metric definitions.

Run real PostgreSQL tests after starting Compose:

```powershell
docker compose build analytics-worker
docker compose run --rm -v "${PWD}:/repo:ro" analytics-worker python /repo/tests/warehouse/test_projection.py -v
```

Every test rolls back its synthetic records. `quality-tests/checks.sql` lists checks expected to return zero rows. For backfill, republish retained original event envelopes to the warehouse queue without changing IDs or occurrence timestamps. A general administrative backfill command and reconciliation against source totals are still pending.
