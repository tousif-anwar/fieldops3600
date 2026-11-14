-- Customer-owned operational registry. All foreign keys stay within this database.
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
CREATE TABLE customers (
    "Id" uuid PRIMARY KEY CHECK("Id"<>'00000000-0000-0000-0000-000000000000'),
    "DisplayName" text NOT NULL CHECK(length(btrim("DisplayName")) BETWEEN 2 AND 100),
    "CustomerType" text NOT NULL CHECK("CustomerType" IN ('Residential','Commercial')),
    "TeamId" text NOT NULL CHECK("TeamId" ~ '^[A-Za-z0-9_-]{2,64}$'),
    "Status" text NOT NULL CHECK("Status" IN ('Active','Archived')),
    "PreferredChannel" text NOT NULL CHECK("PreferredChannel" IN ('None','Email','Phone')),
    "Version" integer NOT NULL CHECK("Version">0),
    "CreatedAtUtc" timestamptz NOT NULL, "UpdatedAtUtc" timestamptz NOT NULL,
    CHECK("UpdatedAtUtc">="CreatedAtUtc")
);
CREATE INDEX "IX_customers_TeamId_Status_DisplayName" ON customers("TeamId","Status","DisplayName");
CREATE TABLE customer_contacts (
    "Id" uuid PRIMARY KEY CHECK("Id"<>'00000000-0000-0000-0000-000000000000'),
    "CustomerId" uuid NOT NULL REFERENCES customers("Id") ON DELETE RESTRICT,
    "FullName" text NOT NULL CHECK(length(btrim("FullName")) BETWEEN 2 AND 100),
    "Email" text CHECK("Email" IS NULL OR (length("Email") BETWEEN 3 AND 254 AND "Email" ~ '^[^[:space:]@]+@[^[:space:]@]+$')),
    "Phone" text CHECK("Phone" IS NULL OR "Phone" ~ '^\+?[0-9 .()x-]{5,40}$'),
    "IsPrimary" boolean NOT NULL, "EmailConsent" boolean NOT NULL, "PhoneConsent" boolean NOT NULL,
    "ConsentUpdatedAtUtc" timestamptz NOT NULL,
    CHECK("Email" IS NOT NULL OR "Phone" IS NOT NULL),
    CHECK(NOT "EmailConsent" OR "Email" IS NOT NULL), CHECK(NOT "PhoneConsent" OR "Phone" IS NOT NULL)
);
CREATE INDEX customer_contacts_customer ON customer_contacts("CustomerId");
CREATE UNIQUE INDEX "IX_customer_contacts_CustomerId" ON customer_contacts("CustomerId") WHERE "IsPrimary";
CREATE TABLE service_locations (
    "Id" uuid PRIMARY KEY CHECK("Id"<>'00000000-0000-0000-0000-000000000000'),
    "CustomerId" uuid NOT NULL REFERENCES customers("Id") ON DELETE RESTRICT,
    "Name" text NOT NULL CHECK(length(btrim("Name")) BETWEEN 2 AND 100),
    "AddressLine1" text NOT NULL CHECK(length(btrim("AddressLine1")) BETWEEN 3 AND 200),
    "AddressLine2" text CHECK(length("AddressLine2")<=100),
    "City" text NOT NULL CHECK(length(btrim("City")) BETWEEN 2 AND 100),
    "Region" text NOT NULL CHECK(length("Region")<=100),
    "PostalCode" text NOT NULL CHECK(length(btrim("PostalCode")) BETWEEN 1 AND 20),
    "CountryCode" text NOT NULL CHECK("CountryCode" ~ '^[A-Z]{2}$'),
    "AccessNotes" text CHECK(length("AccessNotes")<=1000),
    "Status" text NOT NULL CHECK("Status" IN ('Active','Archived'))
);
CREATE INDEX "IX_service_locations_CustomerId_Status" ON service_locations("CustomerId","Status");
CREATE TABLE customer_changes (
    "Id" uuid PRIMARY KEY,
    "CustomerId" uuid NOT NULL REFERENCES customers("Id") ON DELETE RESTRICT,
    "Version" integer NOT NULL CHECK("Version">0),
    "Action" text NOT NULL CHECK("Action" IN ('CustomerRegistered.v1','CustomerUpdated.v1')),
    "ActorId" text NOT NULL, "ActorRole" text NOT NULL, "CorrelationId" text NOT NULL,
    "OccurredAtUtc" timestamptz NOT NULL, "DetailsJson" jsonb NOT NULL CHECK(jsonb_typeof("DetailsJson")='object')
);
CREATE UNIQUE INDEX "IX_customer_changes_CustomerId_Version" ON customer_changes("CustomerId","Version");
CREATE FUNCTION customer_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Customer history is append-only'; END $$;
CREATE TRIGGER customer_changes_no_mutation BEFORE UPDATE OR DELETE ON customer_changes FOR EACH ROW EXECUTE FUNCTION customer_history_immutable();
CREATE TRIGGER customer_changes_no_truncate BEFORE TRUNCATE ON customer_changes FOR EACH STATEMENT EXECUTE FUNCTION customer_history_immutable();
