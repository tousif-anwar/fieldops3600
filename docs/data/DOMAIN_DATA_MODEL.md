# Domain data model and expansion baseline

Observed live PostgreSQL baseline: **2026-11-05 16:34:37 UTC**, source HEAD `a37f52c`. The reproducible [catalog audit](../../scripts/audit-data-catalog.py) read catalogs and migration ledgers inside read-only transactions. Its ignored `artifacts/data/live-catalog.json` contains no business rows. Customer and Asset migrations are applied and included in this captured physical model. [Feature completion](../engineering/FULL_STACK_FEATURE_COMPLETION_MATRIX.md) records missing layers; table presence never establishes full-stack completion.

## Implemented bounded contexts

| Context | Aggregate / authoritative state | Representation and boundary |
|---|---|---|
| Customers | `Customer`, contacts, service locations, revision history | Owning registry, communication preferences/consent, local child FKs, aggregate Version and append-only changes. |
| Assets | `Asset`, location history, revision history | Customer/location logical references, serial/QR identity, parent hierarchy, installation/warranty dates, aggregate Version and append-only history. |
| Work Orders | `WorkOrder` / `work_orders` | Order identity/number, title, retained customer/site snapshots, validated logical customer/location/version and optional asset references, explicit unregistered reason, category, priority, lifecycle, team, assigned technician, timestamps and integer Version. |
| Technicians | `Technician`, `TimeOff` | Technician ID, team/supervisor references, JSON-text skills and certifications, local hours/timezone, available flag; time-off interval has a same-database FK and Version. No proficiency, certification expiration, territory or crew aggregates. |
| Scheduling | `Booking` | Work-order/technician logical references, team, UTC interval, status, override reason, Version. PostgreSQL prevents overlapping confirmed bookings and multiple confirmed bookings for one order. |
| Workflows | `Workflow` with embedded `StageState` values | One workflow per order, pinned template version, current stage, status, timestamps/Version. Eight stage states, selected answers, deadlines, approved pause totals and warnings are one JSONB aggregate. They are not separate inspection/task/labor tables. |
| Notifications | `Notification` | One persisted notice per source EventId, audience/team/technician scope and acknowledgment metadata. SLA and assistance notices are not equipment telemetry alerts. |
| Reporting / Replay | `StoredEvent`, `DeliveryAttempt`, `ReplayProjection`, local facts | Immutable original serialized events/hash, separately observed delivery/fault evidence, rebuildable replay state, two local fallback reporting tables. |
| Warehouse | Python-owned dimensional projection | Ten dimensions, eight facts, staging/ledger/migration table and six analytical views. Event-driven customer source-version and current asset projections supplement technician SCD2. No direct operational database reads in normal ingestion. |

The [EF entities](../../building-blocks/FieldOps.Core/Models.cs) and [service-specific configurations](../../building-blocks/FieldOps.ServiceHost/Persistence.cs) explicitly exclude entities outside each host's ownership. Shared source code and one PostgreSQL process do not grant shared data ownership. The migration tool uses numbered SQL rather than EF `Migration` subclasses.

## Identity, relationships and transactions

Order, booking, workflow, stage-instance and event identities are UUIDs; technician and identity-provider actors use stable strings. Operational FKs stay within their owner: technician time off, customer contacts/locations/change history and asset parent/location/change history. Cross-owner relationships use authenticated HTTP validation, event envelopes and local projections. Cross-service foreign keys do not exist. The warehouse has its own local dimension/fact FKs; these do not enforce operational references.

Critical state changes enqueue outgoing events on the same EF context and commit through one `SaveChangesAsync`. Publication occurs afterwards. Consumers store inbox receipts with local state changes; retries can redeliver. Workflow request receipts separately bind actor, request key and request hash. Integer versions detect stale aggregate updates. These mechanisms are different and do not imply exactly-once delivery or distributed serializable transactions.

## Required domain gaps

| Requested domain | Baseline gap and intended ownership decision |
|---|---|
| Customer | Registry/contact/location/consent and linked history now exist. Full role/client/update/recovery acceptance remains partial; historical free-text names are never guessed into registry IDs. |
| Asset | Equipment registry/hierarchy/identity/location history and linked work-order history exist. Manufacturer/model catalogs, QR scanning, warranty claims and device linkage remain absent. |
| Expanded work order | No type/incident/task aggregate, product requirements/consumption, service/labor ledger, estimates/actual costs. Existing dropdown answers such as partsRequired do not reserve or consume stock. |
| Expanded scheduling | No persisted resource requirements, calendar shifts, territories, travel estimates, crews or recommendation history. Current profile hours/time off and booking constraints are narrower capabilities. |
| Expanded technician | No proficiency, dated certification/expiry, territory/crew membership or resource relationship model. Skills/certifications are arrays of strings. |
| Inspection | No general versioned inspection authoring, sections, typed measurements, photo/evidence/signature storage. Fixed workflow v1 has dropdown fields and a conditional delay reason only. |
| Preventive maintenance | No agreements, covered assets, plans, recurrence, occurrences, generated-order uniqueness, renewal or compliance history. |
| Inventory | No product/supplier/warehouse/bin/truck-stock registry, stock ledger, reservations/transfers, procurement/receipts/returns/adjustments or work-order consumption. |
| Billing | No versioned pricing/rates, estimates/lines, invoices/lines, taxes/discounts, payments/balances, currency/rounding or financial audit ledger. |
| Connected field service | No devices, telemetry definitions/readings, rules, equipment alerts, acknowledgments or deduplicated alert-to-order generation. |
| AI and automation | Synthetic risk prediction, dispatch solver and recorded supervisor recommendation decisions exist. Knowledge ingestion, configurable models, assisted drafts/approvals, automation rules/execution history and webhooks/delivery failure records are absent. |

No proposed table is depicted as deployed. The [physical diagrams](ENTITY_RELATIONSHIP_DIAGRAMS.md) are generated from actual catalogs; new domain designs must become migrations and verified vertical slices before joining them. Soft deletion, SCD2, currency precision and child-table normalization should be chosen per concrete business rule, not added as universal scaffolding.

## Applied asset slice

The local deployment includes an `assets` owning service and [assets001](../../services/assets/migrations/001_initial.sql). It stores equipment identity, classification, warranty dates, optional QR identity, a self-referencing hierarchy and append-only location/change history. Customer and service-location references are logical and validated over the Customer API with an expected customer version. Physical FKs remain inside the asset database. [warehouse007](../../analytics/migrations/007_asset_registry.sql) adds an opaque asset dimension, one-row-per-accepted-revision change fact and registry view; serial numbers and QR values never enter the warehouse. Design and acceptance gates are recorded in [ASSET_REGISTRY.md](ASSET_REGISTRY.md). These objects are included in the 16:34 live catalog and generated physical diagrams.

## Work-order equipment reference

`work_orders.AssetId` is a nullable **logical reference** to the asset owner. It is not a cross-service foreign key. A linked asset must belong to the same team, customer and service location and must be active; the work-order service validates this through `GET /api/assets/{id}/reference` before create or link. The database check forbids an asset reference on an unregistered/legacy order. The asset identity remains stable when the work order snapshot changes, and the work-order event payload carries only the opaque asset ID, never serial numbers or QR identities. Warehouse migration 008 stores the reference on `fact_work_order` and exposes `analytics.v_asset_service_history`; orders without an explicit reference are excluded rather than attributed to the customer's other equipment.
