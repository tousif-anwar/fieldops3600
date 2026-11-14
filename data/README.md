# Data Engineering Reference

This directory contains the reviewable data-engineering material for FieldOps 360. It is a reference set for understanding and reproducing the schemas; the runtime copies of the operational and warehouse migrations remain with their owning services under `server/`.

## Layout

```text
data/
├── README.md
├── dictionary/
│   └── DATA_DICTIONARY.md
├── diagrams/
│   ├── operational-er.mmd
│   └── warehouse-er.mmd
├── schema/
│   ├── README.md
│   ├── operational/
│   │   ├── assets/migrations/
│   │   ├── customers/migrations/
│   │   ├── notifications/migrations/
│   │   ├── reporting/migrations/
│   │   ├── scheduling/migrations/
│   │   ├── technicians/migrations/
│   │   ├── work-orders/migrations/
│   │   └── workflows/migrations/
│   └── warehouse/migrations/
├── quality-tests/
│   └── checks.sql
└── seed/
    └── README.md
```

## Source of truth

The authoritative migrations are:

- `server/services/<service>/migrations/*.sql` for operational databases;
- `server/analytics/migrations/*.sql` for the warehouse;
- `server/infrastructure/postgres/grants-warehouse-runtime.sql` for warehouse runtime grants.

The files under `data/schema/` are reference copies included so the data model can be reviewed without navigating the service source. If a migration changes, update the runtime copy and the reference copy together.

## Demo data

The demonstration dataset is generated through authenticated APIs with:

```bash
cd server
python scripts/seed-demo-data.py
python scripts/seed-enterprise-history.py
```

See [seed guidance](seed/README.md). No live database dump, password, or real customer data is included in this release.

## Warehouse tests

`data/quality-tests/checks.sql` is a copy of the warehouse quality checks. The executable PostgreSQL test suite remains at `server/tests/warehouse/test_projection.py` and is run against the Compose warehouse database. The release validation ran 32 warehouse tests successfully.
