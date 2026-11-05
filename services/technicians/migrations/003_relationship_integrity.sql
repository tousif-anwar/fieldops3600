-- Time-off records and technician profiles share one owning database. Enforce
-- their identity relationship here, never with a cross-service foreign key.
ALTER TABLE technicians
  ADD CONSTRAINT technicians_supervisor_nonempty CHECK (btrim("SupervisorId") <> '');

ALTER TABLE time_off
  ADD COLUMN "Version" integer NOT NULL DEFAULT 1;

ALTER TABLE time_off
  ADD CONSTRAINT time_off_version_positive CHECK ("Version" > 0),
  ADD CONSTRAINT time_off_technician_nonempty CHECK (btrim("TechnicianId") <> ''),
  ADD CONSTRAINT time_off_technician_fkey
    FOREIGN KEY ("TechnicianId") REFERENCES technicians("Id") ON DELETE RESTRICT;

-- The existing (TechnicianId, StartUtc, EndUtc) index also supports the FK's
-- referenced-side lookup for retention/deletion checks.