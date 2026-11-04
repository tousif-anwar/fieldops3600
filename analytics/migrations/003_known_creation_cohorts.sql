-- Unknown creation metadata is a pending projection, not an additional member
-- of the denominator. Keep all numerator and denominator facts in one cohort.
CREATE OR REPLACE VIEW analytics.v_team_summary AS
WITH eligible AS (
 SELECT * FROM warehouse.fact_work_order WHERE created_at_utc IS NOT NULL
), orders AS (
 SELECT team_id,count(*) AS total_work_orders,
 count(*) FILTER(WHERE completed_at_utc IS NOT NULL) AS completed_work_orders,
 avg(extract(epoch FROM(completed_at_utc-created_at_utc))/60.0) FILTER(WHERE completed_at_utc IS NOT NULL) AS average_service_minutes,
 max(last_ingested_at_utc) AS last_ingested_at_utc
 FROM eligible GROUP BY team_id
), stages AS (
 SELECT o.team_id,count(*) FILTER(WHERE s.completed_at_utc IS NOT NULL) AS completed_stages,
 count(*) FILTER(WHERE s.completed_at_utc IS NOT NULL AND NOT s.breached) AS compliant_stages,
 avg(s.effective_minutes) FILTER(WHERE s.completed_at_utc IS NOT NULL) AS average_stage_minutes,
 count(*) FILTER(WHERE s.breached) AS breaches
 FROM analytics.v_stage_duration s JOIN eligible o USING(work_order_id) GROUP BY o.team_id
), bookings AS (
 SELECT o.team_id,count(DISTINCT b.work_order_id) FILTER(WHERE b.status='Confirmed') AS assigned_orders
 FROM warehouse.fact_booking b JOIN eligible o USING(work_order_id) GROUP BY o.team_id
)
SELECT o.*,o.completed_work_orders::double precision/nullif(o.total_work_orders,0) AS completion_rate,
 s.compliant_stages::double precision/nullif(s.completed_stages,0) AS sla_compliance_rate,
 s.average_stage_minutes,s.breaches::double precision/nullif(o.total_work_orders,0) AS escalation_frequency,
 b.assigned_orders::double precision/nullif(o.total_work_orders,0) AS scheduling_efficiency,
 NULL::double precision AS technician_utilization
FROM orders o LEFT JOIN stages s USING(team_id) LEFT JOIN bookings b USING(team_id);

CREATE OR REPLACE VIEW analytics.v_summary AS
WITH eligible AS (SELECT * FROM warehouse.fact_work_order WHERE created_at_utc IS NOT NULL)
SELECT count(*) AS total_work_orders,
 count(*) FILTER(WHERE completed_at_utc IS NOT NULL) AS completed_work_orders,
 count(*) FILTER(WHERE completed_at_utc IS NOT NULL)::double precision/nullif(count(*),0) AS completion_rate,
 (SELECT count(*) FILTER(WHERE s.completed_at_utc IS NOT NULL AND NOT s.breached)::double precision/nullif(count(*) FILTER(WHERE s.completed_at_utc IS NOT NULL),0)
  FROM warehouse.fact_workflow_stage s JOIN eligible o USING(work_order_id)) AS sla_compliance_rate,
 avg(extract(epoch FROM(completed_at_utc-created_at_utc))/60.0) AS average_service_minutes,
 (SELECT avg(s.effective_minutes) FROM analytics.v_stage_duration s JOIN eligible o USING(work_order_id) WHERE s.completed_at_utc IS NOT NULL) AS average_stage_minutes,
 NULL::double precision AS technician_utilization,
 (SELECT count(*)::double precision FROM warehouse.fact_sla_breach b JOIN eligible o USING(work_order_id))/nullif(count(*),0) AS escalation_frequency,
 (SELECT count(DISTINCT b.work_order_id)::double precision FROM warehouse.fact_booking b JOIN eligible o USING(work_order_id) WHERE b.status='Confirmed')/nullif(count(*),0) AS scheduling_efficiency,
 max(last_ingested_at_utc) AS last_ingested_at_utc
FROM eligible;
