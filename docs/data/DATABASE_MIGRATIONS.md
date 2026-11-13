# Database migrations, applied baseline and recovery

The read-only catalog capture at **2026-11-05 16:34:37 UTC** observed **28 migration entries** across nine FieldOps databases. Source HEAD was `a37f52c` with the reviewed expansion in the working tree. [audit-data-catalog.py](../../scripts/audit-data-catalog.py) records exact live ledgers and normalized source hashes in ignored `artifacts/data/live-catalog.json`. The twenty operational entries carry SHA-256 digests; the warehouse's eight rows record filename/time only, so an equivalent deployed-content hash comparison is unavailable there.

## Applied operational migrations

| Owner | SQL migration | Applied effect | Live observation |
|---|---|---|---|
| Work Orders | [001_initial](../../services/work-orders/migrations/001_initial.sql) | Order aggregate, unique order number, outbox/inbox/request receipts | Ledger + hash match |
| Work Orders | [002_data_integrity](../../services/work-orders/migrations/002_data_integrity.sql) | Lifecycle, text, version, timestamp and common-message guards | Ledger + hash match |
| Technicians | [001_initial](../../services/technicians/migrations/001_initial.sql) | Profiles, time off and support tables/indexes | Ledger + hash match |
| Technicians | [002_data_integrity](../../services/technicians/migrations/002_data_integrity.sql) | Hours, JSON arrays, intervals, version and common guards | Ledger + hash match |
| Technicians | [003_relationship_integrity](../../services/technicians/migrations/003_relationship_integrity.sql) | Supervisor identity guard, TimeOff.Version default/backfill and local technician FK RESTRICT | Ledger + hash match |
| Scheduling | [001_initial](../../services/scheduling/migrations/001_initial.sql) | Booking aggregate and support tables | Ledger + hash match |
| Scheduling | [002_booking_constraints](../../services/scheduling/migrations/002_booking_constraints.sql) | btree_gist; technician/interval exclusion; one confirmed booking/order; positive duration | Ledger + hash match |
| Scheduling | [003_data_integrity](../../services/scheduling/migrations/003_data_integrity.sql) | Booking identity/status/version/text and common guards | Ledger + hash match |
| Workflows | [001_initial](../../services/workflows/migrations/001_initial.sql) | Workflow JSONB aggregate, unique WorkOrderId and support tables | Ledger + hash match |
| Workflows | [002_data_integrity](../../services/workflows/migrations/002_data_integrity.sql) | Template/stage/status/JSON/version/temporal and common guards | Ledger + hash match |
| Notifications | [001_initial](../../services/notifications/migrations/001_initial.sql) | Persisted notices, unique source EventId and support tables | Ledger + hash match |
| Notifications | [002_data_integrity](../../services/notifications/migrations/002_data_integrity.sql) | Audience/severity/acknowledgment and common guards | Ledger + hash match |
| Reporting | [001_initial](../../services/reporting/migrations/001_initial.sql) | Immutable-original model, delivery evidence, replay and local facts | Ledger + hash match |
| Reporting | [002_append_only_evidence](../../services/reporting/migrations/002_append_only_evidence.sql) | Evidence mutation/truncate rejection triggers | Ledger + hash match |
| Reporting | [003_fault_delivery_observations](../../services/reporting/migrations/003_fault_delivery_observations.sql) | Nullable unknown Attempt, fault identity/occurrence metadata and index | Ledger + hash match |
| Reporting | [004_data_integrity](../../services/reporting/migrations/004_data_integrity.sql) | Evidence/hash/status and common-message guards | Ledger + hash match |

## Applied warehouse migrations

| SQL migration | Effect | Live observation |
|---|---|---|
| [001_star_schema](../../analytics/migrations/001_star_schema.sql) | Schemas, ledger/staging, seven dimensions/five initial facts and views | Filename present |
| [002_ordering_and_interval_capacity](../../analytics/migrations/002_ordering_and_interval_capacity.sql) | Source sequence/lifecycle columns and historical metadata backfill; valid unknown duration; interval utilization functions | Filename present |
| [003_known_creation_cohorts](../../analytics/migrations/003_known_creation_cohorts.sql) | View denominators require known order creation | Filename present |
| [004_technician_scd2_and_time_off](../../analytics/migrations/004_technician_scd2_and_time_off.sql) | Technician historical epochs/current row; time-off fact; history/weekend/time-off aware capacity | Filename present |
| [005_database_invariants](../../analytics/migrations/005_database_invariants.sql) | SCD2 exclusion, additional checks and breach-stage FK | Filename present |

The pre-existing `verify_warehouse` test database has only migrations001–004; it is not the running application's warehouse. Do not use its object counts as evidence of migration005 absence from `fieldops_warehouse`.

## Applied customer and asset expansion

All six additive files below are observed in the current local migration ledgers. Schema application is distinct from complete client, role, recovery and feature acceptance.

