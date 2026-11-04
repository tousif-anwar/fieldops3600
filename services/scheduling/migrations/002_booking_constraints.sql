-- PostgreSQL is the final authority for concurrent allocation conflicts.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE bookings ADD CONSTRAINT no_overlapping_bookings
  EXCLUDE USING gist ("TechnicianId" WITH =, tstzrange("StartUtc", "EndUtc", '[)') WITH &&)
  WHERE ("Status" = 'Confirmed');
CREATE UNIQUE INDEX one_confirmed_booking_per_order ON bookings("WorkOrderId") WHERE "Status"='Confirmed';
ALTER TABLE bookings ADD CONSTRAINT positive_booking_duration CHECK ("EndUtc">"StartUtc");
