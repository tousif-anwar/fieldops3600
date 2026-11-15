# Enterprise implementation handoff

Updated: 15 November 2026, America/New_York. Active request: nine enterprise capabilities in the latest attached brief, implemented as dependency-aware vertical slices. All nine remain in scope.

## Current phase

Inventory is implemented and verified. Maintenance contracts now have a working vertical slice in the existing customer context: agreement lifecycle, coverage, entitlements, exclusions, recurrence, usage evidence, authorized APIs, migration, operator workspace, and customer-portal read. Work is on `codex/enterprise-completion`, based on `1ea2dffb0bc476326faadb9db3832b1f6733ec0e`.

The user chose **local/test foundations** for external services. Use synthetic local notification sinks and contract-tested Microsoft adapters. Real delivery, an authorized Dataverse tenant, staging hosting, legal assessment, and production certification are not available evidence. Continue independent work rather than inventing credentials or claiming these gates passed.

## Capability status

| Capability | Status | Next gate |
|---|---|---|
| Inventory/reservations/transfers/consumption | Implemented and verified; dedicated browser journey and real broker/mobile runtime acceptance remain | Add a focused Inventory E2E journey, then run outbox delivery against RabbitMQ and mobile runtime |
| Maintenance contracts/entitlements/recurrence | Core vertical slice implemented and live-verified; scheduling conversion and automatic work-order entitlement guard remain | Convert pending visits into work orders through scheduling and call entitlement evaluation from work-order creation/classification |
| Customer appointment options/self-booking | Not implemented | Extend authoritative scheduling and constraints; no duplicate booking state |
| Estimates/e-signature/financial authorization | Not implemented | Decimal policy, immutable approved revision/hash/intent evidence, work authorization guard |
| Billing/job costing/internal invoices | Not implemented | Consume actual stock/labor and contract/estimate facts; immutable issued snapshot |
| External notifications/preferences | Not implemented | Extend notifications; durable local delivery sink and preferences/retry states |
| Secure media/retention | Not implemented | Authorized private objects, verified content, upload/retention state, offline retry |
| Dataverse/Power Automate adapter | Not implemented | Optional authenticated adapter; mocks/contract tests distinguished from live tenant |
| Production deployment/certification evidence | Not implemented | Hardened environment/secrets/TLS/backups, restore/smoke evidence, external controls matrix |

Do not promote a row to complete until its applicable definition-of-done gates in the user brief pass. Source code or a successful screen render alone is insufficient.

## Architecture decisions

- Keep the eight existing service-owned contexts and canonical work-order lifecycle. Preserve customer intake, assignment offers, service reports, SLA, and replay.
- Inventory is a justified bounded context because stock balances, reservations, transfer receipts, consumption, and an immutable ledger must commit atomically.
- Contracts extend `customers` because it owns customer identity, locations, contacts, and consent. Equipment remains owned by `assets` and is validated over its reference API. Do not duplicate equipment rows.
- Reuse PostgreSQL migrations/checksums, per-service EF models, actor-scoped request hashes/receipts, transactional outbox, inbox deduplication, signed role/team claims, and authoritative remote resource checks.
- Reuse the existing Fluent UI and React Native design tokens/components. Inventory mutations require a connection; never silently queue optimistic stock balances.
- Contract mutations use team-scoped PostgreSQL advisory locks, version concurrency tokens, and append-only event/usage tables. Generated visits use database uniqueness including a NULL-safe equipment expression.
- Estimates, billing, and invoices remain a later commercial context; do not create three independent financial ledgers.
- New production or legal compliance claims require independent evidence. Deterministic monetary rules are application policy, not tax/legal advice.

## Commits in this run

- `a2bceef` — inventory domain, persistence, API, immutable ledger migration, host/gateway/Compose wiring, clients, tests.
- `66ef07e` — technician-mobile Expo dependency alignment.
- `aaef565` — contract domain, persistence, API, migration, gateway/schema/local-role integration.
- `edc6764` — contract domain, migration, and API PostgreSQL tests.
- `b2fa6f1` — contract operator workspace, customer-portal agreement view, live HTTP verification, append-only usage fix, integration documentation.
- `ddc6eec` — contract browser smoke, Keycloak/booking test hardening, final handoff evidence.

The original landing implementation remains in `stash@{0}`; do not apply it over newer website sources blindly.

## Verification

