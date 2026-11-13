# Reporting metrics, grains and interpretation

The configured local Reporting service reads the independent warehouse using [WarehouseQueries](../../building-blocks/FieldOps.ServiceHost/WarehouseQueries.cs) and [WarehouseAnalytics](../../building-blocks/FieldOps.ServiceHost/WarehouseAnalytics.cs). API: `GET /api/reports/summary` with `from`, `to`, `technicianId`, `serviceCategory`, `priority`; CSV/PDF use the corresponding `/export.csv` and `/export.pdf` routes. The report policy authorizes reporting roles and resource predicates scope non-administrators to their team. No arbitrary supervisor/stage/SLA-status filter exists.

## Cohorts and measures

Unless specified otherwise, the population is authorized orders with **known creation time** in half-open UTC `[from,to)`, filtered by recorded technician/category/priority. Numerators and denominators use one read-only repeatable-read snapshot. Unknown or empty populations yield null, not an invented measured zero. A bounded range cannot exceed 366 days.

| API metric | Grain / formula | Interpretation |
|---|---|---|
| totalWorkOrders / completedWorkOrders | Order count / count with completion timestamp in selected creation cohort | Completion may occur after the creation interval |
| completionRate | Completed selected orders / all selected orders | Null when no selected orders |
| activeJobs | Selected orders with projected InProgress state | Eventually consistent lifecycle |
| completedToday | Selected orders completed on current UTC date | Both cohort and UTC completion-day conditions apply |
| averageServiceMinutes | Mean creation→completion wall-clock minutes for completed orders | Includes dispatch wait; not technician labor |
| slaComplianceRate | Completed stage instances with no recorded breach / completed stage instances | Approved pauses affect effective duration; prior recorded breach remains a breach |
| averageStageMinutes | Mean valid completed-stage `(completion-start-pause)/60` | Requires known valid endpoints and pause ≤ elapsed; unknown duration excluded |
| atRiskStages / overdueStages | Active uncompleted stage instances with recorded Warning/Critical / recorded breach | Server events determine risk; browser countdown is not authority |
| escalationFrequency | Distinct selected orders with ≥1 breach / selected orders | Share of affected orders; not event count per order |
| schedulingEfficiency | Selected orders with currently Confirmed booking / selected orders | Booking coverage; not routing/optimizer efficiency |
| volumeTrend | Selected orders grouped by UTC creation date | Total and completed counts for each creation-date bucket |
| stageMetrics | Selected stage instances grouped by stage index/name | Average known effective duration, breach and instance counts |
| categoryBreakdown | Selected order count by category | Unknown category remains explicitly labeled |
| slaComplianceTrend | Selected orders' completed stages grouped by UTC completion date | Completion dates may extend beyond creation filter; missing days not synthesized |
| stageDurationDistribution | Valid completed-stage samples in `[0,10)`, `[10,20)`, `[20,30)`, `[30,45)`, `[45,60)`, `[60,∞)` minutes | Actual zero is valid; unknown is excluded; sample count is explicit |
| supervisorInterventionTrend | Recorded pause/resume/override/advisory-decision events by UTC action date | Counts events, distinct affected orders and recorded supervisors; action date may extend beyond cohort |
| refreshedAtUtc | Maximum selected order last ingestion timestamp | Observation metadata, not a freshness guarantee |

## Technician utilization is a different population

`analytics.technician_utilization` selects **confirmed appointment overlap** with an explicit UTC interval, including appointments for orders created before that interval. Numerator: clipped booked minutes. Denominator: published local working shifts clipped to the interval and observed technician SCD2 epochs, default weekday exclusion and recorded time off. Timezone/DST conversion occurs per recorded profile. Null capacity/utilization is returned without both boundaries, authoritative valid hours/timezone or usable capacity. Do not silently clamp ratios above 1; they can expose overbooked workload.

Live warehouse migrations004/005 implement history and time-off handling. The API's existing `metricDefinitions.technicianUtilization` prose still says time-off/weekends/history are absent; that string is stale and must be corrected in application source. SQL is authoritative for behavior. Overlapping time-off records currently sum clipped absence then cap at shift length rather than union intervals, which can overstate absence. The public API does not expose arbitrary work calendars or the SQL include-weekends parameter. This remains a documented limitation, not a labor productivity measure.

## View formulas and fallback boundary

Six analytical views exist in the live schema. The original summary views are `v_stage_duration`, `v_team_summary`, `v_summary`; the new registry/history views are described below. Their escalation-frequency formula counts breach events per eligible order, whereas the public API uses distinct affected-order share. Do not interchange these identically named measures. The summary views leave technician utilization null; the public API calls the dedicated function. [Dictionary](DATA_DICTIONARY.md) preserves the exact live view SQL.

If the Warehouse connection is absent, Reporting uses its local two-table fallback. Its completion-rate empty behavior and available measures differ; its CSV/PDF fallback does not apply all requested filters. The configured Compose deployment supplies a warehouse connection, so these fallbacks must not be presented as feature-equivalent. CSV/PDF are order/report exports, not invoices, field service reports with signatures, or financial statements.

## Missing analytical subjects

Persisted customer/location and asset registry metrics now exist. Inspection completion, technician labor, maintenance compliance, inventory movement/consumption, purchase receipt, invoice line/payment and equipment alert metrics remain absent. All current seeded/workflow demonstration records are synthetic; no adoption, savings, uptime or real-world model accuracy is established. Customer/asset analytics use persisted events and explicit grains; no fabricated card values are substituted. [Warehouse model](WAREHOUSE_MODEL.md), [quality](DATA_QUALITY.md) and the [completion matrix](../engineering/FULL_STACK_FEATURE_COMPLETION_MATRIX.md) define acceptance boundaries.

## Asset metrics

`GET /api/reports/assets` reports registered, active, inactive and retired asset counts; assets whose recorded warranty expires in the next 90 days; distinct customers with assets; and pending inferred versions. Breakdowns are by asset type and, for non-retired equipment, criticality. All values are read from the warehouse in a read-only repeatable-read transaction, team-scoped unless the caller is an administrator. Warranty expiry is a recorded-date calculation, not a provider claim. The endpoint cites its definitions in the response; no synthetic demonstration values are substituted.

## Linked equipment work-order metric

`GET /api/reports/assets` adds `linkedWorkOrders`: the count of warehouse work orders with an explicit asset reference, scoped to the caller's team unless the caller is an administrator. The metric excludes legacy customer-only orders and is therefore not a customer's total order count. `analytics.v_asset_service_history` provides per-asset linked-order counts and the latest service time for equipment-specific reporting. The endpoint labels the definition and continues to report eventual-consistency freshness separately.

## Customer registry metrics

`GET /api/reports/customers` reads `dim_customer` at the current highest-source-version grain and known-created work orders in a read-only repeatable-read snapshot, scoped by team except for administrators. It returns registered/active/archived customer counts, contact/location/active-location and channel-consent counts, linked/unregistered work-order counts, pending inferred customer versions, classification/status breakdown and maximum ingestion timestamp. Consent is a contact count, not a customer count or proof of message delivery. Customer source-version snapshots preserve accepted revisions without claiming temporal SCD2. The web Customer and asset insights page consumes these actual aggregate endpoints.