| SQL | Additive effect | Observed acceptance / remaining boundary |
|---|---|---|
| [customers001](../../services/customers/migrations/001_initial.sql) | Customers, contacts, locations, append-only change history and support tables; local child FKs and primary-contact uniqueness | Applied under the owner role; runtime privileges verified. Customer API creation, browser registry/detail/history and event-derived analytics exercised; full update/archive/role/client acceptance remains partial. |
| [work-orders003](../../services/work-orders/migrations/003_customer_references.sql) | Customer/location/version logical references and explicit unregistered reason; existing snapshots preserved | Applied to the populated owner database. New synthetic orders use real registered identities; retained legacy rows receive no guessed identity. |
| [warehouse006](../../analytics/migrations/006_customer_registry.sql) | Current customer attributes, source-version and location dimensions, customer-change fact, order links and registry view | Applied and included in 41 passing warehouse tests covering late order/customer arrival, collision and privacy cases. Customer source-version history is not temporal SCD2. |
| [assets001](../../services/assets/migrations/001_initial.sql) | Assets, parent FK, append-only location/change history and support tables; scoped serial/QR uniqueness | Applied to an empty scratch database and the live owner database; asset PostgreSQL/domain tests and live create/reference/history path pass; broader browser/native and role acceptance remains tracked separately. |
| [work-orders004](../../services/work-orders/migrations/004_asset_reference.sql) | Nullable asset logical reference, registered-customer check and team/asset index | Scratch full-stream migration and populated local upgrade passed. The observed upgrade preserved 32 existing rows and invented no links. |
| [warehouse008](../../analytics/migrations/008_work_order_asset_reference.sql) | Order asset reference, history index and linked-asset view | Applied; projection test preserves an explicit link on a later update without assetId. |

[warehouse007](../../analytics/migrations/007_asset_registry.sql) is also applied: asset dimension, per-source-version change fact and registry view, excluding serial/QR values. The early worker grant omitted mutable `dim_asset`; the owner-run grant was corrected and original retained events reconciled with [the recovery tool](../../scripts/reconcile-registry-warehouse.py). No originals or ledger identities were deleted.

No migration creates inventory, billing, agreements, IoT or a general inspection model. None of those domains becomes complete through the registry expansion.

## Execution and immutability

[SchemaMigrator](../../building-blocks/FieldOps.ServiceHost/SchemaMigrator.cs) serializes an owner's migration transaction with an advisory lock, creates its ledger, discovers embedded service SQL in ordinal order, normalizes line endings/trailing newline and compares SHA-256 for already applied files. Edited history fails; append a new migration. Grants run with the owner job, not the application identity. Normal service startup defaults to `Database:Initialize=false`; Compose migration jobs use `--migrate-only` and must succeed first.

The Python [warehouse migrator](../../analytics/ingestion-worker/worker.py) uses advisory transaction lock360002 and filename ledger, within the caller's transaction. It skips recorded filenames, but **does not detect edited applied SQL**. Preserve its migration history and append new files. A future checksum hardening migration/tool change should explicitly preserve the existing ledger rather than pretending hashes were previously recorded.

The parent workstream previously ran [verify-fresh-compose.py](../../scripts/verify-fresh-compose.py) against isolated empty Compose volumes and observed seven migration jobs/readiness/grants/quality passing for the old seven-owner baseline. That is useful historical clean-install evidence, not a test of the current Customer/Asset expansion. Existing populated live ledgers prove application, not a standalone rehearsed rollback. No destructive database reset was performed for this audit.

## Safe change and recovery procedure

1. Record deployed commit/image digest, ledger, current schema, row counts and a verified restorable backup. Preserve original events and queue state. A backup command without a restore check is not recovery evidence.
2. Test each new numbered file on an isolated clean database and a restored populated pre-change database. Compare retained IDs, snapshots, row counts and required-field backfills. Check uniqueness, local FKs, check/exclusion rules and expected-version conflicts with real concurrent transactions.
3. Apply with the owning migration identity. Do not give the running app DDL ownership. Confirm the job exits successfully, ledger and intended constraints/indexes exist, then run compatible services and actual role/API/event/client/warehouse workflows.
4. If a migration transaction fails, inspect the transaction/job outcome and ledger before retrying. Do not delete ledger rows or edit applied SQL. PostgreSQL transaction rollback protects transactional statements; external side effects and later published events require separate reconciliation.
5. Prefer an additive forward correction for a deployed defect. If application rollback is needed, first verify the old binary tolerates the expanded schema. Dropping populated columns/tables is not the default rollback. A database restore requires an explicitly selected restore point plus replay/reconciliation of subsequent events to avoid splitting operational truth from warehouse/audit state.

Initial schema creation and integrity constraints can fail on conflicting existing data. Do not delete those rows automatically. This baseline includes no tested production off-host backup/restore, point-in-time recovery objective, automatic down migrations or cloud rollback certification. New migration acceptance remains PARTIAL until the exact clean/upgrade/recovery evidence is recorded in the [feature matrix](../engineering/FULL_STACK_FEATURE_COMPLETION_MATRIX.md).

## Upgrade and recovery boundary

The current catalog establishes applied schema and ledger state in a populated local deployment. Customer/asset runtime owner isolation is verified across all eight services. Clean scratch tests cover the asset and work-order migration streams, while the existing historical fresh-Compose run predates the expansion. A full fresh-Compose rehearsal of the current nine-database stack and a restore-based populated upgrade/rollback rehearsal remain separate gates. The work-order migrations are additive and leave historical asset references null; no destructive reset is required.
