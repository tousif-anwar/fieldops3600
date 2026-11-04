-- Each check must return zero rows. Run in the analytical warehouse.
SELECT 'negative_stage_duration' AS defect, stage_instance_id::text AS entity
FROM warehouse.fact_workflow_stage WHERE completed_at_utc<started_at_utc;
SELECT 'missing_order' AS defect, s.stage_instance_id::text AS entity
FROM warehouse.fact_workflow_stage s LEFT JOIN warehouse.fact_work_order o USING(work_order_id) WHERE o.work_order_id IS NULL;
SELECT 'invalid_booking' AS defect, booking_id::text AS entity
FROM warehouse.fact_booking WHERE end_utc<=start_utc;
SELECT 'unclassified_team' AS defect, work_order_id::text AS entity
FROM warehouse.fact_work_order WHERE team_id='';
SELECT 'missing_stage_dimension' AS defect, stage_instance_id::text AS entity
FROM warehouse.fact_workflow_stage WHERE completed_at_utc IS NOT NULL AND stage_key IS NULL;
