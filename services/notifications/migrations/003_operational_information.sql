ALTER TABLE notifications DROP CONSTRAINT notifications_severity_allowed;
ALTER TABLE notifications ADD CONSTRAINT notifications_severity_allowed
  CHECK ("Severity" IN ('Information','Warning','Critical'));
