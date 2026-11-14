-- Forward-only checks for states that the HTTP boundary already validates.
-- These protect retainers, scripts and future callers from bypassing domain rules.
ALTER TABLE work_orders
  ADD CONSTRAINT work_orders_number_nonempty CHECK (btrim("Number") <> ''),
  ADD CONSTRAINT work_orders_title_nonempty CHECK (btrim("Title") <> ''),
  ADD CONSTRAINT work_orders_customer_nonempty CHECK (btrim("CustomerName") <> ''),
  ADD CONSTRAINT work_orders_site_nonempty CHECK (btrim("SiteAddress") <> ''),
  ADD CONSTRAINT work_orders_team_nonempty CHECK (btrim("TeamId") <> ''),
  ADD CONSTRAINT work_orders_status_allowed
    CHECK ("Status" IN ('Created', 'Scheduled', 'InProgress', 'Completed', 'Cancelled')),
  ADD CONSTRAINT work_orders_priority_allowed
    CHECK ("Priority" IN ('Low', 'Normal', 'High', 'Critical')),
  ADD CONSTRAINT work_orders_category_allowed
    CHECK ("ServiceCategory" IN ('HVAC', 'Electrical', 'Mechanical', 'Refrigeration', 'Controls', 'Heating', 'Cooling', 'Ventilation')),
  ADD CONSTRAINT work_orders_version_positive CHECK ("Version" > 0),
  ADD CONSTRAINT work_orders_completion_after_creation
    CHECK ("CompletedAtUtc" IS NULL OR "CompletedAtUtc" >= "CreatedAtUtc");

ALTER TABLE outbox_messages
  ADD CONSTRAINT outbox_attempts_nonnegative CHECK ("Attempts" >= 0),
  ADD CONSTRAINT outbox_body_is_object CHECK (jsonb_typeof("Body"::jsonb) = 'object');

-- Exact access paths: team-scoped recent list, and the technician's own recent list.
CREATE INDEX work_orders_team_recent
  ON work_orders ("TeamId", "CreatedAtUtc" DESC, "Id");
CREATE INDEX work_orders_technician_recent
  ON work_orders ("TechnicianId", "CreatedAtUtc" DESC)
  WHERE "TechnicianId" IS NOT NULL;
-- The dispatcher only scans unpublished rows; keep that hot index small.
CREATE INDEX outbox_pending_dispatch
  ON outbox_messages ("NextAttemptAtUtc", "CreatedAtUtc")
  WHERE "PublishedAtUtc" IS NULL;
