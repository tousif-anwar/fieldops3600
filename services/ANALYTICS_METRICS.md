# Warehouse-backed analytics contract

The reporting summary reads the independent PostgreSQL warehouse. It does not query operational databases or fill charts with a bundled demonstration array. Values describe the retained synthetic/demo events that have actually been ingested. Warehouse delivery is eventually consistent.

## Shared order cohort

Order outcome metrics and all new trend/distribution charts select the same work-order cohort:

- The caller's authorized team, unless the caller is an Administrator.
- Known authoritative order creation metadata. Pending facts with an unknown creation timestamp are excluded rather than counted as an additional order.
- Creation time in the half-open UTC interval `[from,to)` when either boundary is supplied.
- The requested recorded technician, service category and priority filters.

Technician filtering uses the warehouse's recorded assignment, not an inferred historical reporting relationship. The request executes under one read-only PostgreSQL repeatable-read snapshot so an ingestion commit cannot change the denominator between individual chart queries.

## Metrics and API fields

| API field | Definition |
|---|---|
| `completionRate` | Completed work orders divided by selected created work orders. Null when the cohort is empty. |
| `slaComplianceRate` | Completed stage instances with no recorded breach divided by completed stage instances belonging to the cohort. A missing duration does not remove a recorded completion from this SLA-event denominator. Null when no completed stages are recorded. |
| `averageStageMinutes` | Mean effective minutes for completed stages with known start/completion times and valid approved-pause duration. Missing or invalid duration is excluded, never changed to zero. |
| `escalationFrequency` | Distinct cohort orders with one or more recorded stage SLA breaches divided by cohort orders. Multiple breached stages on one order count once. This is a bounded share of orders; it is not a count of breach events or proof that a supervisor notification was delivered. |
| `schedulingEfficiency` | Cohort orders with at least one currently `Confirmed` booking divided by cohort orders. This is booking coverage, not route efficiency, optimizer quality, or a performance-improvement claim. Multiple booking facts do not multiply the numerator. |
| `completedToday` | Orders completed during the current UTC calendar day within the selected creation-date cohort. |

## Trend and distribution payloads

`slaComplianceTrend` contains `{date,completedStages,compliantStages,breachedStages,complianceRate}`. The date is the **UTC completion date of a stage**, after selecting the order creation cohort. A stage completed later than the creation interval remains part of that cohort, so its trend point can lie outside the creation-date filter. Only observed completion dates are returned; missing calendar days are not synthesized as zero performance.

`stageDurationDistribution` contains `{bucket,lowerMinutes,upperMinutes,count}` with the fixed bins `[0,10)`, `[10,20)`, `[20,30)`, `[30,45)`, `[45,60)`, and `[60,+∞)`. The last upper bound is JSON null. `stageDurationSampleCount` is the total number of included completed stage instances. Eligibility requires both timestamps, completion at or after start, and approved pause time no greater than elapsed time. Effective duration is `(completion-start-pause)/60` minutes. A genuine recorded zero-minute duration is included; an unknown start time is not.

The configured bins may all have zero counts. The UI should show an empty observation state when `stageDurationSampleCount` is zero, rather than suggesting that missing durations were measured as zero minutes.

`supervisorInterventionTrend` contains `{date,interventions,affectedWorkOrders,supervisors}`. It groups recorded pause, resume, override and advisory-decision events by their **UTC action date**, for the same selected order creation cohort. Event IDs are deduplicated by warehouse ingestion. Counts of affected orders and recorded supervisors are distinct within each date. As with completion trends, action dates may extend beyond the creation-date interval.

## Independent utilization measure

Technician utilization deliberately uses a different time basis: confirmed appointment minutes overlapping the explicit UTC interval divided by published local working-shift minutes overlapping that interval. It includes an appointment for an order created before the interval. The summary additions do not join this numerator to the creation cohort or change its denominator.

Capacity remains null when timezone/hours or both reporting boundaries are unknown. Published hours do not currently model approved time off, weekend exceptions, or historical schedule changes. This limitation is included in the API's metric definition. Category and priority filters describe the appointment workload in the numerator, while the denominator is the visible technician's published capacity.

## Validation

`tests/backend/WarehouseAnalyticsTests.cs` uses a real PostgreSQL Testcontainers warehouse and the actual Reporting query method. It checks team and technician/category/priority scope, unknown creation metadata, the exclusive upper creation-date boundary, completion/action UTC day grouping, duration bucket boundaries, valid zero versus missing/invalid duration, breach/booking numerator deduplication and null empty-denominator behavior. Run it as part of the backend suite and record executed results in the implementation status; the existence of these tests is not itself a passing result.
