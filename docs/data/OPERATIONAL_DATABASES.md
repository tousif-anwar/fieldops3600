# Operational databases and EF ownership

Live catalog observed **2026-11-05 16:34:37 UTC**, including the applied Customer and Asset slices, by [audit-data-catalog.py](../../scripts/audit-data-catalog.py). The existing local PostgreSQL server runs version 18.6. One server hosts separate logical databases; this is not a separate server per service.

| Owner | Database | User schemas | Physical tables including support/ledger | Migration rows | Business tables |
|---|---|---|---:|---:|---|
| Customers | fieldops_customers | public | 8 | 1 | customers, customer_contacts, service_locations, customer_changes |
| Assets | fieldops_assets | public | 7 | 1 | assets, asset_location_history, asset_changes |
| Work Orders | fieldops_work_orders | public | 5 | 4 | work_orders |
| Technicians | fieldops_technicians | public | 6 | 3 | technicians, time_off |
| Scheduling | fieldops_scheduling | public | 5 | 3 | bookings |
| Workflows | fieldops_workflows | public | 5 | 2 | workflows |
| Notifications | fieldops_notifications | public | 5 | 2 | notifications |
| Reporting | fieldops_reporting | public | 9 | 4 | audit_events, delivery_attempts, replay_projection, fact_work_order, fact_workflow_stage |
| Analytics worker | fieldops_warehouse | public, warehouse, analytics | 21 | 8 | Ten dimensions, eight facts, ingestion_ledger, staging_event, schema_migration; six additional views |
| Keycloak | keycloak | public | 101 | Provider-managed | Identity-provider internal data; not FieldOps aggregates |

The nine FieldOps databases contain **71 physical tables**, **35 physical FKs**, **6 views** and **28 applied migration entries** at capture. Twenty operational entries carry normalized SHA-256 digests; the warehouse's eight entries record filenames/timestamps without digests. Totals include common tables and migration ledgers, so they must not be described as 71 business entities.

Also present: empty administrative `postgres`; provider templates `template0`/`template1`; and a pre-existing `verify_warehouse` verification database with 16 tables, 3 views and only four warehouse ledger entries. It is excluded from the active product model and was not reset or modified. Its metadata is retained to make the baseline inventory complete. A deployment inventory must explicitly identify test databases before retaining or deleting them.

## EF entities and configuration

All mappings live in [Persistence.cs](../../building-blocks/FieldOps.ServiceHost/Persistence.cs), with domain classes in [Models.cs](../../building-blocks/FieldOps.Core/Models.cs). `ServiceModelKeyFactory` keys EF's model cache by service identity. The common `ServiceDb` declaration exposes multiple DbSets, but OnModelCreating ignores foreign-owned entities.

| Service identity | Included entities / table | Important EF configuration |
|---|---|---|
| All eight operational services | OutboxMessage/outbox_messages; InboxMessage/inbox_messages; IdempotencyReceipt/idempotency_receipts | Keys; outbox Body JSONB; retry-scan index |
| customers | Customer/customers; CustomerContact/customer_contacts; ServiceLocation/service_locations; CustomerChange/customer_changes | Local child FKs, one primary contact per customer, aggregate Version, append-only changes |
| assets | Asset/assets; AssetLocationHistory/asset_location_history; AssetChange/asset_changes | Local parent/history FKs, team-scoped serial/QR uniqueness, aggregate Version, append-only history |
| work-orders | WorkOrder/work_orders | Unique Number index; Version concurrency token; validated logical customer/location/asset references |
| technicians | Technician/technicians; TimeOff/time_off | Technician Version concurrency token; time-off technician/interval index; SQL migration adds local FK and time-off Version |
| scheduling | Booking/bookings | Version concurrency token; WorkOrderId/Status index; exclusion and partial uniqueness are additional SQL rules |
| workflows | Workflow/workflows | Unique WorkOrderId; Version concurrency token; StagesJson JSONB; StageState is embedded, not a mapped table |
| notifications | Notification/notifications | Unique source EventId index |
| reporting | StoredEvent/audit_events; DeliveryAttempt/delivery_attempts; ReplayProjection/replay_projection; WorkOrderFact/fact_work_order; StageFact/fact_workflow_stage | Original event Body TEXT; projection StateJson JSONB; order/time and event/fault indexes; EF rejects original-evidence updates/deletes |

