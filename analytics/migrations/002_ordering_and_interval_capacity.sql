-- Additive upgrade for existing warehouses. Applied once by schema_migration.
ALTER TABLE warehouse.ingestion_ledger ADD COLUMN IF NOT EXISTS source_sequence bigint NOT NULL DEFAULT 0;
ALTER TABLE warehouse.fact_work_order ADD COLUMN IF NOT EXISTS order_source_sequence bigint NOT NULL DEFAULT 0;
ALTER TABLE warehouse.fact_work_order ADD COLUMN IF NOT EXISTS order_source_occurred_at_utc timestamptz;
ALTER TABLE warehouse.fact_work_order ADD COLUMN IF NOT EXISTS source_status text NOT NULL DEFAULT 'Created';
ALTER TABLE warehouse.fact_work_order ADD COLUMN IF NOT EXISTS workflow_started_at_utc timestamptz;
ALTER TABLE warehouse.fact_workflow_stage ADD COLUMN IF NOT EXISTS sla_status text NOT NULL DEFAULT 'OnTime';
ALTER TABLE warehouse.dim_technician ADD COLUMN IF NOT EXISTS source_sequence bigint NOT NULL DEFAULT 0;
ALTER TABLE warehouse.dim_technician ADD COLUMN IF NOT EXISTS working_start_hour integer;
ALTER TABLE warehouse.dim_technician ADD COLUMN IF NOT EXISTS working_end_hour integer;
ALTER TABLE warehouse.dim_technician ADD COLUMN IF NOT EXISTS time_zone text;
INSERT INTO warehouse.dim_work_order_status(status) VALUES ('Scheduled') ON CONFLICT DO NOTHING;

-- Legacy staging did not retain sequence numbers. Recover the latest recorded
-- source occurrence, and use that timestamp only until a sequenced event arrives.
-- No cross-service timestamp is used as a total order.
INSERT INTO warehouse.dim_service_category(category)
SELECT DISTINCT safe_payload->>'serviceCategory' FROM warehouse.staging_event
WHERE safe_payload ? 'serviceCategory' ON CONFLICT DO NOTHING;
WITH latest AS (
 SELECT DISTINCT ON (s.work_order_id) s.work_order_id,s.safe_payload,l.occurred_at_utc,l.source_sequence
 FROM warehouse.staging_event s JOIN warehouse.ingestion_ledger l USING(event_id)
 WHERE l.source_service='work-orders' AND l.event_type IN ('WorkOrderCreated.v1','WorkOrderUpdated.v1','WorkOrderCompleted.v1')
 ORDER BY s.work_order_id,l.source_sequence DESC,l.occurred_at_utc DESC,l.ingested_at_utc DESC
)
UPDATE warehouse.fact_work_order o SET
 order_source_sequence=l.source_sequence,order_source_occurred_at_utc=l.occurred_at_utc,
 source_status=coalesce(l.safe_payload->>'status','Created'),
 number=coalesce(l.safe_payload->>'number',o.number),
 priority=coalesce(l.safe_payload->>'priority',o.priority),
 category_key=coalesce((SELECT category_key FROM warehouse.dim_service_category WHERE category=l.safe_payload->>'serviceCategory'),o.category_key)
FROM latest l WHERE o.work_order_id=l.work_order_id;
UPDATE warehouse.fact_work_order o SET workflow_started_at_utc=l.first_start
FROM (SELECT work_order_id,min(occurred_at_utc) first_start FROM warehouse.staging_event
 JOIN warehouse.ingestion_ledger USING(event_id) WHERE event_type='WorkflowStarted.v1' GROUP BY work_order_id) l
WHERE o.work_order_id=l.work_order_id;
UPDATE warehouse.fact_workflow_stage SET sla_status='Breached' WHERE breached;
-- Prior rows did not prove a timezone; do not invent partial-day capacity.
UPDATE warehouse.dim_technician SET capacity_authoritative=false WHERE time_zone IS NULL;

CREATE OR REPLACE VIEW analytics.v_stage_duration AS
SELECT s.stage_instance_id,s.work_order_id,s.stage_key,s.started_at_utc,s.deadline_utc,
 s.completed_at_utc,s.paused_seconds,s.breached,s.status,s.last_sequence,
 CASE WHEN s.completed_at_utc IS NOT NULL AND s.started_at_utc IS NOT NULL
 THEN GREATEST(0,extract(epoch FROM(s.completed_at_utc-s.started_at_utc))-s.paused_seconds)/60.0
 ELSE NULL END AS effective_minutes,s.sla_status
