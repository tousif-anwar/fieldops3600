# Data quality controls and verification boundary

Baseline schema observation: **2026-11-05 16:34:37 UTC**. [Catalog evidence](../../scripts/audit-data-catalog.py) verifies actual constraints/indexes, not the correctness of every business row. [SQL checks](../../analytics/quality-tests/checks.sql) and [projection tests](../../tests/warehouse/test_projection.py) are complementary controls. Tests existing in source are not silently counted as a fresh execution.

## Implemented controls

| Area | Enforced / checked behavior | Boundary |
|---|---|---|
| Identity | Operational UUID/string PKs, unique order number, unique workflow/order, notification/source EventId; warehouse business keys and ledger EventId | Registered customer/location/asset references validated by owner APIs; legacy exceptions remain explicit |
| Allocation | PostgreSQL half-open GiST booking exclusion and one confirmed booking/order; API qualification/hours/time-off validation | Profile/time-off edits can race another service's HTTP check |
| Temporal state | Positive intervals/versions, valid statuses, nonempty identities, completion-after-start/creation, paired booking endpoints | JSON stage semantic rules also require application validation |
| Event integrity | Canonical warehouse SHA-256 and collision rejection; original reporting serialized-text hash; append-only runtime grants/triggers | Owner/host compromise and missing archives are not prevented by local hashes |
| Warehouse joins | Actual local FKs and quality checks for missing order/stage/status/category/technician identities | Legacy customer remains explicitly unresolved; registry source-version/location joins have local FKs |
| Technician history | One-current-row index, effective-range exclusion, gap/overlap/current/end-state checks | SCD2 is limited by retained observed events |
| Capacity | Valid published hours/timezone, history-aware clipped shifts, weekend default and recorded time off | Overlapping time-off intervals are summed/capped rather than unioned |
| Metrics | Known creation cohorts, rate checks, valid stage-duration population, null unknowns | Utilization can exceed 1 for overbooked workload and is not clamped to a fabricated 100% |
| Privacy | Safe analytical staging excludes names, addresses, answers and time-off reasons | Operational/event retention still needs a documented deployment policy |

`checks.sql` contains 33 SELECT-based defect checks: invalid stage timing/status/SLA, missing dimensions/orders, invalid priorities/terminal regression, booking intervals/status/duplicate/overlap, SCD2 gaps/overlap/current rows/capacity, unresolved time-off dimensions, ledger/staging/hash/sequence shape and bounded completion/SLA/scheduling rates. Each returns defect/entity rows. [run_checks.py](../../analytics/quality-tests/run_checks.py) aggregates them and exits nonzero when any defect exists; do not interpret absence of a thrown exception as checking a different database.

## Execution evidence

Current expanded-slice execution on 2026-11-05 passed **75 backend**, **55 web**, **34 native plus TypeScript** and **41 warehouse tests**. Backend TRX is retained under ignored `artifacts/core-verification`; local run logs remain ignored. Three actual Android logout/login cycles returned to Home successfully. The Customer browser registry/detail/history and actual owner-event/broker/warehouse registry path were exercised. These observations do not establish the missing Inventory/Billing/IoT domains or every customer/asset editor and role combination.

Projection tests include exact duplicate/no-op, changed duplicate rejection, unsupported schema, privacy exclusions, booking cancellation before creation, independent source ordering, late stage start, unknown duration/capacity, known metric denominators, UTC bucketing, SCD2 contiguous/late/exclusion, time-off dedup/privacy, DST, archive collision and bounded backfill. SQL and API tests add real PostgreSQL concurrency and restricted-evidence mutation checks. Coverage of these cases does not establish unimplemented-domain invariants.

The documented container-mounted checker was executed on 2026-11-05 against the configured local warehouse and returned **0 defects across 33 SELECT-based checks**. This run covers those checks, not every new registry invariant or missing domain.

## Running quality checks safely

Use the existing worker environment or a scoped warehouse reader DSN; never paste credentials into documentation/logs. The worker image has `/app` as its working directory and includes migrations and ingestion code; it does not copy the quality-test directory. Run the SELECT-only checker with its source mounted read-only:

```powershell
docker compose run --rm --no-deps -v "${PWD}/analytics/quality-tests:/checks:ro" analytics-worker python /checks/run_checks.py
```

The source runner contains SELECT statements only, but its normal connection is the worker writer identity. For strict transaction-level read-only enforcement, use the metadata audit's `BEGIN READ ONLY` pattern or a configured reader connection. Preserve the database identity, capture timestamp, migration versions, check count, defect count and sanitized results as evidence. Fix source/migration/projector defects according to ownership and rerun the checks; do not delete failing business rows as the default repair.

## Expansion requirements

Customer/location and asset controls now include scoped uniqueness, local child/history FKs, consent validation, versioned owner-reference checks and no ambiguous name backfill; broader acceptance remains tracked in the feature matrix. The 33 generic SQL defect checks do not yet cover every registry-specific invariant, which also has focused domain/PostgreSQL/projector tests. Inventory needs transactional nonnegative ledger/reservation rules and duplicate-consumption protection. Maintenance needs recurrence uniqueness and valid agreement coverage. Inspections need immutable template-version linkage and evidence integrity. Billing needs decimal/currency/rounding and duplicate issuance protection. Equipment alerts and offline actions need bounded idempotent generation/replay. These are required future checks until implementation and executed evidence exist.
