-- FieldOps 360 initial schema. Generated from the EF Core ownership model.
-- Apply with the service migration identity; application roles should have only DML.
CREATE TABLE bookings (
    "Id" uuid NOT NULL,
    "WorkOrderId" uuid NOT NULL,
    "TechnicianId" text NOT NULL,
    "TeamId" text NOT NULL,
    "StartUtc" timestamp with time zone NOT NULL,
    "EndUtc" timestamp with time zone NOT NULL,
    "Status" text NOT NULL,
    "Version" integer NOT NULL,
    "OverrideReason" text,
    CONSTRAINT "PK_bookings" PRIMARY KEY ("Id")
);


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


CREATE INDEX "IX_bookings_WorkOrderId_Status" ON bookings ("WorkOrderId", "Status");


CREATE INDEX "IX_outbox_messages_PublishedAtUtc_NextAttemptAtUtc" ON outbox_messages ("PublishedAtUtc", "NextAttemptAtUtc");


