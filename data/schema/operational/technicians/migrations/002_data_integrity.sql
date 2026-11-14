-- Working-hours and serialized-values invariants for every writer, not only the API.
ALTER TABLE technicians
  ADD CONSTRAINT technicians_team_nonempty CHECK (btrim("TeamId") <> ''),
  ADD CONSTRAINT technicians_name_nonempty CHECK (btrim("Name") <> ''),
  ADD CONSTRAINT technicians_timezone_nonempty CHECK (btrim("TimeZone") <> ''),
  ADD CONSTRAINT technicians_working_hours_ordered
    CHECK ("WorkingStartHour" BETWEEN 0 AND 23 AND "WorkingEndHour" BETWEEN 1 AND 24 AND "WorkingStartHour" < "WorkingEndHour"),
  ADD CONSTRAINT technicians_skills_json_array CHECK ("SkillsJson" IS JSON ARRAY),
  ADD CONSTRAINT technicians_certifications_json_array CHECK ("CertificationsJson" IS JSON ARRAY),
  ADD CONSTRAINT technicians_version_positive CHECK ("Version" > 0);

ALTER TABLE time_off
  ADD CONSTRAINT time_off_positive_interval CHECK ("EndUtc" > "StartUtc"),
  ADD CONSTRAINT time_off_reason_nonempty CHECK (btrim("Reason") <> '');

ALTER TABLE outbox_messages
  ADD CONSTRAINT outbox_attempts_nonnegative CHECK ("Attempts" >= 0),
  ADD CONSTRAINT outbox_body_is_object CHECK (jsonb_typeof("Body"::jsonb) = 'object');

CREATE INDEX technicians_team_name ON technicians ("TeamId", "Name");
CREATE INDEX outbox_pending_dispatch
  ON outbox_messages ("NextAttemptAtUtc", "CreatedAtUtc")
  WHERE "PublishedAtUtc" IS NULL;
