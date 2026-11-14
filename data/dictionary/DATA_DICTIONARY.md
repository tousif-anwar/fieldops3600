# Data Dictionary

This is a concise domain dictionary. The numbered SQL migrations under `data/schema/` contain the complete physical columns, keys, checks, and indexes.

## Common columns

| Column | Type | Meaning |
|---|---|---|
| `Id` / `id` | UUID or text | Stable business or event identity. |
| `TeamId` / `team_id` | text | Team scope used by authorization and reporting. |
| `Version` / `version` | bigint | Optimistic concurrency version. |
| `CreatedAtUtc` / `created_at_utc` | timestamptz | Authoritative creation time in UTC. |
| `UpdatedAtUtc` / `updated_at_utc` | timestamptz | Last accepted update time in UTC. |
| `Status` / `status` | text | Lifecycle state; valid values are enforced by the owning API. |
| `outbox_messages` | table | Transactional event rows awaiting publication. |
| `inbox_messages` | table | Stable event IDs already consumed by a service. |
| `idempotency_receipts` | table | Actor/request hash and stored response for safe retries. |

## Operational entities

### Customer

`customers` stores display name, customer type, team, status, preferred channel, version, and timestamps. `customer_contacts` stores contact fields and explicit email/phone consent. `service_locations` stores the validated site address and access notes. `customer_changes` is append-only version history.

### Asset

`assets` stores name, type, manufacturer, model, serial number, QR code, criticality, customer and location references, parent asset, installed/warranty dates, status, and version. `asset_location_history` records effective-dated moves. `asset_changes` is versioned history. Serial and QR uniqueness are team-scoped.

### Work order

`work_orders` stores number, title, customer/site snapshot, optional customer/location/asset references, service category, priority, status, team, assigned technician projection, timestamps, and version. It does not own bookings or workflow stages.

### Booking

`bookings` stores the work order, technician, team, start/end interval, status, version, and override reason. A confirmed booking must have a positive interval. A partial unique index permits at most one confirmed booking per work order.

### Workflow

`workflows` stores the work order, technician, team, template version, current stage index, status, version, started/completed times, and serialized stage state. Stage answers are bounded string maps. SLA status, deadline, pause time, and completion time are server-owned.

### Notification

`notifications` stores a stable event ID, team, optional technician, work order, event type, severity, title, message, acknowledgment, and timestamps. The unique event ID prevents duplicate retained alerts.

### Audit event

`audit_events` stores the immutable envelope and body, source service, actor, work order, team, correlation/trace metadata, sequence, occurrence/receipt/processing times, and integrity hash. `delivery_attempts` records each consumer attempt. `replay_projection` stores reconstructable state.

## Warehouse entities

| Entity | Grain / meaning |
|---|---|
| `warehouse.dim_date` | One calendar date. |
| `warehouse.dim_technician` | Versioned technician/team capacity attributes. |
| `warehouse.dim_customer` / `dim_customer_version` | Customer reference and versioned registry attributes. |
| `warehouse.dim_service_location` | Reference location per customer. |
| `warehouse.dim_service_category` | One service category. |
| `warehouse.dim_workflow_stage` | Fixed eight-stage template index and name. |
| `warehouse.dim_work_order_status` | Created, Assigned, InProgress, Completed, Cancelled. |
| `warehouse.dim_supervisor` | Supervisor reference and team. |
| `warehouse.dim_asset` | Reference equipment per customer/location. |
| `warehouse.fact_work_order` | One work order. |
| `warehouse.fact_workflow_stage` | One stage instance. |
| `warehouse.fact_booking` | One source booking version. |
| `warehouse.fact_sla_breach` | One distinct breach event. |
| `warehouse.fact_supervisor_intervention` | One pause/resume/override event. |
| `warehouse.fact_customer_change` | One retained customer registry change. |
| `warehouse.fact_asset_change` | One retained asset change. |
| `warehouse.fact_technician_time_off` | One source time-off interval. |

## Metric definitions

| Metric | Definition |
|---|---|
| Completion rate | Completed orders / orders created in the selected cohort. Null for an empty cohort. |
| SLA compliance | Completed stages with no recorded breach / completed stages. |
| Average stage minutes | Mean effective stage duration after valid approved pauses. Missing/invalid durations are excluded. |
| Escalation frequency | Distinct selected orders with at least one breach / selected orders. |
| Scheduling coverage | Selected orders with at least one currently confirmed booking / selected orders. |
| Utilization | Confirmed appointment minutes overlapping the requested range / published working-shift minutes in that range. |
| Completed today | Orders completed during the current UTC day within the selected creation cohort. |

Rates use explicit denominators and return null when the denominator is unknown or zero. They do not invent a zero for missing evidence.

## Privacy boundary

The warehouse carries customer and asset references, not customer names, contact details, or free-text workflow answers. Reporting roles receive aggregates and order-level operational exports according to policy. No production customer data is included in this release.
