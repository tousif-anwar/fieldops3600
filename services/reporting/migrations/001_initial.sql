-- FieldOps 360 initial schema. Generated from the EF Core ownership model.
-- Apply with the service migration identity; application roles should have only DML.
CREATE TABLE audit_events (
    "EventId" uuid NOT NULL,
    "WorkOrderId" uuid NOT NULL,
    "EventType" text NOT NULL,
    "SourceService" text NOT NULL,
    "TeamId" text NOT NULL,
    "ActorId" text NOT NULL,
    "Body" text NOT NULL,
    "OccurredAtUtc" timestamp with time zone NOT NULL,
    "ReceivedAtUtc" timestamp with time zone NOT NULL,
    "ProcessedAtUtc" timestamp with time zone NOT NULL,
    "SequenceNumber" bigint NOT NULL,
    "CorrelationId" text NOT NULL,
    "TraceId" text,
    "IntegrityHash" text NOT NULL,
    CONSTRAINT "PK_audit_events" PRIMARY KEY ("EventId")
);


CREATE TABLE delivery_attempts (
    "Id" uuid NOT NULL,
    "EventId" uuid NOT NULL,
    "Attempt" integer NOT NULL,
    "ReceivedAtUtc" timestamp with time zone NOT NULL,
    "ProcessedAtUtc" timestamp with time zone NOT NULL,
    "Status" text NOT NULL,
    "Error" text,
    CONSTRAINT "PK_delivery_attempts" PRIMARY KEY ("Id")
);


CREATE TABLE fact_work_order (
    "WorkOrderId" uuid NOT NULL,
    "Number" text NOT NULL,
    "TeamId" text NOT NULL,
    "ServiceCategory" text NOT NULL,
    "Priority" text NOT NULL,
    "TechnicianId" text,
    "CreatedAtUtc" timestamp with time zone NOT NULL,
    "CompletedAtUtc" timestamp with time zone,
    "Status" text NOT NULL,
    "UpdatedAtUtc" timestamp with time zone NOT NULL,
    CONSTRAINT "PK_fact_work_order" PRIMARY KEY ("WorkOrderId")
);


CREATE TABLE fact_workflow_stage (
    "StageInstanceId" uuid NOT NULL,
    "WorkOrderId" uuid NOT NULL,
    "TeamId" text NOT NULL,
    "Stage" text NOT NULL,
    "TechnicianId" text NOT NULL,
    "StartedAtUtc" timestamp with time zone,
    "CompletedAtUtc" timestamp with time zone,
    "DeadlineUtc" timestamp with time zone,
    "Breached" boolean NOT NULL,
    "PausedSeconds" double precision NOT NULL,
    "SlaStatus" text NOT NULL,
    "UpdatedAtUtc" timestamp with time zone NOT NULL,
    CONSTRAINT "PK_fact_workflow_stage" PRIMARY KEY ("StageInstanceId")
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


CREATE TABLE replay_projection (
    "WorkOrderId" uuid NOT NULL,
    "TeamId" text NOT NULL,
    "StateJson" jsonb NOT NULL,
    "EventCount" integer NOT NULL,
    "UpdatedAtUtc" timestamp with time zone NOT NULL,
    CONSTRAINT "PK_replay_projection" PRIMARY KEY ("WorkOrderId")
);


CREATE INDEX "IX_audit_events_WorkOrderId_OccurredAtUtc" ON audit_events ("WorkOrderId", "OccurredAtUtc");


CREATE INDEX "IX_delivery_attempts_EventId" ON delivery_attempts ("EventId");


CREATE INDEX "IX_outbox_messages_PublishedAtUtc_NextAttemptAtUtc" ON outbox_messages ("PublishedAtUtc", "NextAttemptAtUtc");
