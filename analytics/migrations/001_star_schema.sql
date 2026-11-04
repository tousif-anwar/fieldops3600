-- Warehouse only. Operational service databases are never queried by this migration.
CREATE SCHEMA IF NOT EXISTS warehouse;
CREATE SCHEMA IF NOT EXISTS analytics;

CREATE TABLE IF NOT EXISTS warehouse.ingestion_ledger (
    event_id uuid PRIMARY KEY, event_type text NOT NULL, source_service text NOT NULL,
    occurred_at_utc timestamptz NOT NULL, ingested_at_utc timestamptz NOT NULL DEFAULT now(),
    payload_hash text NOT NULL, schema_version integer NOT NULL CHECK (schema_version = 1)
);
CREATE TABLE IF NOT EXISTS warehouse.staging_event (
    event_id uuid PRIMARY KEY REFERENCES warehouse.ingestion_ledger(event_id),
    work_order_id uuid NOT NULL, safe_payload jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS warehouse.dim_date (
    date_key integer PRIMARY KEY, calendar_date date UNIQUE NOT NULL,
    calendar_year integer NOT NULL, calendar_month integer NOT NULL, day_of_week integer NOT NULL
);
CREATE TABLE IF NOT EXISTS warehouse.dim_technician (
    technician_key bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    technician_id text UNIQUE NOT NULL, team_id text NOT NULL,
    working_minutes_per_day integer NOT NULL DEFAULT 540 CHECK (working_minutes_per_day BETWEEN 1 AND 1440),
    capacity_authoritative boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS warehouse.dim_supervisor (
    supervisor_key bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    supervisor_id text UNIQUE NOT NULL, team_id text NOT NULL
);
CREATE TABLE IF NOT EXISTS warehouse.dim_customer (
    customer_key bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_reference text UNIQUE NOT NULL
);
CREATE TABLE IF NOT EXISTS warehouse.dim_service_category (
    category_key bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, category text UNIQUE NOT NULL
);
CREATE TABLE IF NOT EXISTS warehouse.dim_workflow_stage (
    stage_key bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, stage_index integer UNIQUE NOT NULL,
    stage_name text NOT NULL, CHECK (stage_index BETWEEN 0 AND 7)
);
CREATE TABLE IF NOT EXISTS warehouse.dim_work_order_status (
    status_key bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, status text UNIQUE NOT NULL
);
INSERT INTO warehouse.dim_customer(customer_reference) VALUES ('unresolved-synthetic-reference') ON CONFLICT DO NOTHING;
INSERT INTO warehouse.dim_service_category(category) VALUES ('Unknown') ON CONFLICT DO NOTHING;
INSERT INTO warehouse.dim_work_order_status(status) VALUES ('Created'),('Assigned'),('InProgress'),('Completed'),('Cancelled') ON CONFLICT DO NOTHING;
INSERT INTO warehouse.dim_workflow_stage(stage_index,stage_name) VALUES
  (0,'Job Accepted'),(1,'Travel / Arrival'),(2,'Initial Inspection'),(3,'Diagnosis'),
  (4,'Repair / Service'),(5,'Quality Verification'),(6,'Customer Confirmation'),(7,'Job Completion') ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS warehouse.fact_work_order (
    work_order_id uuid PRIMARY KEY, number text NOT NULL DEFAULT '', team_id text NOT NULL,
    technician_key bigint REFERENCES warehouse.dim_technician,
    customer_key bigint REFERENCES warehouse.dim_customer,
    category_key bigint REFERENCES warehouse.dim_service_category,
    status_key bigint REFERENCES warehouse.dim_work_order_status,
    created_date_key integer REFERENCES warehouse.dim_date,
    priority text NOT NULL DEFAULT 'Normal', created_at_utc timestamptz,
    completed_at_utc timestamptz, last_occurrence_utc timestamptz NOT NULL,
    last_ingested_at_utc timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fact_work_order_scope ON warehouse.fact_work_order(team_id,created_at_utc);
CREATE TABLE IF NOT EXISTS warehouse.fact_workflow_stage (
    stage_instance_id uuid PRIMARY KEY, work_order_id uuid NOT NULL REFERENCES warehouse.fact_work_order,
    stage_key bigint REFERENCES warehouse.dim_workflow_stage, started_at_utc timestamptz,
    deadline_utc timestamptz, completed_at_utc timestamptz,
    paused_seconds double precision NOT NULL DEFAULT 0 CHECK (paused_seconds>=0),
    breached boolean NOT NULL DEFAULT false, status text NOT NULL DEFAULT 'Active',
    last_sequence bigint NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS warehouse.fact_booking (
    booking_id uuid PRIMARY KEY, work_order_id uuid NOT NULL REFERENCES warehouse.fact_work_order,
    technician_key bigint REFERENCES warehouse.dim_technician,
    start_utc timestamptz, end_utc timestamptz, status text NOT NULL,
    source_version bigint NOT NULL DEFAULT 0, CHECK(end_utc>start_utc)
);
CREATE TABLE IF NOT EXISTS warehouse.fact_sla_breach (
    event_id uuid PRIMARY KEY REFERENCES warehouse.ingestion_ledger,
    work_order_id uuid NOT NULL REFERENCES warehouse.fact_work_order,
    stage_instance_id uuid NOT NULL, occurred_at_utc timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS warehouse.fact_supervisor_intervention (
    event_id uuid PRIMARY KEY REFERENCES warehouse.ingestion_ledger,
    work_order_id uuid NOT NULL REFERENCES warehouse.fact_work_order,
    supervisor_key bigint REFERENCES warehouse.dim_supervisor,
    intervention_type text NOT NULL, occurred_at_utc timestamptz NOT NULL
);

CREATE OR REPLACE VIEW analytics.v_stage_duration AS
SELECT s.*, GREATEST(0,extract(epoch FROM (completed_at_utc-started_at_utc))-paused_seconds)/60.0 AS effective_minutes
FROM warehouse.fact_workflow_stage s;

-- Aggregate per team preserves the service resource boundary in reporting queries.
CREATE OR REPLACE VIEW analytics.v_team_summary AS
WITH orders AS (
 SELECT team_id,count(*) FILTER (WHERE created_at_utc IS NOT NULL) AS total_work_orders,
 count(*) FILTER (WHERE completed_at_utc IS NOT NULL) AS completed_work_orders,
 avg(extract(epoch FROM (completed_at_utc-created_at_utc))/60.0) FILTER (WHERE completed_at_utc IS NOT NULL AND created_at_utc IS NOT NULL) AS average_service_minutes,
 max(last_ingested_at_utc) AS last_ingested_at_utc
 FROM warehouse.fact_work_order GROUP BY team_id
), stages AS (
 SELECT o.team_id,count(*) FILTER(WHERE s.completed_at_utc IS NOT NULL) AS completed_stages,
 count(*) FILTER(WHERE s.completed_at_utc IS NOT NULL AND NOT s.breached) AS compliant_stages,
 avg(s.effective_minutes) FILTER(WHERE s.completed_at_utc IS NOT NULL) AS average_stage_minutes,
 count(*) FILTER(WHERE s.breached) AS breaches
 FROM analytics.v_stage_duration s JOIN warehouse.fact_work_order o USING(work_order_id) GROUP BY o.team_id
), bookings AS (
 SELECT o.team_id,count(DISTINCT b.work_order_id) FILTER(WHERE b.status='Confirmed') AS assigned_orders,
 sum(extract(epoch FROM(b.end_utc-b.start_utc))/60.0) FILTER(WHERE b.status='Confirmed') AS booked_minutes,
 sum(t.working_minutes_per_day) FILTER(WHERE b.status='Confirmed') AS booking_capacity_minutes
 FROM warehouse.fact_booking b JOIN warehouse.fact_work_order o USING(work_order_id)
 LEFT JOIN warehouse.dim_technician t ON t.technician_key=b.technician_key GROUP BY o.team_id
)
SELECT o.*,o.completed_work_orders::double precision/nullif(o.total_work_orders,0) AS completion_rate,
 s.compliant_stages::double precision/nullif(s.completed_stages,0) AS sla_compliance_rate,
 s.average_stage_minutes,s.breaches::double precision/nullif(o.total_work_orders,0) AS escalation_frequency,
 b.assigned_orders::double precision/nullif(o.total_work_orders,0) AS scheduling_efficiency,
 NULL::double precision AS technician_utilization
FROM orders o LEFT JOIN stages s USING(team_id) LEFT JOIN bookings b USING(team_id);

CREATE OR REPLACE VIEW analytics.v_summary AS
SELECT count(*) FILTER(WHERE created_at_utc IS NOT NULL) AS total_work_orders,
 count(*) FILTER(WHERE completed_at_utc IS NOT NULL) AS completed_work_orders,
 count(*) FILTER(WHERE completed_at_utc IS NOT NULL)::double precision/nullif(count(*) FILTER(WHERE created_at_utc IS NOT NULL),0) AS completion_rate,
 (SELECT count(*) FILTER(WHERE completed_at_utc IS NOT NULL AND NOT breached)::double precision/nullif(count(*) FILTER(WHERE completed_at_utc IS NOT NULL),0) FROM warehouse.fact_workflow_stage) AS sla_compliance_rate,
 avg(extract(epoch FROM(completed_at_utc-created_at_utc))/60.0) AS average_service_minutes,
 (SELECT avg(effective_minutes) FROM analytics.v_stage_duration WHERE completed_at_utc IS NOT NULL) AS average_stage_minutes,
 NULL::double precision AS technician_utilization,
 (SELECT count(*)::double precision FROM warehouse.fact_sla_breach)/nullif(count(*) FILTER(WHERE created_at_utc IS NOT NULL),0) AS escalation_frequency,
 (SELECT count(DISTINCT work_order_id)::double precision FROM warehouse.fact_booking WHERE status='Confirmed')/nullif(count(*) FILTER(WHERE created_at_utc IS NOT NULL),0) AS scheduling_efficiency,
 max(last_ingested_at_utc) AS last_ingested_at_utc
FROM warehouse.fact_work_order;
