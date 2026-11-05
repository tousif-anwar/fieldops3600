-- Stage snapshots remain JSONB because a workflow aggregate is versioned as one unit.
-- These checks make the envelope safe without pretending the nested stages are relational rows.
ALTER TABLE workflows
  ADD CONSTRAINT workflows_status_allowed CHECK ("Status" IN ('Active', 'Completed')),
  ADD CONSTRAINT workflows_team_nonempty CHECK (btrim("TeamId") <> ''),
  ADD CONSTRAINT workflows_technician_nonempty CHECK (btrim("TechnicianId") <> ''),
  ADD CONSTRAINT workflows_version_positive CHECK ("Version" > 0),
  ADD CONSTRAINT workflows_template_version_positive CHECK ("TemplateVersion" > 0),
  ADD CONSTRAINT workflows_stage_index_range CHECK ("CurrentStageIndex" BETWEEN 0 AND 7),
  ADD CONSTRAINT workflows_stages_array CHECK (jsonb_typeof("StagesJson") = 'array'),
  ADD CONSTRAINT workflows_stage_count CHECK (jsonb_array_length("StagesJson") = 8),
  ADD CONSTRAINT workflows_completion_consistent
    CHECK (("Status" = 'Completed') = ("CompletedAtUtc" IS NOT NULL)),
  ADD CONSTRAINT workflows_completion_after_start
    CHECK ("CompletedAtUtc" IS NULL OR "CompletedAtUtc" >= "StartedAtUtc");

ALTER TABLE outbox_messages
  ADD CONSTRAINT outbox_attempts_nonnegative CHECK ("Attempts" >= 0),
  ADD CONSTRAINT outbox_body_is_object CHECK (jsonb_typeof("Body"::jsonb) = 'object');

CREATE INDEX workflows_team_started ON workflows ("TeamId", "StartedAtUtc" DESC);
CREATE INDEX workflows_technician_started
  ON workflows ("TechnicianId", "StartedAtUtc" DESC);
CREATE INDEX outbox_pending_dispatch
  ON outbox_messages ("NextAttemptAtUtc", "CreatedAtUtc")
  WHERE "PublishedAtUtc" IS NULL;
