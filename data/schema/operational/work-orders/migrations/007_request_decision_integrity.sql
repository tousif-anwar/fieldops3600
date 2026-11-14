-- PostgreSQL CHECK accepts UNKNOWN; require a non-null retained reason explicitly.
ALTER TABLE service_requests DROP CONSTRAINT service_request_decision;
ALTER TABLE service_requests ADD CONSTRAINT service_request_decision CHECK (
  ("Status" = 'Submitted' AND "WorkOrderId" IS NULL AND "DecisionReason" IS NULL)
  OR ("Status" = 'Qualified' AND "WorkOrderId" IS NOT NULL AND "DecisionReason" IS NOT NULL AND length(btrim("DecisionReason")) BETWEEN 8 AND 500)
  OR ("Status" = 'Rejected' AND "WorkOrderId" IS NULL AND "DecisionReason" IS NOT NULL AND length(btrim("DecisionReason")) BETWEEN 8 AND 500));
