-- Additive guards for states previously enforced only by the projection writer.
-- Existing rows were verified before this migration; no data is rewritten.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- An SCD2 history is a partition of each technician's timeline. The partial
-- unique current-row index is not enough: two closed versions could overlap.
ALTER TABLE warehouse.dim_technician
  ADD CONSTRAINT dim_technician_no_overlap
  EXCLUDE USING gist (
    technician_id WITH =,
    tstzrange(effective_from_utc, effective_to_utc, '[)') WITH &&
  );

ALTER TABLE warehouse.dim_technician
  ADD CONSTRAINT dim_technician_identity_nonempty
    CHECK (btrim(technician_id) <> '' AND btrim(team_id) <> ''),
  ADD CONSTRAINT dim_technician_source_sequence_nonnegative
    CHECK (source_sequence >= 0),
  ADD CONSTRAINT dim_technician_capacity_requirements
    CHECK (NOT capacity_authoritative OR (
      working_start_hour IS NOT NULL AND working_end_hour IS NOT NULL
      AND time_zone IS NOT NULL AND btrim(time_zone) <> ''));

ALTER TABLE warehouse.dim_supervisor
  ADD CONSTRAINT dim_supervisor_nonempty
    CHECK (btrim(supervisor_id) <> '' AND btrim(team_id) <> '');

ALTER TABLE warehouse.dim_customer
  ADD CONSTRAINT dim_customer_reference_nonempty
    CHECK (btrim(customer_reference) <> '');

ALTER TABLE warehouse.dim_service_category
  ADD CONSTRAINT dim_service_category_nonempty CHECK (btrim(category) <> '');

ALTER TABLE warehouse.dim_workflow_stage
  ADD CONSTRAINT dim_workflow_stage_name_nonempty CHECK (btrim(stage_name) <> '');

ALTER TABLE warehouse.dim_work_order_status
  ADD CONSTRAINT dim_work_order_status_allowed
    CHECK (status IN ('Created','Assigned','Scheduled','InProgress','Completed','Cancelled'));

ALTER TABLE warehouse.dim_date
  ADD CONSTRAINT dim_date_month_valid CHECK (calendar_month BETWEEN 1 AND 12),
  ADD CONSTRAINT dim_date_weekday_valid CHECK (day_of_week BETWEEN 1 AND 7);

ALTER TABLE warehouse.ingestion_ledger
  ADD CONSTRAINT ingestion_ledger_hash_sha256 CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT ingestion_ledger_identity_nonempty
    CHECK (btrim(event_type) <> '' AND btrim(source_service) <> ''),
  ADD CONSTRAINT ingestion_ledger_sequence_nonnegative CHECK (source_sequence >= 0);

ALTER TABLE warehouse.staging_event
  ADD CONSTRAINT staging_event_payload_object CHECK (jsonb_typeof(safe_payload) = 'object');

ALTER TABLE warehouse.fact_work_order
  ADD CONSTRAINT fact_work_order_team_nonempty CHECK (btrim(team_id) <> ''),
  ADD CONSTRAINT fact_work_order_priority_allowed
    CHECK (priority IN ('Low','Normal','High','Critical')),
  ADD CONSTRAINT fact_work_order_source_status_allowed
    CHECK (source_status IN ('Created','Scheduled','InProgress','Completed','Cancelled')),
  ADD CONSTRAINT fact_work_order_source_sequence_nonnegative
    CHECK (order_source_sequence >= 0),
  ADD CONSTRAINT fact_work_order_completion_after_creation
    CHECK (completed_at_utc IS NULL OR created_at_utc IS NULL OR completed_at_utc >= created_at_utc);

ALTER TABLE warehouse.fact_workflow_stage
  ADD CONSTRAINT fact_workflow_stage_status_allowed
    CHECK (status IN ('Active','Paused','Completed','Overridden')),
  ADD CONSTRAINT fact_workflow_stage_sla_status_allowed
    CHECK (sla_status IN ('OnTime','Warning','Critical','Breached')),
  ADD CONSTRAINT fact_workflow_stage_breach_consistent
    CHECK (NOT breached OR sla_status = 'Breached'),
  ADD CONSTRAINT fact_workflow_stage_completion_after_start
    CHECK (completed_at_utc IS NULL OR started_at_utc IS NULL OR completed_at_utc >= started_at_utc);

ALTER TABLE warehouse.fact_booking
  ADD CONSTRAINT fact_booking_status_allowed CHECK (status IN ('Confirmed','Cancelled')),
  ADD CONSTRAINT fact_booking_source_version_nonnegative CHECK (source_version >= 0),
  ADD CONSTRAINT fact_booking_interval_paired
    CHECK ((start_utc IS NULL) = (end_utc IS NULL)),
  ADD CONSTRAINT fact_booking_confirmed_has_interval
    CHECK (status <> 'Confirmed' OR (start_utc IS NOT NULL AND end_utc IS NOT NULL));

-- A breach is observed for a stage; retain the event ledger as its identity and
-- require the projected stage row to exist in the same warehouse.
ALTER TABLE warehouse.fact_sla_breach
  ADD CONSTRAINT fact_sla_breach_stage_fkey
    FOREIGN KEY (stage_instance_id) REFERENCES warehouse.fact_workflow_stage(stage_instance_id);

ALTER TABLE warehouse.fact_supervisor_intervention
  ADD CONSTRAINT fact_supervisor_intervention_type_nonempty
    CHECK (btrim(intervention_type) <> '');

ALTER TABLE warehouse.fact_technician_time_off
  ADD CONSTRAINT fact_technician_time_off_identity_nonempty
    CHECK (btrim(technician_id) <> '' AND btrim(team_id) <> ''),
  ADD CONSTRAINT fact_technician_time_off_sequence_nonnegative
    CHECK (source_sequence >= 0);

-- The confirmed-booking access path is a likely production index candidate,
-- but the current local warehouse is too small to justify or measure it.
-- Do not add speculative indexes without an EXPLAIN comparison at realistic volume.