SQL migrations add constraints beyond EF's generated model. For example, the local time-off FK and GiST exclusions are enforced by SQL, even though EF has no corresponding navigation mapping. Do not generate a replacement initial schema from EF and assume it includes the deployed SQL hardening.

## Access and lifecycle

[Compose](../../docker-compose.yml) runs eight owner/migration jobs and a warehouse migration job, then long-running `_app` roles. [Role policy](../../scripts/local_databases.py) removes PUBLIC database privileges and schema CREATE, grants application DML without DDL, and protects migration ledgers. Reporting audit/delivery tables permit SELECT/INSERT only, with append-only triggers. Reporting has a separate warehouse SELECT identity. These are local configured policies; owner/admin access can bypass them.

No service may query another operational database. APIs validate references and enforce role/team/assigned-technician access. Each service transaction covers its aggregate, outbox/inbox or request receipt; it does not cover HTTP prerequisite checks in another database. [Consistency](DATA_CONSISTENCY.md) documents remaining races.

Runtime schema initialization is opt-in (`Database__Initialize=false` in running services). Numbered owner migrations precede service start. Persistent Compose volumes survive ordinary restarts. A catalog audit establishes objects and rules, not a tested backup, production restore, retention policy or cloud readiness.

To reproduce the metadata-only baseline:

```powershell
python scripts/audit-data-catalog.py --output artifacts/data/live-catalog.json
python scripts/render-data-catalog.py --input artifacts/data/live-catalog.json
```

This uses existing local container socket access and read-only transactions. It exports metadata and migration ledger records only, with no credentials or business rows. The [dictionary](DATA_DICTIONARY.md) and [ER diagrams](ENTITY_RELATIONSHIP_DIAGRAMS.md) are generated from this evidence. Rerun after each applied schema change and review the resulting diff.

## Asset owner database

`fieldops_assets`, owned by migration role `fieldops_assets` and accessed at runtime by `fieldops_assets_app`. Tables: `assets`, `asset_location_history`, `asset_changes`, `idempotency_receipts`, `outbox_messages`, `inbox_messages` and the migration ledger. The runtime role receives DML on operational tables, `SELECT,INSERT` only on append-only history, and no DDL or database `CREATE`. Customer and service-location identifiers are logical references validated over authenticated HTTP; there are no cross-database foreign keys. The owner/runtime roles and migration are applied in the captured local database; runtime permission verification covers all eight operational owners.

## Work-order asset reference column

`services/work-orders/migrations/004_asset_reference.sql` adds nullable `work_orders.AssetId`, a check requiring a registered customer/location/version pair, a non-empty UUID check, and a team-scoped recent-history index. The existing runtime grants cover the table; no new table or role is required. The work-order service calls the asset owner's minimal `GET /api/assets/{id}/reference` endpoint rather than reading `fieldops_assets`. Historical and explicitly unregistered orders keep `AssetId = NULL`. The migration has been applied to the populated local work-order database, preserving 32 existing rows with no invented links; the work-order container has been recreated from the rebuilt image. `fieldops_assets` is now provisioned with separate owner/runtime roles, `assets001` is applied, and the asset service is running. A real authenticated dispatcher flow created a synthetic customer, asset and linked work order; `GET /api/work-orders/by-asset/{AssetId}` returned 200 with exactly that order. The current synthetic batch contains 24 customers, 24 assets and 30 linked work orders. Customer browser registry/detail/history and actual broker-to-warehouse projection have been exercised. Broader asset editor, relocation/retirement role-matrix and broader native/role acceptance remain separately tracked in the feature matrix.
