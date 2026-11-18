-- Legacy agreements have no implied response/completion promise.
ALTER TABLE maintenance_contracts ADD COLUMN "SlaClockOrigin" text
    CHECK("SlaClockOrigin" IS NULL OR "SlaClockOrigin" IN ('WorkOrderCreated','AppointmentStart'));
ALTER TABLE contract_lines ADD COLUMN "ResponseTargetMinutes" integer CHECK("ResponseTargetMinutes" IS NULL OR "ResponseTargetMinutes">0);
ALTER TABLE contract_lines ADD COLUMN "CompletionTargetMinutes" integer CHECK("CompletionTargetMinutes" IS NULL OR "CompletionTargetMinutes">0);
ALTER TABLE contract_lines ADD CONSTRAINT "CK_contract_sla_target_order" CHECK(
    "ResponseTargetMinutes" IS NULL OR "CompletionTargetMinutes" IS NULL OR "CompletionTargetMinutes">="ResponseTargetMinutes");

-- Cross-row validation mirrors the domain rule and is deferred so one transaction
-- can replace or clear the agreement origin and all affected line targets.
CREATE FUNCTION validate_contract_sla_origin() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
    IF TG_TABLE_NAME='maintenance_contracts' THEN target := NEW."Id";
    ELSE target := NEW."ContractId";
    END IF;
    IF EXISTS(SELECT 1 FROM contract_lines l JOIN maintenance_contracts c ON c."Id"=l."ContractId"
        WHERE c."Id"=target AND c."SlaClockOrigin" IS NULL
          AND (l."ResponseTargetMinutes" IS NOT NULL OR l."CompletionTargetMinutes" IS NOT NULL)) THEN
        RAISE EXCEPTION 'Contract SLA targets require an explicit clock origin' USING ERRCODE='23514';
    END IF;
    RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER contract_sla_origin_check AFTER INSERT OR UPDATE ON maintenance_contracts
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_contract_sla_origin();
CREATE CONSTRAINT TRIGGER contract_line_sla_origin_check AFTER INSERT OR UPDATE ON contract_lines
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_contract_sla_origin();
