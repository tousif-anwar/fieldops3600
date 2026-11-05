-- Evidence remains append-only; these checks constrain new observations without rewriting history.
ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_sequence_nonnegative CHECK ("SequenceNumber" >= 0),
  ADD CONSTRAINT audit_events_hash_sha256 CHECK ("IntegrityHash" ~ '^[0-9A-F]{64}$');

ALTER TABLE delivery_attempts
  ADD CONSTRAINT delivery_attempts_status_allowed
    CHECK ("Status" IN ('Processed', 'Duplicate', 'Failed', 'DeadLettered')),
  ADD CONSTRAINT delivery_attempts_consumer_nonempty CHECK (btrim("ConsumerService") <> ''),
  ADD CONSTRAINT delivery_attempts_attempt_positive CHECK ("Attempt" IS NULL OR "Attempt" > 0);

ALTER TABLE replay_projection
  ADD CONSTRAINT replay_projection_event_count_nonnegative CHECK ("EventCount" >= 0);

CREATE INDEX delivery_attempts_event_processed
  ON delivery_attempts ("EventId", "ProcessedAtUtc");
CREATE INDEX audit_events_work_order_sequence
  ON audit_events ("WorkOrderId", "SequenceNumber");
