-- Asset-owned operational registry. Customer and service-location references are
-- validated logical references; all physical foreign keys stay inside this database.
CREATE TABLE idempotency_receipts (
    "Id" text PRIMARY KEY, "ActorId" text NOT NULL, "RequestHash" text NOT NULL,
    "ResponseJson" text NOT NULL, "CreatedAtUtc" timestamptz NOT NULL
);
CREATE TABLE inbox_messages ("Id" text PRIMARY KEY, "ProcessedAtUtc" timestamptz NOT NULL);
CREATE TABLE outbox_messages (
    "Id" uuid PRIMARY KEY, "Body" jsonb NOT NULL CHECK(jsonb_typeof("Body")='object'),
    "CreatedAtUtc" timestamptz NOT NULL, "PublishedAtUtc" timestamptz,
    "Attempts" integer NOT NULL CHECK("Attempts">=0), "NextAttemptAtUtc" timestamptz NOT NULL, "LastError" text
);
CREATE INDEX "IX_outbox_messages_PublishedAtUtc_NextAttemptAtUtc" ON outbox_messages("PublishedAtUtc","NextAttemptAtUtc");

CREATE TABLE assets (
    "Id" uuid PRIMARY KEY CHECK("Id"<>'00000000-0000-0000-0000-000000000000'),
    "CustomerId" uuid NOT NULL CHECK("CustomerId"<>'00000000-0000-0000-0000-000000000000'),
    "ServiceLocationId" uuid NOT NULL CHECK("ServiceLocationId"<>'00000000-0000-0000-0000-000000000000'),
    "CustomerVersion" integer NOT NULL CHECK("CustomerVersion">0),
    "ParentAssetId" uuid REFERENCES assets("Id") ON DELETE RESTRICT,
    "TeamId" text NOT NULL CHECK("TeamId" ~ '^[A-Za-z0-9_-]{2,64}$'),
    "Name" text NOT NULL CHECK(length(btrim("Name")) BETWEEN 2 AND 100),
    "AssetType" text NOT NULL CHECK("AssetType" IN ('HVAC','Refrigeration','Electrical','Plumbing','Controls','Other')),
    "Manufacturer" text NOT NULL CHECK(length(btrim("Manufacturer")) BETWEEN 2 AND 100),
    "Model" text NOT NULL CHECK(length(btrim("Model")) BETWEEN 1 AND 100),
    "SerialNumber" text NOT NULL CHECK("SerialNumber" ~ '^[A-Za-z0-9._-]{2,64}$'),
    "QrCode" text CHECK("QrCode" IS NULL OR "QrCode" ~ '^[A-Za-z0-9._:/-]{4,128}$'),
    "Criticality" text NOT NULL CHECK("Criticality" IN ('Low','Medium','High','Critical')),
    "Status" text NOT NULL CHECK("Status" IN ('Active','Inactive','Retired')),
    "InstalledAtUtc" timestamptz NOT NULL CHECK("InstalledAtUtc" >= '1950-01-01'),
    "WarrantyEndUtc" timestamptz,
    "Version" integer NOT NULL CHECK("Version">0),
    "CreatedAtUtc" timestamptz NOT NULL,
    "UpdatedAtUtc" timestamptz NOT NULL
);
ALTER TABLE assets ADD CONSTRAINT assets_updated_after_created CHECK("UpdatedAtUtc" >= "CreatedAtUtc");
ALTER TABLE assets ADD CONSTRAINT assets_warranty_after_installation CHECK("WarrantyEndUtc" IS NULL OR "WarrantyEndUtc" >= "InstalledAtUtc");
ALTER TABLE assets ADD CONSTRAINT assets_no_self_parent CHECK("ParentAssetId" IS NULL OR "ParentAssetId" <> "Id");
CREATE UNIQUE INDEX "IX_assets_TeamId_SerialNumber" ON assets("TeamId",lower("SerialNumber"));
CREATE UNIQUE INDEX "IX_assets_TeamId_QrCode" ON assets("TeamId","QrCode") WHERE "QrCode" IS NOT NULL;
CREATE INDEX "IX_assets_CustomerId_Status_Name" ON assets("CustomerId","Status","Name");
CREATE INDEX "IX_assets_TeamId_AssetType_Status" ON assets("TeamId","AssetType","Status");
CREATE INDEX "IX_assets_ParentAssetId" ON assets("ParentAssetId") WHERE "ParentAssetId" IS NOT NULL;

CREATE TABLE asset_location_history (
    "Id" uuid PRIMARY KEY CHECK("Id"<>'00000000-0000-0000-0000-000000000000'),
    "AssetId" uuid NOT NULL REFERENCES assets("Id") ON DELETE RESTRICT,
    "CustomerId" uuid NOT NULL CHECK("CustomerId"<>'00000000-0000-0000-0000-000000000000'),
    "ServiceLocationId" uuid NOT NULL CHECK("ServiceLocationId"<>'00000000-0000-0000-0000-000000000000'),
    "CustomerVersion" integer NOT NULL CHECK("CustomerVersion">0),
    "EffectiveFromUtc" timestamptz NOT NULL,
    "Reason" text NOT NULL CHECK(length(btrim("Reason")) BETWEEN 2 AND 200)
);
CREATE INDEX "IX_asset_location_history_AssetId_EffectiveFromUtc" ON asset_location_history("AssetId","EffectiveFromUtc");

CREATE TABLE asset_changes (
    "Id" uuid PRIMARY KEY,
    "AssetId" uuid NOT NULL REFERENCES assets("Id") ON DELETE RESTRICT,
    "Version" integer NOT NULL CHECK("Version">0),
    "Action" text NOT NULL CHECK("Action" IN ('AssetRegistered.v1','AssetUpdated.v1')),
    "ActorId" text NOT NULL, "ActorRole" text NOT NULL, "CorrelationId" text NOT NULL,
    "OccurredAtUtc" timestamptz NOT NULL, "DetailsJson" jsonb NOT NULL CHECK(jsonb_typeof("DetailsJson")='object')
);
CREATE UNIQUE INDEX "IX_asset_changes_AssetId_Version" ON asset_changes("AssetId","Version");
CREATE FUNCTION asset_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Asset history is append-only'; END $$;
CREATE TRIGGER asset_changes_no_mutation BEFORE UPDATE OR DELETE ON asset_changes FOR EACH ROW EXECUTE FUNCTION asset_history_immutable();
CREATE TRIGGER asset_changes_no_truncate BEFORE TRUNCATE ON asset_changes FOR EACH STATEMENT EXECUTE FUNCTION asset_history_immutable();
CREATE TRIGGER asset_location_history_no_mutation BEFORE UPDATE OR DELETE ON asset_location_history FOR EACH ROW EXECUTE FUNCTION asset_history_immutable();
