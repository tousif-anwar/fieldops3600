-- 002 already owns overlap and one-confirmed-booking-per-order uniqueness.
-- This migration closes the remaining state and scope gaps.
ALTER TABLE bookings
  ADD CONSTRAINT bookings_status_allowed CHECK ("Status" IN ('Confirmed', 'Cancelled')),
  ADD CONSTRAINT bookings_technician_nonempty CHECK (btrim("TechnicianId") <> ''),
  ADD CONSTRAINT bookings_team_nonempty CHECK (btrim("TeamId") <> ''),
  ADD CONSTRAINT bookings_version_positive CHECK ("Version" > 0);

ALTER TABLE outbox_messages
  ADD CONSTRAINT outbox_attempts_nonnegative CHECK ("Attempts" >= 0),
  ADD CONSTRAINT outbox_body_is_object CHECK (jsonb_typeof("Body"::jsonb) = 'object');

CREATE INDEX bookings_team_start ON bookings ("TeamId", "StartUtc");
CREATE INDEX outbox_pending_dispatch
  ON outbox_messages ("NextAttemptAtUtc", "CreatedAtUtc")
  WHERE "PublishedAtUtc" IS NULL;
