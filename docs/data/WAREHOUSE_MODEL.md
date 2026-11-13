# Implemented analytical warehouse model

Baseline: live `fieldops_warehouse`, **2026-11-05 16:34:37 UTC**, migrations 001–008 observed in `warehouse.schema_migration`. The [catalog dictionary](DATA_DICTIONARY.md) gives exact columns/types/defaults/constraints and the [physical star diagram](physical/fieldops_warehouse.mmd) contains actual SQL FKs. The reporting service's separate `public.fact_work_order` and `public.fact_workflow_stage` are local fallback models, not this warehouse.

## Dimensions and history

| Table | Grain / surrogate key | Business key and semantics | History |
|---|---|---|---|
| warehouse.dim_date | One calendar date / date_key integer | calendar_date unique; year, month, weekday | Static UTC date attributes; no intraday/time dimension |
| warehouse.dim_technician | One observed technician epoch / technician_key bigint identity | technician_id plus effective_from_utc; team, supervisor, skill/certification arrays, hours/timezone, availability, source sequence/hash | Implemented SCD2 half-open effective interval; one current row and exclusion against overlapping epochs |
| warehouse.dim_supervisor | One recorded supervisor identity / supervisor_key identity | supervisor_id unique, team_id | Type-1 overwrite; no supervisor SCD2 claim |
| warehouse.dim_customer | One customer reference / customer_key identity | customer_reference unique; current safe classification/status/counts | Highest observed source version; unresolved legacy identity retained |
| warehouse.dim_customer_version | One customer/source-version / customer_version_key identity | Customer FK and unique version; safe attributes and counts | Exact source-version snapshots; inferred rows resolve when owner event arrives; not temporal SCD2 |
| warehouse.dim_service_location | One location UUID / service_location_key identity | Customer FK, team and status; no address | Highest observed customer source version |
| warehouse.dim_asset | One asset UUID / asset_key identity | Customer FK, classification/status, installation/warranty dates; no serial or QR | Highest observed source version |
| warehouse.dim_service_category | One category / category_key identity | category unique, including Unknown | Type-1/static categorical lookup |
| warehouse.dim_workflow_stage | One template stage index / stage_key identity | stage_index unique 0–7, stage_name | Current immutable v1 labels; not a multi-template historical dimension |
| warehouse.dim_work_order_status | One lifecycle label / status_key identity | status unique | Created/Assigned/Scheduled/InProgress/Completed/Cancelled lookup |

Technician SCD2 is actually implemented by [migration004](../../analytics/migrations/004_technician_scd2_and_time_off.sql) and the worker's `_apply_technician_version`. Historical late events can split epochs; same-instant corrections use source sequence. [Migration005](../../analytics/migrations/005_database_invariants.sql) prevents overlapping epochs. Tests cover contiguous versions, late splits, single-current state and SQL rejection of overlap. Historical truth remains limited to observed retained source events; no earlier schedule is invented.

## Fact grains and measures

| Table | Explicit grain and identity | Measures / links | Update behavior |
|---|---|---|---|
| fact_work_order | One order UUID / work_order_id PK | Creation date, customer version/location and optional asset reference, category/status, recorded technician version; team/priority, creation/completion/lifecycle timestamps | Accumulating snapshot; authoritative work-order source sequence plus other lifecycle signals protect late updates |
| fact_workflow_stage | One stage-instance UUID / stage_instance_id PK | Order/stage FKs; start/deadline/completion, approved paused seconds, status/SLA/breached | Accumulating stage snapshot; missing starts remain unknown; late warnings cannot downgrade terminal state |
| fact_booking | One booking UUID / booking_id PK | Order/technician FKs, UTC start/end/status/source version | Latest booking version; cancellation/reschedule survives late creation |
| fact_sla_breach | One distinct recorded breach event / event_id PK | Ledger, order and stage FKs; occurred_at_utc | Event fact. Counting events differs from affected-order share |
| fact_supervisor_intervention | One distinct pause/resume/override/advisory decision event / event_id PK | Ledger/order/supervisor FKs; type/time | Event fact; repeated event identity cannot add another action |
| fact_customer_change | One accepted customer/source-version / event_id PK | Ledger, customer and source-version FKs | Unique customer/version, immutable accepted revision |
| fact_asset_change | One accepted asset/source-version / event_id PK | Ledger and asset FKs | Unique asset/version, immutable accepted revision |
| fact_technician_time_off | One observed time-off identity / time_off_id unique, event_id PK | Ledger/technician FKs, technician/team, start/end/source sequence | Latest authoritative exception version; reasons excluded |

There are no labor, inspection, maintenance, inventory, purchasing, invoice/payment or equipment-alert facts. Customer, source-version, service-location and asset dimensions are implemented. Product/Supplier/Territory/Agreement dimensions are absent. No financial double precision measures exist because billing is not implemented; future monetary measures require explicit decimal precision, currency, rounding and grain decisions. There are no bridge tables in the baseline.

## Ledger, staging and reporting views

`warehouse.ingestion_ledger` is one accepted EventId plus canonical payload SHA-256, type/source/schema/sequence and occurrence/ingestion timestamps. `staging_event` has one FK-linked safe JSON payload per accepted event and its work-order reference, including Guid.Empty for non-order technician events. It is an event-ingestion ledger, not a general CDC log.

Six live views exist: `analytics.v_stage_duration`, `analytics.v_team_summary`, `analytics.v_summary`, `analytics.v_customer_registry`, `analytics.v_asset_registry` and `analytics.v_asset_service_history`. Two public analytical functions implement lifecycle status refresh and interval utilization. SQL and exact view definitions are in the generated dictionary; [reporting metrics](REPORTING_METRICS.md) distinguishes the public API formulas from similarly named view formulas. Both use known creation metadata to avoid cohort inflation.

## Domain expansion gate

For each new operational domain, require an explicit grain, versioned event payload, redaction decision, dimension/fact or justified exclusion, replay-safe incremental projector, late/duplicate handling, reconciliation, data-quality assertions, real persisted-data report and end-to-end evidence. The [pipeline](DATA_PIPELINES.md) describes current support. Candidate future subjects are requirements, not deployed warehouse facts. Customer and asset migrations, consumers, report endpoints and source-version projection tests now exist; full feature acceptance remains constrained by the separate client/role/recovery gates in the feature matrix.

## Asset registry projection

[warehouse007](../../analytics/migrations/007_asset_registry.sql) adds `warehouse.dim_asset` at the grain of one current asset, keyed by an opaque `asset_reference` UUID and linked to the customer dimension. `warehouse.fact_asset_change` is at the grain of one accepted asset revision, references the ingestion ledger and is unique per `(asset_key, source_version)`. `analytics.v_asset_registry` aggregates by team, type, criticality and status with a 90-day warranty-expiry count. Serial numbers and QR identities are deliberately excluded. The migration is applied and included in the 16:34 catalog capture. Original-event reconciliation repaired early projection/grant failures without deleting retained evidence; normal event ingestion uses the same source-version rules.

## Work-order asset reference projection

Warehouse migration [008](../../analytics/migrations/008_work_order_asset_reference.sql) adds nullable `warehouse.fact_work_order.asset_reference` and indexes it for team-scoped service-history queries. It is a logical reference without an FK because an order event may arrive before the asset dimension is projected. `analytics.v_asset_service_history` has the grain of one linked asset and counts only orders with an explicit reference; orders without one are not attributed to equipment. The work-order fact remains at one row per work order, so adding the column does not change its grain.
