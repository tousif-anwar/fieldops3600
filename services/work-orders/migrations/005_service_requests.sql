CREATE TABLE service_requests (
  "Id" uuid PRIMARY KEY,
  "CustomerId" uuid NOT NULL,
  "ServiceLocationId" uuid NOT NULL,
  "AssetId" uuid,
  "TeamId" text NOT NULL CHECK (btrim("TeamId") <> ''),
  "SubmittedBy" text NOT NULL CHECK (btrim("SubmittedBy") <> ''),
  "CustomerName" text NOT NULL,
  "SiteAddress" text NOT NULL,
  "Title" text NOT NULL CHECK (length(btrim("Title")) BETWEEN 3 AND 160),
  "Description" text NOT NULL CHECK (length(btrim("Description")) BETWEEN 10 AND 4000),
  "ServiceType" text NOT NULL CHECK ("ServiceType" IN ('Repair','Maintenance','Installation','Replacement','Warranty','Diagnostic')),
  "Urgency" text NOT NULL CHECK ("Urgency" IN ('Routine','Urgent','Emergency')),
  "Status" text NOT NULL DEFAULT 'Submitted' CHECK ("Status" IN ('Submitted','Qualified','Rejected')),
  "WorkOrderId" uuid REFERENCES work_orders("Id") ON DELETE RESTRICT,
  "DecisionReason" text,
  "Version" integer NOT NULL DEFAULT 1 CHECK ("Version" > 0),
  "CreatedAtUtc" timestamptz NOT NULL,
  "UpdatedAtUtc" timestamptz NOT NULL CHECK ("UpdatedAtUtc" >= "CreatedAtUtc"),
  CONSTRAINT service_request_decision CHECK (
    ("Status" = 'Submitted' AND "WorkOrderId" IS NULL AND "DecisionReason" IS NULL)
    OR ("Status" = 'Qualified' AND "WorkOrderId" IS NOT NULL AND length(btrim("DecisionReason")) BETWEEN 8 AND 500)
    OR ("Status" = 'Rejected' AND "WorkOrderId" IS NULL AND length(btrim("DecisionReason")) BETWEEN 8 AND 500))
);
CREATE UNIQUE INDEX service_requests_work_order ON service_requests("WorkOrderId") WHERE "WorkOrderId" IS NOT NULL;
CREATE INDEX service_requests_team_queue ON service_requests("TeamId","Status","CreatedAtUtc");
CREATE INDEX service_requests_customer_recent ON service_requests("CustomerId","CreatedAtUtc" DESC);
