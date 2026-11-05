-- Technician history becomes a real type-2 dimension. Existing rows are retained
-- as the current version; historical epochs can only be reconstructed from the
-- technician events already preserved in warehouse.staging_event.
ALTER TABLE warehouse.dim_technician
  ADD COLUMN IF NOT EXISTS effective_from_utc timestamptz,
  ADD COLUMN IF NOT EXISTS effective_to_utc timestamptz,
  ADD COLUMN IF NOT EXISTS is_current boolean,
  ADD COLUMN IF NOT EXISTS supervisor_id text,
  ADD COLUMN IF NOT EXISTS skills jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS certifications jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS available boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS row_hash text;

UPDATE warehouse.dim_technician t
SET effective_from_utc = COALESCE(
      (SELECT min(l.occurred_at_utc)
       FROM warehouse.staging_event s
       JOIN warehouse.ingestion_ledger l USING (event_id)
       WHERE l.source_service = 'technicians'
         AND s.safe_payload->>'technicianId' = t.technician_id),
      '-infinity'::timestamptz),
    effective_to_utc = NULL,
    is_current = true,
    row_hash = COALESCE(t.row_hash, md5(concat_ws('|', t.technician_id, t.team_id,
      coalesce(t.supervisor_id, ''), t.working_start_hour::text,
      t.working_end_hour::text, coalesce(t.time_zone, ''), t.available::text)));

ALTER TABLE warehouse.dim_technician
  DROP CONSTRAINT IF EXISTS dim_technician_technician_id_key;
DROP INDEX IF EXISTS warehouse.dim_technician_technician_id_key;

ALTER TABLE warehouse.dim_technician
  ALTER COLUMN effective_from_utc SET NOT NULL,
  ALTER COLUMN is_current SET NOT NULL;

ALTER TABLE warehouse.dim_technician
  ADD CONSTRAINT dim_technician_effective_range
    CHECK (effective_to_utc IS NULL OR effective_to_utc > effective_from_utc),
  ADD CONSTRAINT dim_technician_current_consistency
    CHECK ((is_current AND effective_to_utc IS NULL) OR (NOT is_current AND effective_to_utc IS NOT NULL)),
  ADD CONSTRAINT dim_technician_hours_valid
    CHECK ((working_start_hour IS NULL AND working_end_hour IS NULL AND time_zone IS NULL)
      OR (working_start_hour BETWEEN 0 AND 23 AND working_end_hour BETWEEN 1 AND 24
          AND working_start_hour < working_end_hour AND btrim(time_zone) <> '')),
  ADD CONSTRAINT dim_technician_skills_array CHECK (jsonb_typeof(skills) = 'array'),
  ADD CONSTRAINT dim_technician_certifications_array CHECK (jsonb_typeof(certifications) = 'array');

CREATE UNIQUE INDEX dim_technician_current
  ON warehouse.dim_technician (technician_id) WHERE is_current;
CREATE INDEX dim_technician_effective
  ON warehouse.dim_technician (technician_id, effective_from_utc DESC);
CREATE INDEX dim_technician_current_team
  ON warehouse.dim_technician (team_id, technician_id) WHERE is_current;

-- A time-off event is an observed fact, not a mutable operational table copy.
-- Reason is intentionally excluded by the worker's safe-field projection.
CREATE TABLE IF NOT EXISTS warehouse.fact_technician_time_off (
  event_id uuid PRIMARY KEY REFERENCES warehouse.ingestion_ledger(event_id),
  time_off_id uuid NOT NULL UNIQUE,
  technician_key bigint REFERENCES warehouse.dim_technician(technician_key),
  technician_id text NOT NULL,
  team_id text NOT NULL,
  start_utc timestamptz NOT NULL,
  end_utc timestamptz NOT NULL,
  source_sequence bigint NOT NULL DEFAULT 0,
  recorded_at_utc timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fact_technician_time_off_interval CHECK (end_utc > start_utc)
);
CREATE INDEX fact_technician_time_off_lookup
  ON warehouse.fact_technician_time_off (technician_id, start_utc, end_utc);

-- The privacy placeholder is intentionally fixed and non-identifying. Existing
-- unresolved facts are pointed at it rather than retaining a NULL customer key.
INSERT INTO warehouse.dim_customer(customer_reference)
VALUES ('unresolved-synthetic-reference') ON CONFLICT DO NOTHING;
UPDATE warehouse.fact_work_order o
SET customer_key = c.customer_key
FROM warehouse.dim_customer c
WHERE o.customer_key IS NULL AND c.customer_reference = 'unresolved-synthetic-reference';