FROM warehouse.fact_workflow_stage s;

CREATE OR REPLACE FUNCTION analytics.refresh_order_status(target_order uuid) RETURNS void
LANGUAGE sql AS $$
 UPDATE warehouse.fact_work_order o SET status_key=s.status_key
 FROM warehouse.dim_work_order_status s
 WHERE o.work_order_id=target_order AND s.status=CASE
   WHEN o.completed_at_utc IS NOT NULL THEN 'Completed'
   WHEN o.source_status='Cancelled' THEN 'Cancelled'
   WHEN o.workflow_started_at_utc IS NOT NULL OR o.source_status='InProgress' THEN 'InProgress'
   WHEN EXISTS(SELECT 1 FROM warehouse.fact_booking b WHERE b.work_order_id=o.work_order_id AND b.status='Confirmed') THEN 'Scheduled'
   WHEN EXISTS(SELECT 1 FROM warehouse.fact_booking b WHERE b.work_order_id=o.work_order_id) THEN 'Created'
   ELSE o.source_status END;
$$;
SELECT analytics.refresh_order_status(work_order_id) FROM warehouse.fact_work_order;

-- Bookings are selected by appointment overlap, independently of the order's
-- creation cohort. Capacity is clipped local working shifts, including DST.
-- Weekends/time-off exclusions remain outside this published-hours model.
CREATE OR REPLACE FUNCTION analytics.technician_utilization(
 p_from timestamptz,p_to timestamptz,p_team text,p_admin boolean,
 p_technician text DEFAULT NULL,p_category text DEFAULT NULL,p_priority text DEFAULT NULL)
RETURNS TABLE(technician_id text,booked_minutes double precision,capacity_minutes double precision,utilization double precision)
LANGUAGE sql STABLE AS $$
 WITH scoped_bookings AS (
  SELECT b.*,t.technician_id FROM warehouse.fact_booking b
  JOIN warehouse.fact_work_order o USING(work_order_id)
  JOIN warehouse.dim_technician t ON t.technician_key=b.technician_key
  LEFT JOIN warehouse.dim_service_category c USING(category_key)
  WHERE b.status='Confirmed' AND (p_admin OR o.team_id=p_team)
    AND (p_technician IS NULL OR t.technician_id=p_technician)
    AND (p_category IS NULL OR c.category=p_category)
    AND (p_priority IS NULL OR o.priority=p_priority)
    AND (p_from IS NULL OR b.end_utc>p_from) AND (p_to IS NULL OR b.start_utc<p_to)
 ), visible_technicians AS (
  SELECT t.* FROM warehouse.dim_technician t
  WHERE (p_admin OR t.team_id=p_team OR EXISTS(SELECT 1 FROM scoped_bookings b WHERE b.technician_key=t.technician_key))
    AND (p_technician IS NULL OR t.technician_id=p_technician)
 ), booked AS (
  SELECT b.technician_key,
   sum(GREATEST(0,extract(epoch FROM(LEAST(b.end_utc,coalesce(p_to,b.end_utc))-GREATEST(b.start_utc,coalesce(p_from,b.start_utc)))))/60.0)::double precision minutes
  FROM scoped_bookings b GROUP BY b.technician_key
 ), capacity AS (
  SELECT t.technician_key,
   sum(GREATEST(0,extract(epoch FROM(LEAST((d.day::date+make_interval(hours=>t.working_end_hour)) AT TIME ZONE t.time_zone,p_to)
     -GREATEST((d.day::date+make_interval(hours=>t.working_start_hour)) AT TIME ZONE t.time_zone,p_from))))/60.0)::double precision minutes
  FROM visible_technicians t
  JOIN pg_timezone_names z ON z.name=t.time_zone
  CROSS JOIN LATERAL generate_series((p_from AT TIME ZONE t.time_zone)::date,
    ((p_to-interval '1 microsecond') AT TIME ZONE t.time_zone)::date,interval '1 day') d(day)
  WHERE p_from IS NOT NULL AND p_to IS NOT NULL AND p_from<p_to
    AND t.capacity_authoritative AND t.working_start_hour>=0 AND t.working_end_hour<=24
    AND t.working_end_hour>t.working_start_hour
  GROUP BY t.technician_key
 )
 SELECT t.technician_id,coalesce(b.minutes,0),c.minutes,
   coalesce(b.minutes,0)/nullif(c.minutes,0)
 FROM visible_technicians t LEFT JOIN booked b USING(technician_key) LEFT JOIN capacity c USING(technician_key)
 ORDER BY t.technician_id;
$$;
