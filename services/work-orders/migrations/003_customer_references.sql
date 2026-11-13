-- Add logical customer-owner references without inventing identities for historical records.
-- Original customer/address snapshots remain unchanged. No cross-service FK is created.
ALTER TABLE work_orders ADD COLUMN "CustomerId" uuid, ADD COLUMN "ServiceLocationId" uuid, ADD COLUMN "CustomerVersion" integer,
    ADD COLUMN "UnregisteredCustomerReason" text;
UPDATE work_orders SET "UnregisteredCustomerReason"='Pre-registry record; original customer and site snapshots retained.'
WHERE "CustomerId" IS NULL;
ALTER TABLE work_orders ADD CONSTRAINT work_orders_customer_reference_pair CHECK (
    ("CustomerId" IS NOT NULL AND "ServiceLocationId" IS NOT NULL
        AND "CustomerId"<>'00000000-0000-0000-0000-000000000000'
        AND "ServiceLocationId"<>'00000000-0000-0000-0000-000000000000'
        AND "CustomerVersion" IS NOT NULL AND "CustomerVersion">0
        AND "UnregisteredCustomerReason" IS NULL)
    OR ("CustomerId" IS NULL AND "ServiceLocationId" IS NULL
        AND "CustomerVersion" IS NULL AND "UnregisteredCustomerReason" IS NOT NULL
        AND length(btrim("UnregisteredCustomerReason")) BETWEEN 8 AND 500)
);
CREATE INDEX "IX_work_orders_CustomerId_CreatedAtUtc" ON work_orders("CustomerId","CreatedAtUtc");
