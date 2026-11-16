-- Operational service facts are projected onto the existing customer-owned visit.
ALTER TABLE maintenance_visits ADD COLUMN "AssignmentRevision" bigint NOT NULL DEFAULT 0 CHECK("AssignmentRevision">=0);
ALTER TABLE maintenance_visits ADD COLUMN "CompletedAtUtc" timestamptz;
ALTER TABLE maintenance_visits ADD COLUMN "CompletionEventId" uuid;
ALTER TABLE maintenance_visits ADD COLUMN "CompletionReviewRequired" boolean NOT NULL DEFAULT false;
ALTER TABLE maintenance_visits ADD COLUMN "CompletionReviewReason" text;
ALTER TABLE maintenance_visits ADD CONSTRAINT "CK_maintenance_completion_evidence" CHECK (
  ("CompletedAtUtc" IS NULL AND "CompletionEventId" IS NULL AND NOT "CompletionReviewRequired" AND "CompletionReviewReason" IS NULL)
  OR ("CompletedAtUtc" IS NOT NULL AND "CompletionEventId" IS NOT NULL AND "Status"='Completed'
      AND ((NOT "CompletionReviewRequired" AND "CompletionReviewReason" IS NULL)
        OR ("CompletionReviewRequired" AND length(btrim("CompletionReviewReason")) BETWEEN 3 AND 500))));
CREATE UNIQUE INDEX "IX_maintenance_visits_CompletionEventId" ON maintenance_visits("CompletionEventId") WHERE "CompletionEventId" IS NOT NULL;
