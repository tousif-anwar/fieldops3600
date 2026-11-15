-- Maintenance agreements are owned by the customer registry. Equipment references are
-- validated against the assets owner over the service boundary; no cross-database FK exists.
CREATE TABLE maintenance_contracts (
    "Id" uuid PRIMARY KEY CHECK("Id"<>'00000000-0000-0000-0000-000000000000'),
    "TeamId" text NOT NULL CHECK("TeamId" ~ '^[A-Za-z0-9_-]{2,64}$'),
    "CustomerId" uuid NOT NULL REFERENCES customers("Id") ON DELETE RESTRICT,
    "Status" text NOT NULL CHECK("Status" IN ('Draft','Active','Suspended','Cancelled','Expired')),
    "EffectiveFromUtc" timestamptz NOT NULL,
    "ExpiresAtUtc" timestamptz,
    "TimeZoneId" text NOT NULL CHECK(length(btrim("TimeZoneId")) BETWEEN 1 AND 100),
    "CoversAllAssets" boolean NOT NULL,
    "Version" integer NOT NULL CHECK("Version">0),
    "CreatedAtUtc" timestamptz NOT NULL,
    "UpdatedAtUtc" timestamptz NOT NULL,
    CHECK("ExpiresAtUtc" IS NULL OR "ExpiresAtUtc">"EffectiveFromUtc"),
    CHECK("UpdatedAtUtc">="CreatedAtUtc")
);
CREATE INDEX "IX_maintenance_contracts_TeamId_CustomerId_Status" ON maintenance_contracts("TeamId","CustomerId","Status");
CREATE INDEX "IX_maintenance_contracts_Status_ExpiresAtUtc" ON maintenance_contracts("Status","ExpiresAtUtc");

CREATE TABLE contract_lines (
    "Id" uuid PRIMARY KEY CHECK("Id"<>'00000000-0000-0000-0000-000000000000'),
    "ContractId" uuid NOT NULL REFERENCES maintenance_contracts("Id") ON DELETE RESTRICT,
    "ServiceType" text NOT NULL CHECK(length(btrim("ServiceType")) BETWEEN 2 AND 80),
    "LaborCovered" boolean NOT NULL,
    "PartsCovered" boolean NOT NULL,
    "IncludedVisits" integer NOT NULL CHECK("IncludedVisits" BETWEEN 0 AND 10000),
    "PartsAllowance" numeric(18,2) NOT NULL CHECK("PartsAllowance">=0),
    "Active" boolean NOT NULL
);
CREATE UNIQUE INDEX "IX_contract_lines_ContractId_ServiceType" ON contract_lines("ContractId","ServiceType");

CREATE TABLE contract_covered_assets (
    "Id" uuid PRIMARY KEY CHECK("Id"<>'00000000-0000-0000-0000-000000000000'),
    "ContractId" uuid NOT NULL REFERENCES maintenance_contracts("Id") ON DELETE RESTRICT,
    "AssetId" uuid NOT NULL CHECK("AssetId"<>'00000000-0000-0000-0000-000000000000'),
    "EffectiveFrom" date NOT NULL,
    "EffectiveTo" date,
    "Active" boolean NOT NULL,
    CHECK("EffectiveTo" IS NULL OR "EffectiveTo">="EffectiveFrom")
);
CREATE UNIQUE INDEX "IX_contract_covered_assets_ContractId_AssetId" ON contract_covered_assets("ContractId","AssetId");
CREATE INDEX "IX_contract_covered_assets_AssetId" ON contract_covered_assets("AssetId");

CREATE TABLE contract_exclusions (
    "Id" uuid PRIMARY KEY CHECK("Id"<>'00000000-0000-0000-0000-000000000000'),
    "ContractId" uuid NOT NULL REFERENCES maintenance_contracts("Id") ON DELETE RESTRICT,
    "ServiceType" text CHECK("ServiceType" IS NULL OR length(btrim("ServiceType")) BETWEEN 2 AND 80),
    "AssetId" uuid,
    "Reason" text NOT NULL CHECK(length(btrim("Reason")) BETWEEN 3 AND 500),
    CHECK("ServiceType" IS NOT NULL OR "AssetId" IS NOT NULL)
);
CREATE INDEX "IX_contract_exclusions_ContractId_ServiceType" ON contract_exclusions("ContractId","ServiceType");