- Backend build: `./.tools/dotnet/dotnet.exe build services/FieldOps.Backend.slnx -c Release --no-restore -m:1 -p:UseSharedCompilation=false` — passed, one NU1900 warning when the NuGet vulnerability feed is unreachable.
- Full backend tests: `./.tools/dotnet/dotnet.exe test tests/backend/FieldOps.Tests.csproj -c Release --no-restore` — **155/155 passed, zero skips**, including real PostgreSQL Testcontainers.
- Contract-selected tests: `./.tools/dotnet/dotnet.exe test tests/backend/FieldOps.Tests.csproj -c Release --no-restore --filter 'FullyQualifiedName~Contract'` — **9/9 passed**.
- Live contract HTTP workflow: `python tests/backend/verify_contracts_http.py -v` — **1/1 passed** against real Keycloak/gateway/customers/work-orders. It creates a uniquely labelled synthetic customer/agreement, verifies replay and changed-command conflicts, authorization denials, plan creation, activation, idempotent visit generation, entitlement exhaustion after usage, append-only usage, and cancellation.
- Inventory HTTP workflow: `python tests/backend/verify_inventory_http.py -v` — **1/1 passed** earlier in the run, including reservation races, transfer receipt, consumption/return, unauthorized access, and replay.
- Web: `cd apps/web && npm run typecheck && npm run lint` passed; `npm run test` — **78/78 passed**; `npm run build` passed.
- Mobile: `npm run check` — **48/48 passed**; `npx expo install --check` reports dependencies up to date.
- Local bootstrap: `python scripts/test-local-bootstrap.py` — **6/6 passed** earlier.
- Database permissions: `python scripts/verify-database-permissions.py` — passed earlier; the customers role now has SELECT/INSERT only on `customer_changes`, `contract_events`, and `contract_usage`.
- Live Playwright suite after rebuilding the web image: **39 passed, 0 failed, 13 intentionally skipped**. The Keycloak form wait was widened to 15 seconds. The booking journey now searches up to 12 business days because repeated local runs had filled the fixed 15:00 slot on the first work week.
- Dedicated contract browser smoke: `cd apps/web && WEB_BASE_URL=http://localhost:8088 FIELDOPS_LIVE_E2E=1 npx playwright test e2e/contracts.spec.ts --reporter=list` — **1/1 desktop test passed**, mobile intentionally skipped.
- Containers were rebuilt for customers and gateway and the contract migration job exited 0. No volumes were reset.

## Current implementation batch

- Inventory files remain as recorded in earlier handoffs; the full backend suite includes its PostgreSQL, HTTP, and client checks.
- Contracts:
  - `building-blocks/FieldOps.Core/Contracts.cs`
  - `building-blocks/FieldOps.ServiceHost/ContractPersistence.cs`
  - `building-blocks/FieldOps.ServiceHost/ContractApi.cs`
  - `services/customers/migrations/002_contracts.sql` (immutable, applied once)
  - `apps/web/src/pages/Contracts.tsx`, `apps/web/src/components/PortalAgreements.tsx`, `apps/web/src/contract-contracts.ts`
  - `tests/backend/ContractTests.cs`, `ContractPostgresTests.cs`, `ContractApiTests.cs`, `verify_contracts_http.py`
  - `apps/web/e2e/contracts.spec.ts`
  - `docs/enterprise/CONTRACTS_INTEGRATION.md`
- The contract web route is `/contracts`; customer agreement data is read at `/api/customer-portal/agreements`. The new page was smoke-tested through the live gateway after rebuilding the web image.
- The customer service runtime role has append-only access to `contract_events` and `contract_usage`; the live test caught and now verifies the EF navigation-add/update mistake that initially caused a 42501 permission error.
- Rebuild the web image (`docker compose build web`, then recreate `web`) before expecting the new contracts screen at `http://localhost:8088`.

## Known gaps and blockers

- Generated maintenance visits are not yet turned into work orders or booked through scheduling. They are pending agreement records with `WorkOrderId = null`; dispatch remains responsible for the next integration.
- The work-order creation/classification path does not yet call the entitlement endpoint to block uncovered chargeable work. The endpoint exists and is authorized but is not the authority in that workflow yet.
- Contract renewal, automatic expiry/missed-visit processing, contract documents, and per-asset effective-date/exclusion editing are not implemented.
- No dedicated Inventory browser journey exists. Contracts now has a desktop smoke journey (`apps/web/e2e/contracts.spec.ts`); its create/activate controls are covered by API and component tests but not a second live write journey.
- Contracts do not yet store an explicit service-location reference. A generated visit therefore cannot safely create a work order for a specific site until that contract/site binding is added and validated.
- Real RabbitMQ outbox delivery and mobile runtime acceptance remain unverified (inventory and contract events are queued in the transactional outbox).
- Warehouse tests could not run on host Python without `psycopg`; previous documented result is 44/44 in a provisioned environment.
- No external notification delivery, e-signature provider, Dataverse tenant, staging deployment, or certification assessment has been performed or claimed.

## Next action

Integrate generated maintenance visits with the existing work-order and scheduling owners: create exactly one work order per pending visit, preserve source/correlation/idempotency, link the visit's `WorkOrderId`, and schedule through the existing booking/assignment rules rather than silently assigning technicians. Then call entitlement evaluation during work-order creation/classification and add the focused contract and inventory browser journeys. After that, begin customer appointment options/self-booking without duplicating the authoritative booking state.
