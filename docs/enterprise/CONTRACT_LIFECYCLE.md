# Contract renewal and automatic lifecycle foundations

Updated 16 November 2026, America/New_York. These additions extend the existing customers context and its agreement, visit, receipt, audit and outbox tables. They do not create another scheduler or booking ledger. The customers host calls the registration extension, but the automatic worker remains **disabled by default** and is registered only when an explicit enabled policy is configured.

## Renewal

`POST /api/contracts/{id}/renewals` requires the existing `supervise` authorization policy and resource access to the source agreement's team. The body contains `operationId`, `expectedVersion`, `effectiveFromUtc`, `expiresAtUtc` and a 3–500 character `reason`. `GET` on the same path returns immutable incoming/outgoing renewal evidence after the same resource check, with `Cache-Control: no-store`.

A renewal creates a new **Draft** with fresh agreement, coverage-line, covered-equipment and exclusion identifiers. Customer/team, time zone, coverage terms, active flags and exclusions are copied. Equipment coverage dates are reset to the explicitly requested renewal window in the agreement's time zone, using an exclusive expiration instant. Usage, visits, prior audit events and maintenance plans are not copied. New plans must be explicitly configured; the old plan's progress cursor does not become the new agreement's schedule.

The source must be Active, Suspended or Expired and have an explicit expiration. The requested start cannot precede that expiration, and the requested end must follow the start and still be in the future. Future-effective Draft renewals are accepted without activating them. The ordinary activation/effective-coverage rules remain authoritative.

The source's status, terms, version, plans, usage and visits are preserved. The transaction appends renewal audit to both agreements, immutable actor/reason/date/source-version evidence and two outbox messages. The response's `renewedContractId` identifies the newly created Draft. Each agreement can have only one immediate successor; a later renewal continues from the successor after it becomes eligible.

The command uses the existing actor-scoped receipt namespace and request hashing. Identical retries return the original response; changed commands using the same operation ID return HTTP 409. The transaction acquires the existing team `:contracts` PostgreSQL advisory lock **before reloading** tracked state and checking the expected version. Database uniqueness also prevents multiple successor agreements.

## Explicit automatic processing policy

[ContractLifecycleApi.cs](../../building-blocks/FieldOps.ServiceHost/ContractLifecycleApi.cs) contains the processor, registration extension and background worker. The customers host calls `services.AddContractLifecycle(configuration)`. Calling this extension with the default configuration registers no worker; automatic processing requires the explicit configuration below.

| Setting | Default | Meaning when enabled |
|---|---|---|
| `Contracts:Lifecycle:Enabled` | `false` | Explicitly enables automatic processing |
| `Contracts:Lifecycle:RecurrenceHorizonDays` | Unset | Required integer 0–366, measured from the agreement's local date |
| `Contracts:Lifecycle:MissedVisitGraceDays` | Unset | No automatic missed marking; optional explicit integer 0–366 |
| `Contracts:Lifecycle:IntervalSeconds` | `60` | Poll interval, constrained to 15–3600 seconds |

An enabled policy without a valid explicit horizon fails validation. No policy is silently inferred from existing development records. The worker takes its clock from `TimeProvider`; it does not use a request-supplied time. Each agreement is reloaded under the shared team lock, and business changes, System audit and outbox messages commit atomically in that agreement's transaction.

Processing performs these operations:

1. Active or Suspended agreements become Expired at the exact expiration instant. Draft and Cancelled agreements are not silently transitioned.
2. Only agreements currently Active and effective generate visits, using the existing `ContractRules.GenerateVisits` with the configured local-date horizon. Plan cursors advance and existing visit identities remain. Generated visits are explicitly tracked as inserts. A cursor-only advance gets audit evidence even when no new visit is needed; a repeated no-op sweep preserves agreement version and update time.
3. Only unlinked **Pending** visits may become Missed. Dispatching, Created, Scheduled, Completed, Cancelled and already Missed visits retain their state. The due day plus the full configured number of grace days must have passed in the agreement's time zone. For example, a March 7 due date with one grace day stays Pending throughout March 8 locally and becomes eligible on March 9. If the grace setting is absent, no visit is automatically marked Missed.

The processor never deletes visits, creates or books a work order, assigns technicians, records usage, activates a renewal, or changes the authoritative scheduling constraints. Dispatch remains a separate explicit workflow. Multiple workers serialize through the same team lock; uniqueness and advanced cursors prevent duplicate generated visits, and state transitions prevent duplicate lifecycle audit/outbox writes. Each agreement has an isolated transaction. A failed agreement rolls back its changes, clears uncommitted tracked state, increments the sweep's `Failed` count and logs its agreement/team identifiers through the worker logger. Processing continues with later agreements, and the failed agreement remains eligible for a future retry. Successful result counts include committed changes only. Cancellation propagates immediately rather than becoming an agreement failure.

