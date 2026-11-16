# Maintenance visit allowance allocations

Implemented locally on 16 November 2026, America/New_York. The existing customer-owned visit state is the allocation record. No new service, table or schema migration is required.

## Capacity authority

For finite coverage lines, available visits equal included visits minus recorded usage and outstanding commitments. Dispatching, Created and Scheduled visits each hold one visit. A Completed visit requiring review without positive visit usage retains its commitment. Pending recurrence generation consumes no allowance. A matching positive usage row replaces the allocation and is counted once; legacy parts-only usage with zero visits does not release it. Unlimited terms retain commitment visibility but have no finite cap.

`ContractRules.CommittedVisits` and `AvailableVisits` expose these counts. The authoritative Pending → Dispatching transition checks capacity under the existing team `:contracts` PostgreSQL advisory lock before committing its durable creation intent. Different visits racing for the final included visit cannot both acquire it. Retrying the same visit preserves its allocation and deterministic work-order key.

An ambiguous Dispatching intent does not expire automatically: the work-order owner may have committed after a client timeout. Repair deterministic creation and reconcile the actual owner state. A timeout or appointment cancellation cannot release the included service promise.

## Own commitment and consumption

Generic entitlement reads report availability for another job. A maintenance owner uses an explicit `allocationVisitId` with its selected agreement to evaluate its already-held slot. Core validation requires the exact local customer, line, equipment, bound site, deterministic owner reference and committed visit state. An arbitrary, Pending, Missed or Cancelled visit cannot exempt another allocation. Root integration forwards this validated reference through the existing owner-intent and work-order creation paths.

The decision's new optional `CommittedVisits` property reports outstanding commitments. Generic `VisitsRemaining` is unallocated availability; an own-visit decision includes that job's already-held slot. The operator/portal line views distinguish remaining allowance from committed and available counts.

Completion converts its allocation into one append-only visit-usage fact in the same transaction. The usage guard includes all other commitments; generic/manual usage cannot consume their capacity. Existing agreement-line/work-order uniqueness and terminal completion evidence still prevent duplicate consumption.

If an immutable legacy usage row contains material cost but zero visits, completion retains its service fact and records a review reason. It does not rewrite that row or silently claim a visit was consumed. The unresolved review retains its allocation until an explicit resolution workflow is implemented.

These controls allocate maintenance **visit counts**. They do not reserve material allowances. Ordinary work-order coverage snapshots remain advisory until their authorization/allocation workflow is implemented; this change provides no financial authorization for arbitrary chargeable work.

## Cancellation

Canonical work-order cancellation currently publishes `WorkOrderUpdated.v1` with `status=Cancelled`. The maintenance consumer accepts this only from `work-orders` with matching agreement, line, customer, team, site, equipment, category and deterministic job/visit references. It marks the visit Cancelled and appends `MaintenanceVisitCancelled.v1` under the same lock, releasing its allocation once.

`BookingCancelled.v1` cancels an appointment and retains the service allocation. `WorkOrderCancellationReserved.v1` means cancellation is pending and also releases no allowance. Foreign sources and mismatched references cannot release it. Delayed Created or booking events cannot reopen a Cancelled visit, and Completed service remains terminal above cancellation. Conflicting late completion facts are retained for review and grant no silent usage; legacy/inconsistent evidence can block further allocations while investigated.

## Verification

```powershell
.\.tools\dotnet\dotnet.exe test tests/backend/FieldOps.Tests.csproj -c Release --no-restore -m:1 --disable-build-servers -p:UseSharedCompilation=false --filter 'FullyQualifiedName~MaintenanceAllowance|FullyQualifiedName~MaintenanceVisitConsumer|FullyQualifiedName~MaintenanceDispatch'
```

Focused result: **27 passed, zero failed, zero skipped**, 12 seconds, clean compilation. The new `MaintenanceAllowanceTests.cs` uses separate actual PostgreSQL owner databases and canonical handlers, substituting only HTTP transport. It covers two visits racing for one included slot, same-visit replay, generic usage blocked by commitments, canonical cancellation release, ignored appointment/pending/wrong-source cancellation, stale-event protection, dispatch after release, legacy zero-visit usage, own-reference validation and unlimited terms.

The live contract script now expects one available and one committed visit after dispatch, then one available and zero committed visits after actual completion. A rebuilt-runtime rerun and final full regression remain parent integration gates; this document does not claim those allocation-specific gates have passed yet.
