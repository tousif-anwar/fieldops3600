-- FieldOps 360 initial schema. Generated from the EF Core ownership model.
-- Apply with the service migration identity; application roles should have only DML.
CREATE TABLE idempotency_receipts (
    "Id" text NOT NULL,
    "ActorId" text NOT NULL,
    "RequestHash" text NOT NULL,
    "ResponseJson" text NOT NULL,
    "CreatedAtUtc" timestamp with time zone NOT NULL,
    CONSTRAINT "PK_idempotency_receipts" PRIMARY KEY ("Id")
);


CREATE TABLE inbox_messages (
    "Id" text NOT NULL,
    "ProcessedAtUtc" timestamp with time zone NOT NULL,
    CONSTRAINT "PK_inbox_messages" PRIMARY KEY ("Id")
);


CREATE TABLE outbox_messages (
    "Id" uuid NOT NULL,
    "Body" jsonb NOT NULL,
    "CreatedAtUtc" timestamp with time zone NOT NULL,
    "PublishedAtUtc" timestamp with time zone,
    "Attempts" integer NOT NULL,
    "NextAttemptAtUtc" timestamp with time zone NOT NULL,
    "LastError" text,
    CONSTRAINT "PK_outbox_messages" PRIMARY KEY ("Id")
);


CREATE TABLE work_orders (
    "Id" uuid NOT NULL,
    "Number" text NOT NULL,
    "Title" text NOT NULL,
    "CustomerName" text NOT NULL,
    "SiteAddress" text NOT NULL,
    "ServiceCategory" text NOT NULL,
    "Priority" text NOT NULL,
    "Status" text NOT NULL,
    "TeamId" text NOT NULL,
    "TechnicianId" text,
    "CreatedAtUtc" timestamp with time zone NOT NULL,
    "CompletedAtUtc" timestamp with time zone,
    "Version" integer NOT NULL,
    CONSTRAINT "PK_work_orders" PRIMARY KEY ("Id")
);


CREATE INDEX "IX_outbox_messages_PublishedAtUtc_NextAttemptAtUtc" ON outbox_messages ("PublishedAtUtc", "NextAttemptAtUtc");


CREATE UNIQUE INDEX "IX_work_orders_Number" ON work_orders ("Number");