## Additive schema and calendar behavior

[004_contract_lifecycle.sql](../../services/customers/migrations/004_contract_lifecycle.sql) adds `contract_renewals` with old/new foreign keys, unique successor/predecessor and actor/operation keys, value checks, and UPDATE/DELETE/TRUNCATE rejection triggers. The host mapping and SaveChanges guard protect the same append-only evidence, and the runtime identity receives SELECT/INSERT permissions only.

The migration also permits an inactive plan cursor to advance beyond `EndsOn` without deleting that plan. It backfills nullable `AnchorDay` from existing `NextDueDate` and constrains any supplied anchor to 1–31. New plans record their requested starting day; the generator initializes a legacy null anchor before advancing. This retains January 31 → February 28/29 → March 31 instead of drifting permanently to February's shorter day. A backfill cannot reconstruct an anchor that had already drifted before this migration; it preserves the day visible in the existing cursor.

The existing generator now evaluates effective/expiration dates in the agreement's time zone. An expiration exactly at local midnight excludes that day; a partial final local day remains a valid due date. Entitlement authorization still evaluates the precise instant, so a generated date does not authorize work after the agreement expires.

## Verification

```powershell
.\.tools\dotnet\dotnet.exe test tests/backend/FieldOps.Tests.csproj -c Release --no-restore --disable-build-servers -m:1 -p:UseSharedCompilation=false --filter FullyQualifiedName~ContractLifecycle --logger 'console;verbosity=minimal'
```

Final focused result: **22 passed, zero failed, zero skipped**, seven seconds of test execution, with clean compilation. This selection includes 17 new domain/registration cases, four new real PostgreSQL integration cases and one existing lifecycle transition case. The tests are in [ContractLifecycleTests.cs](../../tests/backend/ContractLifecycleTests.cs) and [ContractLifecyclePostgresTests.cs](../../tests/backend/ContractLifecyclePostgresTests.cs).

The domain cases verify immutable renewal cloning and rejected windows/states/versions, exact expiration boundaries, explicit missed policy with New York/DST day boundaries, monthly January 31 anchors in leap and non-leap years, local-midnight/partial-day expiration behavior, and disabled/incomplete registration policy.

The PostgreSQL cases verify concurrent renewal retries create exactly one Draft/receipt/link, changed-command conflicts and team isolation, immutable EF and database evidence, two concurrent workers converge on one expiration/two new visits/one missed visit, retained linked Pending visits, final bounded-plan cursor persistence, unchanged repeated sweep state, System audit/outbox written together, absent-grace/default-disabled behavior, and an actual upgrade from the pre-004 schema backfills an existing plan anchor while retaining nullable legacy compatibility.

Two early migration-test failures were in its synthetic setup: EF's raw-SQL formatter treated SQL braces as format markers, then the legacy customer insert omitted pre-existing required columns. The final helper executes the embedded immutable migration through `NpgsqlCommand` and supplies the required customer fields. Both failures were corrected before the passing run; no check was skipped or weakened.

This evidence covers deterministic local foundations and real PostgreSQL. It does not claim that the automatic worker has processed existing development data, that RabbitMQ has delivered these new outbox messages, or that a production scheduler/provider has been enabled. The parent integration owns the live authenticated HTTP/browser deployment checks and runtime-role verification.

The additional [ContractLifecycleResilienceTests.cs](../../tests/backend/ContractLifecycleResilienceTests.cs) scenarios exercise a persisted poison agreement ahead of a healthy agreement, rollback of a staged expiration/audit/outbox, continued healthy generation and missed marking, failure logging/retry accounting, unchanged repeated healthy work, and cancellation after acquiring the agreement transaction/lock.

On 16 November, the following focused real PostgreSQL run passed **3/3 tests, zero skips**: the two resilience cases and the customer-portal contract case selected by the parent integration. Compilation was clean and test execution took three seconds.

```powershell
.\.tools\dotnet\dotnet.exe test tests/backend/FieldOps.Tests.csproj -c Release --no-restore --disable-build-servers -m:1 -p:UseSharedCompilation=false --filter 'FullyQualifiedName~ContractLifecycleResilience|FullyQualifiedName~ContractPortal' --logger 'console;verbosity=minimal'
```

An initial resilience assertion compared an unrequested navigation collection that EF relationship fixup had populated in only one context. The assertion now compares the explicitly loaded status, version, update time, plans and visits with deterministic ordering; audit/outbox counts are verified separately. Both substantive rollback/progress checks and cancellation remained enabled throughout.
