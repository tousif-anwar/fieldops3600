# Schema Reference

These directories are review copies of the numbered SQL migrations. The service-owned copies under `server/services/*/migrations` and `server/analytics/migrations` are the files that the migration jobs actually execute.

## Operational databases

Each service applies its own migrations in numeric order and records them in `fieldops_schema_migrations` with a SHA-256 hash. The migration runner takes a PostgreSQL advisory lock so concurrent jobs cannot race.

| Directory | Database | Main tables |
|---|---|---|
| `operational/customers` | `fieldops_customers` | customers, contacts, locations, change history. |
| `operational/assets` | `fieldops_assets` | assets, location history, asset changes. |
| `operational/work-orders` | `fieldops_work_orders` | work orders, customer/asset references. |
| `operational/technicians` | `fieldops_technicians` | profiles, skills/certifications, time off. |
| `operational/scheduling` | `fieldops_scheduling` | bookings, overlap constraints. |
| `operational/workflows` | `fieldops_workflows` | workflow aggregates and stage state. |
| `operational/notifications` | `fieldops_notifications` | retained notifications and acknowledgments. |
| `operational/reporting` | `fieldops_reporting` | immutable audit evidence, delivery attempts, replay projections. |

Every operational database also contains the transactional outbox, inbox, and idempotency tables used by its owning service.

## Warehouse

`warehouse/migrations` builds `fieldops_warehouse`:

- dimensions: date, technician, customer, customer version, service location, service category, workflow stage, work-order status, supervisor, asset;
- facts: work order, workflow stage, booking, SLA breach, supervisor intervention, customer change, asset change, technician time off;
- analytical views: stage duration, team summary, customer registry, asset registry.

The warehouse uses `warehouse.schema_migration` as its own ledger. `warehouse.ingestion_ledger` makes event ingestion idempotent, and `warehouse.staging_event` holds only safe projection payloads; customer names, contact details, and free-text answers are not copied.

## Applying migrations

In the Compose deployment, migration jobs run automatically before their service containers:

```bash
cd server
docker compose up -d migrate-customers migrate-assets migrate-work-orders \
  migrate-technicians migrate-scheduling migrate-workflows migrate-notifications \
  migrate-reporting migrate-warehouse
```

The owner identities are used only by migration jobs. Runtime identities have DML privileges and no schema-owner access.

## Review guidance

- Read the earliest migration first; later numbered files add indexes, constraints, or registry projections.
- Do not edit an applied migration in a live database. Add a new migration.
- Missing evidence is not converted to zero in analytical calculations.
- The physical reference ER diagram is in `data/diagrams/operational-er.mmd`; the warehouse diagram is in `data/diagrams/warehouse-er.mmd`.
