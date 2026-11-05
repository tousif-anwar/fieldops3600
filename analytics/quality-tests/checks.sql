-- Every query returns only defective rows. Any row is a blocking data-quality
-- failure; run_checks.py exits nonzero and reports the defect/entity pairs.
-- Severity for all current checks is critical because each one makes a fact,
-- historical dimension, denominator, or replay-independent KPI unreliable.

-- Stage and work-order temporal/relational integrity.
SELECT 'negative_stage_duration' AS defect, stage_instance_id::text AS entity
FROM warehouse.fact_workflow_stage
WHERE completed_at_utc < started_at_utc;

SELECT 'stage_completion_before_start' AS defect, stage_instance_id::text AS entity
FROM warehouse.fact_workflow_stage
WHERE started_at_utc IS NOT NULL AND completed_at_utc IS NOT NULL
  AND completed_at_utc < started_at_utc;

SELECT 'stage_breach_without_breached_status' AS defect, stage_instance_id::text AS entity
FROM warehouse.fact_workflow_stage
WHERE breached AND sla_status <> 'Breached';

SELECT 'invalid_stage_status' AS defect, stage_instance_id::text AS entity
FROM warehouse.fact_workflow_stage
WHERE status NOT IN ('Active','Paused','Completed','Overridden');

SELECT 'invalid_stage_sla_status' AS defect, stage_instance_id::text AS entity
FROM warehouse.fact_workflow_stage
WHERE sla_status NOT IN ('OnTime','Warning','Critical','Breached');

SELECT 'missing_order' AS defect, s.stage_instance_id::text AS entity
FROM warehouse.fact_workflow_stage s
LEFT JOIN warehouse.fact_work_order o USING(work_order_id)
WHERE o.work_order_id IS NULL;

SELECT 'missing_stage_dimension' AS defect, stage_instance_id::text AS entity
FROM warehouse.fact_workflow_stage
WHERE completed_at_utc IS NOT NULL AND stage_key IS NULL;

SELECT 'unclassified_team' AS defect, work_order_id::text AS entity
FROM warehouse.fact_work_order
WHERE btrim(team_id) = '';

SELECT 'missing_order_status_dimension' AS defect, work_order_id::text AS entity
FROM warehouse.fact_work_order
WHERE status_key IS NULL;

SELECT 'missing_order_category_dimension' AS defect, work_order_id::text AS entity
FROM warehouse.fact_work_order
WHERE category_key IS NULL;

SELECT 'invalid_order_priority' AS defect, work_order_id::text AS entity
FROM warehouse.fact_work_order
WHERE priority NOT IN ('Low','Normal','High','Critical');

SELECT 'order_completed_before_creation' AS defect, work_order_id::text AS entity
FROM warehouse.fact_work_order
WHERE completed_at_utc IS NOT NULL AND created_at_utc IS NOT NULL
  AND completed_at_utc < created_at_utc;

SELECT 'terminal_status_regression' AS defect, o.work_order_id::text AS entity
FROM warehouse.fact_work_order o
JOIN warehouse.dim_work_order_status s USING(status_key)
WHERE o.completed_at_utc IS NOT NULL AND s.status <> 'Completed';

-- Booking interval and projected source-invariant checks.
SELECT 'invalid_booking' AS defect, booking_id::text AS entity
FROM warehouse.fact_booking
WHERE end_utc <= start_utc;

SELECT 'booking_interval_not_paired' AS defect, booking_id::text AS entity
FROM warehouse.fact_booking
WHERE (start_utc IS NULL) <> (end_utc IS NULL);

SELECT 'confirmed_booking_without_interval' AS defect, booking_id::text AS entity
FROM warehouse.fact_booking
WHERE status = 'Confirmed' AND (start_utc IS NULL OR end_utc IS NULL);

SELECT 'invalid_booking_status' AS defect, booking_id::text AS entity
FROM warehouse.fact_booking
WHERE status NOT IN ('Confirmed','Cancelled');

SELECT 'multiple_confirmed_bookings_per_order' AS defect, work_order_id::text AS entity
FROM warehouse.fact_booking
WHERE status = 'Confirmed'
GROUP BY work_order_id
HAVING count(*) > 1;

SELECT 'overlapping_confirmed_bookings' AS defect,
       a.booking_id::text || ' / ' || b.booking_id::text AS entity
