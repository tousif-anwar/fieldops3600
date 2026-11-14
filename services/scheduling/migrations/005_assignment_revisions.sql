-- One durable scheduling sequence per work order. Booking-local versions cannot
-- order a cancelled booking against a later replacement booking.
CREATE TABLE assignment_revisions (
    work_order_id uuid NOT NULL PRIMARY KEY,
    revision bigint NOT NULL CHECK (revision > 0)
);
INSERT INTO assignment_revisions(work_order_id, revision)
SELECT "WorkOrderId", max("Version")::bigint FROM bookings GROUP BY "WorkOrderId";
