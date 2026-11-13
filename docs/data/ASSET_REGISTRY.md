# Asset registry slice

Status: **PARTIAL** as of 2026-11-05. The service, migration, API, events, web pages, native read list, warehouse migration and tests exist in the working tree. `assets001` was applied successfully to a clean scratch PostgreSQL database, and the asset suite passes (6 domain + 3 PostgreSQL integration tests). The full backend (75), web (55), mobile (34) and warehouse (41) suites pass. `fieldops_assets` and its owner/runtime roles are provisioned, `assets001` is applied, and the asset service is running. A real dispatcher flow through the rebuilt gateway and Keycloak created a synthetic customer, asset and linked work order; `GET /api/work-orders/by-asset/{assetId}` returned **200** with exactly that order. Actual registry broker/warehouse projection and retained-event repair are verified. Full asset browser editor and complete role-matrix acceptance remain pending. Native job equipment/history was observed on the emulator; the complete registry slice remains partial.

## Ownership and boundary

The `assets` service owns equipment identity, classification, warranty dates and installation-location history. Customer and service-location identifiers are **logical references validated over authenticated HTTP** against the `customers` service; there is no cross-service foreign key. The asset record stores the customer revision (`CustomerVersion`) that was validated, so a stale browser form is rejected instead of silently attaching equipment to a changed customer.

Physical foreign keys inside `fieldops_assets`:

| Child | Parent | Rule |
|---|---|---|
| `asset_location_history.AssetId` | `assets.Id` | `ON DELETE RESTRICT` |
| `asset_changes.AssetId` | `assets.Id` | `ON DELETE RESTRICT` |
| `assets.ParentAssetId` | `assets.Id` | self-referencing, `ON DELETE RESTRICT` |

## Tables

| Table | Grain | Key constraints |
|---|---|---|
| `assets` | one current equipment record | PK `Id`; unique `(TeamId, lower(SerialNumber))`; unique `(TeamId, QrCode)` when present; checks for type, criticality, status, warranty ordering, non-empty customer/location and no self-parent |
| `asset_location_history` | one recorded installation/relocation | PK `Id`; FK to asset; append-only trigger; effective timestamp and reason |
| `asset_changes` | one asset revision | PK `Id` (= outbox event ID); unique `(AssetId, Version)`; JSONB changed-field payload; update/delete/truncate rejected |
| `idempotency_receipts` | one actor-scoped create key | PK `Id`; request hash and stored response |
| `outbox_messages`, `inbox_messages` | messaging support | shared service pattern |

Serial numbers are trimmed, restricted to `[A-Za-z0-9._-]{2,64}` and unique case-insensitively per team. QR identity is optional, restricted to `[A-Za-z0-9._:/-]{4,128}` and unique per team when present.

## Business rules

1. Equipment can be registered only for an **Active** customer and an **Active** location owned by that customer.
2. The submitted `CustomerVersion` must equal the current customer revision.
3. Installation date cannot be more than one day in the future or before 1950; warranty expiry cannot precede installation.
4. The latest location-history entry must match the current customer, location and customer version.
5. Parent equipment must belong to the same customer, cannot be retired, cannot create a cycle and cannot exceed five hierarchy levels.
6. Retired equipment is terminal. Retiring a parent is rejected while non-retired children remain.
7. Relocation appends a location-history row; existing rows are never rewritten.
8. Concurrent updates use an integer concurrency token and return `409` on a stale expectation.

Work-order asset linkage and equipment-level service history are implemented and live: a work order stores one validated asset reference, and the asset detail/API plus native job read the linked orders. Not implemented: manufacturer/model catalog aggregates, warranty provider/claim workflow, device association, telemetry and QR scanning. These are recorded as PARTIAL or MISSING in the [feature matrix](../engineering/FULL_STACK_FEATURE_COMPLETION_MATRIX.md).

## API

| Route | Policy | Purpose |
|---|---|---|
| `GET /api/assets` | dispatch | Search/filter/sort/paginate by name, serial, manufacturer or model; team-scoped |
| `GET /api/assets/{id}` | dispatch | Asset with location history |
| `GET /api/assets/{id}/history` | dispatch | Recorded revisions and changed fields |
| `POST /api/assets` | dispatch | Idempotent registration; validates the customer reference |
| `PUT /api/assets/{id}` | dispatch | Versioned update, relocation and retirement |
| `GET /api/assets/by-work-order/{workOrderId}` | operational | Assigned technician's equipment list for the order's customer |
| `GET /api/assets/{id}/service-context?workOrderId=` | operational | Equipment detail restricted to the assigned order's customer |

Technician routes re-check the work order through the Work Orders owner and call the same assignment/team predicate used elsewhere. No list of all customers or all equipment becomes available by guessing identifiers.