CREATE INDEX IF NOT EXISTS fact_booking_work_order
  ON warehouse.fact_booking (work_order_id, status);
CREATE INDEX IF NOT EXISTS fact_workflow_stage_work_order
  ON warehouse.fact_workflow_stage (work_order_id);
CREATE INDEX IF NOT EXISTS fact_sla_breach_work_order
  ON warehouse.fact_sla_breach (work_order_id);
CREATE INDEX IF NOT EXISTS fact_supervisor_intervention_work_order
  ON warehouse.fact_supervisor_intervention (work_order_id, occurred_at_utc);

-- Capacity is calculated over the SCD2 versions that overlap the requested
-- interval. Weekends are non-working under the published Mon-Fri calendar.
-- Time off is subtracted per shift and capped at that shift's duration.
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
  SELECT t.technician_id
  FROM warehouse.dim_technician t
  WHERE t.is_current
    AND (p_admin OR t.team_id=p_team OR EXISTS(SELECT 1 FROM scoped_bookings b WHERE b.technician_id=t.technician_id))
    AND (p_technician IS NULL OR t.technician_id=p_technician)
 ), booked AS (
  SELECT b.technician_id,
   sum(GREATEST(0,extract(epoch FROM(LEAST(b.end_utc,coalesce(p_to,b.end_utc))-GREATEST(b.start_utc,coalesce(p_from,b.start_utc)))))/60.0)::double precision minutes
  FROM scoped_bookings b GROUP BY b.technician_id
 ), versions AS (
  SELECT t.*
  FROM warehouse.dim_technician t JOIN visible_technicians v USING(technician_id)
  WHERE p_from IS NOT NULL AND p_to IS NOT NULL AND p_from<p_to
    AND t.capacity_authoritative AND t.working_start_hour>=0 AND t.working_end_hour<=24
    AND t.working_end_hour>t.working_start_hour AND t.time_zone IS NOT NULL
    AND EXISTS(SELECT 1 FROM pg_timezone_names z WHERE z.name=t.time_zone)
    AND t.effective_from_utc<p_to
    AND (t.effective_to_utc IS NULL OR t.effective_to_utc>p_from)
 ), days AS (
  SELECT v.technician_id,v.working_start_hour,v.working_end_hour,v.time_zone,d.day::date local_day,
    GREATEST(v.effective_from_utc,p_from) segment_start,
    LEAST(coalesce(v.effective_to_utc,'infinity'::timestamptz),p_to) segment_end
  FROM versions v
  CROSS JOIN LATERAL generate_series(
    (GREATEST(v.effective_from_utc,p_from) AT TIME ZONE v.time_zone)::date,
    ((LEAST(coalesce(v.effective_to_utc,'infinity'::timestamptz),p_to)-interval '1 microsecond') AT TIME ZONE v.time_zone)::date,
    interval '1 day') d(day)
  WHERE extract(isodow FROM d.day) BETWEEN 1 AND 5
 ), shifts AS (
  SELECT technician_id,local_day,
    GREATEST((local_day+make_interval(hours=>working_start_hour)) AT TIME ZONE time_zone,segment_start) shift_start,
    LEAST((local_day+make_interval(hours=>working_end_hour)) AT TIME ZONE time_zone,segment_end) shift_end
  FROM days
 ), shift_minutes AS (
  SELECT s.*,extract(epoch FROM(shift_end-shift_start))/60.0 minutes
  FROM shifts s WHERE shift_end>shift_start
 ), shift_capacity AS (
  SELECT s.*,LEAST(s.minutes,coalesce((
    SELECT sum(GREATEST(0,extract(epoch FROM(LEAST(f.end_utc,s.shift_end)-GREATEST(f.start_utc,s.shift_start)))/60.0))
    FROM warehouse.fact_technician_time_off f
    WHERE f.technician_id=s.technician_id AND f.start_utc<s.shift_end AND f.end_utc>s.shift_start
  ),0)) unavailable_minutes
  FROM shift_minutes s
 ), capacity AS (
  SELECT technician_id,sum(GREATEST(0,minutes-unavailable_minutes))::double precision minutes
  FROM shift_capacity GROUP BY technician_id
 )
 SELECT t.technician_id,coalesce(b.minutes,0),c.minutes,
   coalesce(b.minutes,0)/nullif(c.minutes,0)
 FROM visible_technicians t LEFT JOIN booked b USING(technician_id) LEFT JOIN capacity c USING(technician_id)
 ORDER BY t.technician_id;
$$;
