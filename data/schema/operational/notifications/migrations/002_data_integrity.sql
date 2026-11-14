ALTER TABLE notifications
  ADD CONSTRAINT notifications_audience_allowed CHECK ("Audience" IN ('Technician', 'Supervisor')),
  ADD CONSTRAINT notifications_severity_allowed CHECK ("Severity" IN ('Warning', 'Critical')),
  ADD CONSTRAINT notifications_team_nonempty CHECK (btrim("TeamId") <> ''),
  ADD CONSTRAINT notifications_title_nonempty CHECK (btrim("Title") <> ''),
  ADD CONSTRAINT notifications_acknowledgement_pair
    CHECK (("AcknowledgedAtUtc" IS NULL) = ("AcknowledgedBy" IS NULL));

ALTER TABLE outbox_messages
  ADD CONSTRAINT outbox_attempts_nonnegative CHECK ("Attempts" >= 0),
  ADD CONSTRAINT outbox_body_is_object CHECK (jsonb_typeof("Body"::jsonb) = 'object');

CREATE INDEX notifications_team_recent ON notifications ("TeamId", "CreatedAtUtc" DESC);
CREATE INDEX notifications_technician_recent
  ON notifications ("TechnicianId", "Audience", "CreatedAtUtc" DESC)
  WHERE "TechnicianId" IS NOT NULL;
CREATE INDEX outbox_pending_dispatch
  ON outbox_messages ("NextAttemptAtUtc", "CreatedAtUtc")
  WHERE "PublishedAtUtc" IS NULL;