## Events

`AssetRegistered.v1` and `AssetUpdated.v1` are written to the transactional outbox in the same EF change tracker as the asset, location history and change row. Payloads contain opaque identifiers, team, customer/location references, type, criticality, status, manufacturer, model, parent reference, installation/warranty timestamps and aggregate location count. **Serial numbers and QR identities are deliberately excluded.**

Consumers must treat delivery as at-least-once. The warehouse ledger deduplicates by event ID, and `fact_asset_change` is unique per `(asset_key, source_version)`; a different event carrying an already accepted revision is rejected rather than overwriting history.

## Warehouse

Migration [007_asset_registry.sql](../../analytics/migrations/007_asset_registry.sql):

- `warehouse.dim_asset` — current highest-source-version state, opaque `asset_reference` unique, customer key, team, type, criticality, status, manufacturer, model, parent reference, installation/warranty dates.
- `warehouse.fact_asset_change` — grain: one accepted asset revision; event ID references the ingestion ledger.
- `analytics.v_asset_registry` — counts by team/type/criticality/status plus a 90-day warranty-expiry count.

`GET /api/reports/assets` reads only these tables in a read-only repeatable-read transaction, scoped by team. It reports registered, active, inactive, retired, warranty-expiring-in-90-days, customers with assets and pending inferred versions. These are persisted warehouse values, not fabricated dashboard numbers.

## Verification performed

1. `assets001` applied cleanly to an empty PostgreSQL 18 database; the three local foreign keys, case-insensitive serial uniqueness, team-scoped QR uniqueness and append-only triggers were exercised by PostgreSQL integration tests. Work-order migration 004 also applied cleanly to the complete work-order migration stream, and its PostgreSQL test proves an asset reference cannot be attached to a legacy unregistered order.
2. The asset suite passes: hierarchy/date/identity domain rules, create/update/relocation, stale-writer `409`, duplicate serial and append-only history rejection.
3. The same EF model is exercised against the migrated schema, confirming the migration and entity mappings agree for the tested paths.
4. Web contract tests cover hierarchy depth, date validation and payload mapping; native context tests cover scoped paths, cache isolation, payload rejection, warranty labels and linked-equipment history.
5. Warehouse migration 008 was applied by the owner-run `migrate-warehouse` job, and its projection test proves a linked asset survives a later update without `assetId`.
6. Live local acceptance passed: owner/runtime roles and `assets001` are applied; the runtime has CONNECT/USAGE and history INSERT but no database/schema CREATE or history UPDATE/DELETE. Authenticated `POST /api/customers`, `POST /api/assets`, `POST /api/work-orders` and `GET /api/work-orders/by-asset/{assetId}` returned 201/201/201/200, and the history contained exactly the linked order.

## Not verified or not implemented

**Remaining acceptance**

1. Full foreign-team/role coverage of list/filter/sort, update, retirement, relocation and two-writer conflicts through real HTTP/browser workflows. Domain/PostgreSQL tests cover narrower invariants.
2. Browser asset registry/editor/detail acceptance remains pending. The Customer browser registry/detail/history path has been exercised separately. Actual assigned-technician equipment-history API returned 200 with four scoped rows after its authorization fix. The emulator now displays live customer/contact/location/consent, equipment metadata and linked work-order history without the warning; broader native foreign-team scenarios remain separate.
3. A current full-stack clean-Compose and restore-based populated upgrade rehearsal. Applied live ledgers and scratch migration tests are narrower evidence.

**Verified ingestion recovery**

The missing mutable `dim_asset` grant was corrected under the warehouse owner. Original-event reconciliation processed 20 registry originals (12 already ledgered, 8 missing), with eight confirmed error-queue redeliveries and no deleted originals. New synthetic customer/asset records use the corrected normal broker path. The live catalog includes warehouse migrations 006–008, asset dimension/change fact and registry/history views. This does not establish a production backup/restore guarantee.

**Not implemented**

- QR/barcode scanning, printed labels and native scan recovery; only a unique QR identity can be stored.
- Manufacturer/model catalog aggregates and replacement-part linkage; both remain validated asset text attributes.
- Asset/device associations, telemetry, rules, alerts and alert-to-order generation.
- Warranty provider, terms and claim workflow; only a warranty end date is recorded.
- A standalone native equipment detail/history route. The assigned job embeds equipment summary and linked service history.

The broader inspection, preventive-maintenance, inventory, billing, IoT and configurable automation domains remain missing; expanded scheduling and work-order requirements remain partial or missing. See the [feature matrix](../engineering/FULL_STACK_FEATURE_COMPLETION_MATRIX.md#not-verified-or-not-implemented-2026-11-05).