FROM warehouse.fact_booking a
JOIN warehouse.fact_booking b
  ON a.booking_id < b.booking_id
 AND a.technician_key = b.technician_key
 AND a.status = 'Confirmed' AND b.status = 'Confirmed'
 AND a.technician_key IS NOT NULL
 AND tstzrange(a.start_utc, a.end_utc, '[)') && tstzrange(b.start_utc, b.end_utc, '[)');

-- SCD technician history: one current version, contiguous half-open ranges,
-- and no overlapping epochs. The database also enforces these where possible.
WITH ordered AS (
    SELECT technician_id, effective_from_utc, effective_to_utc,
           lead(effective_from_utc) OVER (
               PARTITION BY technician_id ORDER BY effective_from_utc
           ) AS next_from
    FROM warehouse.dim_technician
)
SELECT 'scd2_history_gap' AS defect,
       technician_id || '|' || effective_from_utc::text AS entity
FROM ordered
WHERE next_from IS NOT NULL
  AND coalesce(effective_to_utc, 'infinity'::timestamptz) <> next_from;

SELECT 'scd2_overlapping_versions' AS defect,
       a.technician_id || '|' || a.technician_key || '/' || b.technician_key AS entity
FROM warehouse.dim_technician a
JOIN warehouse.dim_technician b
  ON a.technician_id = b.technician_id
 AND a.technician_key < b.technician_key
 AND a.effective_from_utc < coalesce(b.effective_to_utc, 'infinity'::timestamptz)
 AND b.effective_from_utc < coalesce(a.effective_to_utc, 'infinity'::timestamptz);

SELECT 'scd2_multiple_current_rows' AS defect, technician_id AS entity
FROM warehouse.dim_technician
GROUP BY technician_id
HAVING count(*) FILTER (WHERE is_current) <> 1;

SELECT 'scd2_current_row_has_end' AS defect, technician_key::text AS entity
FROM warehouse.dim_technician
WHERE is_current AND effective_to_utc IS NOT NULL;

SELECT 'scd2_closed_row_missing_end' AS defect, technician_key::text AS entity
FROM warehouse.dim_technician
WHERE NOT is_current AND effective_to_utc IS NULL;

SELECT 'scd2_capacity_without_hours' AS defect, technician_key::text AS entity
FROM warehouse.dim_technician
WHERE capacity_authoritative
  AND (working_start_hour IS NULL OR working_end_hour IS NULL OR time_zone IS NULL);

-- Time off must resolve to the historical technician version and a current
-- dimension identity; the operational interval itself is checked at its source.
SELECT 'time_off_without_dimension' AS defect, f.time_off_id::text AS entity
FROM warehouse.fact_technician_time_off f
LEFT JOIN warehouse.dim_technician t ON t.technician_key = f.technician_key
WHERE f.technician_key IS NULL OR t.technician_id IS DISTINCT FROM f.technician_id;

-- Event ledger and staging are one-to-one projections of accepted events.
SELECT 'ledger_without_staging' AS defect, l.event_id::text AS entity
FROM warehouse.ingestion_ledger l
LEFT JOIN warehouse.staging_event s USING(event_id)
WHERE s.event_id IS NULL;

SELECT 'invalid_event_hash' AS defect, event_id::text AS entity
FROM warehouse.ingestion_ledger
WHERE payload_hash !~ '^[0-9a-f]{64}$';

SELECT 'negative_source_sequence' AS defect, event_id::text AS entity
FROM warehouse.ingestion_ledger
WHERE source_sequence < 0;

SELECT 'staging_payload_not_object' AS defect, event_id::text AS entity
FROM warehouse.staging_event
WHERE jsonb_typeof(safe_payload) <> 'object';

-- Metric denominator/numerator consistency. These views are derived; failures
-- point to an upstream fact/dimension defect rather than a view-only issue.
SELECT 'completion_rate_out_of_bounds' AS defect, team_id AS entity
FROM analytics.v_team_summary
WHERE completion_rate < 0 OR completion_rate > 1;

SELECT 'sla_compliance_out_of_bounds' AS defect, team_id AS entity
FROM analytics.v_team_summary
WHERE sla_compliance_rate < 0 OR sla_compliance_rate > 1;

SELECT 'scheduling_efficiency_out_of_bounds' AS defect, team_id AS entity
FROM analytics.v_team_summary
WHERE scheduling_efficiency < 0 OR scheduling_efficiency > 1;
