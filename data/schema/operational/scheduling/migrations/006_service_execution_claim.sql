-- A scheduling-owned claim serializes workflow start with appointment mutation.
-- A failed workflow write can retry the same claim; it must not release capacity silently.
ALTER TABLE bookings ADD COLUMN "ServiceStartedAtUtc" timestamptz;
ALTER TABLE bookings ADD CONSTRAINT started_booking_remains_confirmed
  CHECK ("ServiceStartedAtUtc" IS NULL OR "Status" = 'Confirmed');
