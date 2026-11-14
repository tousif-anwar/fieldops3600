ALTER TABLE work_orders ADD COLUMN "AssignmentRevision" bigint NOT NULL DEFAULT 0 CHECK ("AssignmentRevision" >= 0);
