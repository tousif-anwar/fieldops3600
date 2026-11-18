-- Nullable agreement terms are copied once into immutable job-owned obligations.
CREATE TABLE work_order_sla_snapshots (
    "WorkOrderId" uuid PRIMARY KEY REFERENCES work_orders("Id") ON DELETE RESTRICT,
    "TeamId" text NOT NULL CHECK(length(btrim("TeamId"))>0),
    "ContractId" uuid NOT NULL CHECK("ContractId"<>'00000000-0000-0000-0000-000000000000'),
    "ContractLineId" uuid NOT NULL CHECK("ContractLineId"<>'00000000-0000-0000-0000-000000000000'),
    "ContractVersion" integer NOT NULL CHECK("ContractVersion">0),
    "ClockOrigin" text NOT NULL CHECK("ClockOrigin" IN ('WorkOrderCreated','AppointmentStart')),
    "ResponseTargetMinutes" integer CHECK("ResponseTargetMinutes" IS NULL OR "ResponseTargetMinutes">0),
    "CompletionTargetMinutes" integer CHECK("CompletionTargetMinutes" IS NULL OR "CompletionTargetMinutes">0),
    "TimeZoneId" text NOT NULL CHECK(length(btrim("TimeZoneId")) BETWEEN 1 AND 100),
    "WorkOrderCreatedAtUtc" timestamptz NOT NULL,
    "AttachedAtUtc" timestamptz NOT NULL,
    "TermsHash" text NOT NULL CHECK(length("TermsHash")=64),
    CHECK("ResponseTargetMinutes" IS NOT NULL OR "CompletionTargetMinutes" IS NOT NULL),
    CHECK("ResponseTargetMinutes" IS NULL OR "CompletionTargetMinutes" IS NULL OR "CompletionTargetMinutes">="ResponseTargetMinutes"),
    CHECK("AttachedAtUtc">="WorkOrderCreatedAtUtc")
);

CREATE TABLE work_order_sla_states (
    "WorkOrderId" uuid PRIMARY KEY REFERENCES work_order_sla_snapshots("WorkOrderId") ON DELETE RESTRICT,
    "Version" integer NOT NULL CHECK("Version">0),
    "ClockRevision" integer NOT NULL CHECK("ClockRevision">0),
    "BookingRevision" bigint NOT NULL CHECK("BookingRevision">=0),
    "BookingId" uuid,
    "AppointmentStartUtc" timestamptz,
    "OriginAtUtc" timestamptz,
    "ResponseDueAtUtc" timestamptz,
    "CompletionDueAtUtc" timestamptz,
    "ResponseAtUtc" timestamptz,
    "CompletedAtUtc" timestamptz,
    "ResponseSourceEventId" uuid,
    "CompletionSourceEventId" uuid,
    "ResponseStatus" text NOT NULL CHECK("ResponseStatus" IN ('Unconfigured','WaitingForAppointment','Pending','OverdueObserved','Met','Late','Cancelled','Review')),
    "CompletionStatus" text NOT NULL CHECK("CompletionStatus" IN ('Unconfigured','WaitingForAppointment','Pending','OverdueObserved','Met','Late','Cancelled','Review')),
    "ResponseOverdueEvidenceId" uuid,
    "CompletionOverdueEvidenceId" uuid,
    "ResponseEverOverdue" boolean NOT NULL,
    "CompletionEverOverdue" boolean NOT NULL,
    "CancelledAtUtc" timestamptz,
    "RequiresReview" boolean NOT NULL,
    "ReviewReason" text,
    "UpdatedAtUtc" timestamptz NOT NULL,
    CHECK(("RequiresReview" AND length(btrim("ReviewReason")) BETWEEN 3 AND 500) OR (NOT "RequiresReview" AND "ReviewReason" IS NULL)),
    CHECK(("ResponseAtUtc" IS NULL)=("ResponseSourceEventId" IS NULL)),
    CHECK(("CompletedAtUtc" IS NULL)=("CompletionSourceEventId" IS NULL)),
    CHECK("ResponseDueAtUtc" IS NULL OR "OriginAtUtc" IS NOT NULL),
    CHECK("CompletionDueAtUtc" IS NULL OR "OriginAtUtc" IS NOT NULL)
);
CREATE INDEX "IX_work_order_sla_states_ResponseDueAtUtc" ON work_order_sla_states("ResponseDueAtUtc");
CREATE INDEX "IX_work_order_sla_states_CompletionDueAtUtc" ON work_order_sla_states("CompletionDueAtUtc");

CREATE TABLE work_order_sla_evidence (
    "Id" uuid PRIMARY KEY,
    "WorkOrderId" uuid NOT NULL REFERENCES work_order_sla_snapshots("WorkOrderId") ON DELETE RESTRICT,
    "ClockRevision" integer NOT NULL CHECK("ClockRevision">0),
    "SemanticKey" text NOT NULL CHECK(length("SemanticKey") BETWEEN 1 AND 200),
    "Action" text NOT NULL CHECK(length("Action") BETWEEN 3 AND 120),
    "TargetKind" text NOT NULL CHECK("TargetKind" IN ('Snapshot','Clock','Response','Completion','Review')),
    "SourceEventId" uuid,
    "RelatedEvidenceId" uuid REFERENCES work_order_sla_evidence("Id") ON DELETE RESTRICT,
    "EffectiveAtUtc" timestamptz NOT NULL,
    "RecordedAtUtc" timestamptz NOT NULL,
    "ActorId" text NOT NULL,
    "ActorRole" text NOT NULL,
    "DetailsJson" jsonb NOT NULL CHECK(jsonb_typeof("DetailsJson")='object')
);
CREATE UNIQUE INDEX "IX_work_order_sla_evidence_WorkOrderId_SemanticKey" ON work_order_sla_evidence("WorkOrderId","SemanticKey");
CREATE INDEX "IX_work_order_sla_evidence_WorkOrderId_RecordedAtUtc" ON work_order_sla_evidence("WorkOrderId","RecordedAtUtc");
CREATE FUNCTION work_order_sla_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Contract SLA snapshots and evidence are append-only'; END $$;
CREATE TRIGGER work_order_sla_snapshots_no_mutation BEFORE UPDATE OR DELETE ON work_order_sla_snapshots FOR EACH ROW EXECUTE FUNCTION work_order_sla_immutable();
CREATE TRIGGER work_order_sla_snapshots_no_truncate BEFORE TRUNCATE ON work_order_sla_snapshots FOR EACH STATEMENT EXECUTE FUNCTION work_order_sla_immutable();
CREATE TRIGGER work_order_sla_evidence_no_mutation BEFORE UPDATE OR DELETE ON work_order_sla_evidence FOR EACH ROW EXECUTE FUNCTION work_order_sla_immutable();
CREATE TRIGGER work_order_sla_evidence_no_truncate BEFORE TRUNCATE ON work_order_sla_evidence FOR EACH STATEMENT EXECUTE FUNCTION work_order_sla_immutable();
