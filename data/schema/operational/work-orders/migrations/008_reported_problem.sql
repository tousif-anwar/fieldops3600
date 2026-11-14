-- Preserve customer intake details in the work packet without publishing free text to events.
ALTER TABLE work_orders ADD COLUMN "ReportedProblem" text NOT NULL DEFAULT '' CHECK (length("ReportedProblem") <= 4000);
UPDATE work_orders o SET "ReportedProblem" = r."Description"
  FROM service_requests r WHERE r."WorkOrderId" = o."Id";
UPDATE work_orders SET "ReportedProblem" = "Title" WHERE "ReportedProblem" = '';
