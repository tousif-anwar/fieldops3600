# Maintenance contracts integration

## Ownership decision

Contracts extend the `customers` service rather than creating a new service. That context already
owns customer identity, service locations, contacts, and consent. Equipment is owned by `assets`;
contract creation and equipment-scoped plans validate asset references through
`GET /api/assets/{id}/reference` under the caller's bearer token. No cross-database foreign key or
duplicate equipment table is introduced.

The service keeps one canonical customer registry and one agreement lifecycle. It does not create a
competing work-order state machine. Recurring visits are pending agreement records until dispatch
creates and books the corresponding work order through the existing work-orders/scheduling owners.

## Schema

`services/customers/migrations/002_contracts.sql` adds:

- `maintenance_contracts`
- `contract_lines`
- `contract_covered_assets`
- `contract_exclusions`
- `maintenance_plans`
- `maintenance_visits`
- `contract_usage`
- `contract_events`

Checks enforce valid statuses, visit allowances, nonnegative two-decimal parts amounts, date order,
known recurrence intervals, and a single active plan per coverage line/equipment target. PostgreSQL
expression indexes make NULL equipment targets participate in uniqueness rather than relying only on
application checks.

`contract_events` and `contract_usage` are append-only. The migration installs update/delete/truncate
triggers, and both `SchemaMigrator` and the local database provisioning script grant the runtime role
`SELECT, INSERT` only.

## API surface

Office routes are under `/api/contracts` and are routed through the gateway to `customers`:

- `GET /api/contracts` and `GET /api/contracts/{id}`: authorized agreement views.
- `GET /api/contracts/{id}/history`: append-only contract events.
- `GET /api/contracts/entitlements?customerId=&serviceType=&assetId=`: operational coverage decision.
- `POST /api/contracts`: create a draft agreement and its coverage lines.
- `POST /api/contracts/{id}/plans`: add a monthly, quarterly, semiannual, or annual plan.
- `POST /api/contracts/{id}/visits/generate`: idempotently generate due visits through a date.
- `POST /api/contracts/{id}/usage`: record visit and parts usage against a work order.
- `POST /api/contracts/{id}/status`: activate, suspend, or cancel with an expected version.

The customer-owned read is `GET /api/customer-portal/agreements`. It derives the customer and team
only from signed claims and returns coverage and upcoming visits without technician data.

Office reads require dispatch scope. Agreement mutations require supervisor/manager scope. The
entitlement decision route is available to operational roles, including work-order integration
callers. Customer access is checked again against the signed `customer_id` and `team_id` claims.

## Invariants

- Only `Active`, effective contracts with a matching service line can cover service.
- Equipment-specific contracts require an active covered-asset record whose effective dates include
  the evaluation date in the agreement time zone.
- Service or asset exclusions override coverage.
- Visit allowances are consumed by recorded usage, not by generating a visit.
- Parts coverage is limited by the line allowance when `PartsCovered` is true.
- Usage is unique per coverage line and work order; the operation also uses an actor-scoped
  idempotency receipt.
- Mutation commands hold a team-scoped PostgreSQL advisory lock and use the contract version as a
  concurrency token.
- Generated visits use a database uniqueness rule including the equipment target and due date, so
  duplicate requests cannot create duplicate rows even under concurrent delivery.
- Visits stop at the agreement expiration or plan end date. Expired plans are deactivated.
- Contract events and usage can be appended but not rewritten.

## Verification

Commands used in this batch:

```text
./.tools/dotnet/dotnet.exe build services/FieldOps.Backend.slnx -c Release --no-restore -m:1 -p:UseSharedCompilation=false
./.tools/dotnet/dotnet.exe test tests/backend/FieldOps.Tests.csproj -c Release --no-restore --filter 'FullyQualifiedName~Contract'
python tests/backend/verify_contracts_http.py -v
cd apps/web && npm run typecheck && npm run lint
cd apps/web && npm run test
```

Results at this checkpoint:

- Backend suite: **155/155 passed, zero skips** (includes PostgreSQL Testcontainers).
- Contract-selected tests: **9/9 passed** (domain, recurrence, usage, migration, API).
- Live contract HTTP verification: **1/1 passed** with a fresh synthetic customer, real
  Keycloak login, gateway routing, plan generation, entitlement exhaustion, append-only usage, and
  cancellation.
- Web: **78/78 tests passed**, typecheck, lint, and production build passed.

## Explicit remaining gates

- Generated visits are not yet converted into work orders or dispatched through the existing
  scheduling owner. They remain pending agreement records for a controlled scheduling integration.
- Entitlement evaluation is exposed but not yet called by the work-order creation/classification
  path, so a work order cannot yet rely on it to block uncovered chargeable work automatically.
- Contract renewal, automatic expiration, background missed-visit handling, and customer-visible
  contract documents/renewal actions are not implemented.
- The web editor creates all-equipment or explicitly listed equipment agreements, but does not yet
  expose per-asset effective-date editing or exclusion entry.
- No real external notification, e-signature, tax, or Microsoft integration is claimed here.