CREATE TABLE maintenance_plans (
    "Id" uuid PRIMARY KEY CHECK("Id"<>'00000000-0000-0000-0000-000000000000'),
    "ContractId" uuid NOT NULL REFERENCES maintenance_contracts("Id") ON DELETE RESTRICT,
    "ContractLineId" uuid NOT NULL REFERENCES contract_lines("Id") ON DELETE RESTRICT,
    "AssetId" uuid,
    "Frequency" text NOT NULL CHECK("Frequency" IN ('Monthly','Quarterly','Semiannual','Annual')),
    "IntervalMonths" integer NOT NULL CHECK("IntervalMonths" IN (1,3,6,12)),
    "NextDueDate" date NOT NULL,
    "EndsOn" date,
    "Active" boolean NOT NULL,
    "Version" integer NOT NULL CHECK("Version">0),
    CHECK("EndsOn" IS NULL OR "EndsOn">="NextDueDate"),
    CHECK(("Frequency"='Monthly' AND "IntervalMonths"=1) OR ("Frequency"='Quarterly' AND "IntervalMonths"=3) OR
          ("Frequency"='Semiannual' AND "IntervalMonths"=6) OR ("Frequency"='Annual' AND "IntervalMonths"=12))
);
CREATE INDEX "IX_maintenance_plans_ContractLineId_AssetId_Active" ON maintenance_plans("ContractLineId","AssetId","Active");
CREATE INDEX "IX_maintenance_plans_Active_NextDueDate" ON maintenance_plans("Active","NextDueDate");
-- NULL asset IDs are a valid single generic plan; COALESCE makes the uniqueness rule real.
CREATE UNIQUE INDEX "IX_maintenance_plans_active_line_asset" ON maintenance_plans(
    "ContractLineId", COALESCE("AssetId",'00000000-0000-0000-0000-000000000000'::uuid)
) WHERE "Active";

CREATE TABLE maintenance_visits (
    "Id" uuid PRIMARY KEY CHECK("Id"<>'00000000-0000-0000-0000-000000000000'),
    "ContractId" uuid NOT NULL REFERENCES maintenance_contracts("Id") ON DELETE RESTRICT,
    "ContractLineId" uuid NOT NULL REFERENCES contract_lines("Id") ON DELETE RESTRICT,
    "CustomerId" uuid NOT NULL REFERENCES customers("Id") ON DELETE RESTRICT,
    "AssetId" uuid,
    "WorkOrderId" uuid,
    "DueDate" date NOT NULL,
    "Status" text NOT NULL CHECK("Status" IN ('Pending','Scheduled','Completed','Missed','Cancelled')),
    "GeneratedAtUtc" timestamptz NOT NULL
);
CREATE UNIQUE INDEX "IX_maintenance_visits_contract_line_asset_due" ON maintenance_visits(
    "ContractId","ContractLineId",COALESCE("AssetId",'00000000-0000-0000-0000-000000000000'::uuid),"DueDate"
);
CREATE INDEX "IX_maintenance_visits_CustomerId_DueDate_Status" ON maintenance_visits("CustomerId","DueDate","Status");
CREATE INDEX "IX_maintenance_visits_WorkOrderId" ON maintenance_visits("WorkOrderId") WHERE "WorkOrderId" IS NOT NULL;

CREATE TABLE contract_usage (
    "Id" uuid PRIMARY KEY CHECK("Id"<>'00000000-0000-0000-0000-000000000000'),
    "ContractId" uuid NOT NULL REFERENCES maintenance_contracts("Id") ON DELETE RESTRICT,
    "ContractLineId" uuid NOT NULL REFERENCES contract_lines("Id") ON DELETE RESTRICT,
    "WorkOrderId" uuid NOT NULL CHECK("WorkOrderId"<>'00000000-0000-0000-0000-000000000000'),
    "VisitsUsed" integer NOT NULL CHECK("VisitsUsed" BETWEEN 0 AND 100),
    "PartsCost" numeric(18,2) NOT NULL CHECK("PartsCost">=0),
    "OccurredAtUtc" timestamptz NOT NULL
);
CREATE UNIQUE INDEX "IX_contract_usage_ContractLineId_WorkOrderId" ON contract_usage("ContractLineId","WorkOrderId");
CREATE INDEX "IX_contract_usage_ContractId_OccurredAtUtc" ON contract_usage("ContractId","OccurredAtUtc");

CREATE TABLE contract_events (
    "Id" uuid PRIMARY KEY,
    "ContractId" uuid NOT NULL REFERENCES maintenance_contracts("Id") ON DELETE RESTRICT,
    "Version" integer NOT NULL CHECK("Version">0),
    "Action" text NOT NULL CHECK(length(btrim("Action")) BETWEEN 3 AND 120),
    "ActorId" text NOT NULL,
    "ActorRole" text NOT NULL,
    "CorrelationId" text NOT NULL,
    "OccurredAtUtc" timestamptz NOT NULL,
    "DetailsJson" jsonb NOT NULL CHECK(jsonb_typeof("DetailsJson")='object')
);
CREATE INDEX "IX_contract_events_ContractId_Version" ON contract_events("ContractId","Version");

CREATE FUNCTION contract_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Contract history is append-only'; END $$;
CREATE TRIGGER contract_events_no_mutation BEFORE UPDATE OR DELETE ON contract_events FOR EACH ROW EXECUTE FUNCTION contract_history_immutable();
CREATE TRIGGER contract_events_no_truncate BEFORE TRUNCATE ON contract_events FOR EACH STATEMENT EXECUTE FUNCTION contract_history_immutable();
CREATE TRIGGER contract_usage_no_mutation BEFORE UPDATE OR DELETE ON contract_usage FOR EACH ROW EXECUTE FUNCTION contract_history_immutable();
CREATE TRIGGER contract_usage_no_truncate BEFORE TRUNCATE ON contract_usage FOR EACH STATEMENT EXECUTE FUNCTION contract_history_immutable();
