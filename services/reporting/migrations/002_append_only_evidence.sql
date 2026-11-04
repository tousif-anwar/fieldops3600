-- App identities cannot rewrite evidence through ordinary UPDATE/DELETE operations.
-- Database owners can still disable triggers: protect their credentials outside the app.
CREATE FUNCTION reject_evidence_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit evidence is append-only'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER audit_events_immutable BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();
CREATE TRIGGER delivery_attempts_immutable BEFORE UPDATE OR DELETE ON delivery_attempts
  FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();
