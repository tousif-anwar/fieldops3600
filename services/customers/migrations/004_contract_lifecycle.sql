CREATE TABLE contract_renewals (
    "Id" uuid PRIMARY KEY CHECK("Id"<>'00000000-0000-0000-0000-000000000000'),
    "SourceContractId" uuid NOT NULL REFERENCES maintenance_contracts("Id") ON DELETE RESTRICT,
    "RenewedContractId" uuid NOT NULL REFERENCES maintenance_contracts("Id") ON DELETE RESTRICT,
    "TeamId" text NOT NULL CHECK("TeamId" ~ '^[A-Za-z0-9_-]{2,64}$'),
    "OperationId" uuid NOT NULL CHECK("OperationId"<>'00000000-0000-0000-0000-000000000000'),
    "SourceVersion" integer NOT NULL CHECK("SourceVersion">0),
    "EffectiveFromUtc" timestamptz NOT NULL,
    "ExpiresAtUtc" timestamptz NOT NULL,
    "Reason" text NOT NULL CHECK(length(btrim("Reason")) BETWEEN 3 AND 500),
    "ActorId" text NOT NULL CHECK(length(btrim("ActorId"))>0),
    "ActorRole" text NOT NULL CHECK(length(btrim("ActorRole"))>0),
    "RecordedAtUtc" timestamptz NOT NULL,
    CHECK("SourceContractId"<>"RenewedContractId"),
    CHECK("ExpiresAtUtc">"EffectiveFromUtc")
);
CREATE UNIQUE INDEX "IX_contract_renewals_SourceContractId" ON contract_renewals("SourceContractId");
CREATE UNIQUE INDEX "IX_contract_renewals_RenewedContractId" ON contract_renewals("RenewedContractId");
CREATE UNIQUE INDEX "IX_contract_renewals_ActorId_OperationId" ON contract_renewals("ActorId","OperationId");
CREATE TRIGGER contract_renewals_no_mutation BEFORE UPDATE OR DELETE ON contract_renewals
    FOR EACH ROW EXECUTE FUNCTION contract_history_immutable();
CREATE TRIGGER contract_renewals_no_truncate BEFORE TRUNCATE ON contract_renewals
    FOR EACH STATEMENT EXECUTE FUNCTION contract_history_immutable();

-- The recurrence cursor advances past the final due day before a bounded plan
-- becomes inactive; an inactive cursor must be persistable without losing history.
ALTER TABLE maintenance_plans DROP CONSTRAINT maintenance_plans_check;
ALTER TABLE maintenance_plans ADD CONSTRAINT "CK_maintenance_plan_active_window"
    CHECK("EndsOn" IS NULL OR NOT "Active" OR "EndsOn">="NextDueDate");

ALTER TABLE maintenance_plans ADD COLUMN "AnchorDay" integer;
UPDATE maintenance_plans SET "AnchorDay"=EXTRACT(day FROM "NextDueDate")::integer;
ALTER TABLE maintenance_plans ADD CONSTRAINT "CK_maintenance_plan_anchor_day" CHECK("AnchorDay" IS NULL OR "AnchorDay" BETWEEN 1 AND 31);
