-- A cancellation fence prevents allocation while the work-order owner commits
-- cancellation. Recovery retries finish cancellation instead of dropping this fence.
CREATE TABLE work_order_cancellations (
    work_order_id uuid NOT NULL PRIMARY KEY,
    requested_at_utc timestamptz NOT NULL
);
