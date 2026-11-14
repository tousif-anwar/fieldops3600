-- Add a logical reference to the asset owner. No cross-service FK is created:
-- the work-order service validates ownership and location over the Assets API.
ALTER TABLE work_orders ADD COLUMN "AssetId" uuid;

ALTER TABLE work_orders ADD CONSTRAINT work_orders_asset_requires_registered_customer CHECK (
    "AssetId" IS NULL OR (
        "CustomerId" IS NOT NULL
        AND "ServiceLocationId" IS NOT NULL
        AND "CustomerVersion" IS NOT NULL
        AND "CustomerVersion" > 0
        AND "UnregisteredCustomerReason" IS NULL
    )
);
ALTER TABLE work_orders ADD CONSTRAINT work_orders_asset_nonzero CHECK (
    "AssetId" IS NULL OR "AssetId" <> '00000000-0000-0000-0000-000000000000'
);

-- Equipment history is a team-scoped, newest-first lookup.
CREATE INDEX work_orders_asset_recent
    ON work_orders ("TeamId", "AssetId", "CreatedAtUtc" DESC, "Id")
    WHERE "AssetId" IS NOT NULL;
