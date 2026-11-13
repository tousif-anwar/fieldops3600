-- Additive migration. Existing unresolved customer keys and order facts remain.
ALTER TABLE warehouse.dim_customer
  ADD COLUMN team_id text,
  ADD COLUMN source_version integer NOT NULL DEFAULT 0 CHECK(source_version >= 0),
  ADD COLUMN customer_type text CHECK(customer_type IN ('Residential','Commercial')),
  ADD COLUMN status text CHECK(status IN ('Active','Archived')),
  ADD COLUMN preferred_channel text CHECK(preferred_channel IN ('None','Email','Phone')),
  ADD COLUMN contact_count integer CHECK(contact_count >= 0),
  ADD COLUMN location_count integer CHECK(location_count >= 0),
  ADD COLUMN active_location_count integer CHECK(active_location_count >= 0),
  ADD COLUMN email_consent_count integer CHECK(email_consent_count >= 0),
  ADD COLUMN phone_consent_count integer CHECK(phone_consent_count >= 0),
  ADD COLUMN created_at_utc timestamptz,
  ADD COLUMN updated_at_utc timestamptz,
  ADD COLUMN last_ingested_at_utc timestamptz;
CREATE INDEX dim_customer_scope ON warehouse.dim_customer(team_id,status);

-- One dimension row per customer business version. No names, addresses,
-- contact details or free-text consent evidence enters the warehouse.
-- This is source-version history, not a claim of temporal SCD Type 2.
CREATE TABLE warehouse.dim_customer_version (
  customer_version_key bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_key bigint NOT NULL REFERENCES warehouse.dim_customer,
  source_version integer NOT NULL CHECK(source_version > 0),
  team_id text NOT NULL CHECK(btrim(team_id) <> ''),
  customer_type text CHECK(customer_type IN ('Residential','Commercial')),
  status text CHECK(status IN ('Active','Archived')),
  preferred_channel text CHECK(preferred_channel IN ('None','Email','Phone')),
  contact_count integer CHECK(contact_count >= 0),
  location_count integer CHECK(location_count >= 0),
  active_location_count integer CHECK(active_location_count >= 0 AND active_location_count <= location_count),
  email_consent_count integer CHECK(email_consent_count >= 0 AND email_consent_count <= contact_count),
  phone_consent_count integer CHECK(phone_consent_count >= 0 AND phone_consent_count <= contact_count),
  occurred_at_utc timestamptz,
  inferred boolean NOT NULL DEFAULT true,
  snapshot_hash text,
  UNIQUE(customer_key,source_version),
  UNIQUE(customer_version_key,customer_key),
  CHECK(inferred OR (snapshot_hash IS NOT NULL AND occurred_at_utc IS NOT NULL AND customer_type IS NOT NULL AND status IS NOT NULL))
);
CREATE TABLE warehouse.dim_service_location (
  service_location_key bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  service_location_id uuid UNIQUE NOT NULL,
  customer_key bigint NOT NULL REFERENCES warehouse.dim_customer,
  team_id text NOT NULL CHECK(btrim(team_id) <> ''),
  status text CHECK(status IN ('Active','Archived')),
  source_version integer NOT NULL DEFAULT 0 CHECK(source_version >= 0),
  UNIQUE(service_location_key,customer_key)
);
-- Grain: one accepted customer revision, even if the same revision is delivered
-- with a second event ID. The ingestion ledger retains both delivery identities.
CREATE TABLE warehouse.fact_customer_change (
  event_id uuid PRIMARY KEY REFERENCES warehouse.ingestion_ledger,
  customer_key bigint NOT NULL REFERENCES warehouse.dim_customer,
  customer_version_key bigint NOT NULL,
  source_version integer NOT NULL CHECK(source_version > 0),
  event_type text NOT NULL CHECK(event_type IN ('CustomerRegistered.v1','CustomerUpdated.v1')),
  occurred_at_utc timestamptz NOT NULL,
  UNIQUE(customer_key,source_version),
  FOREIGN KEY(customer_version_key,customer_key) REFERENCES warehouse.dim_customer_version(customer_version_key,customer_key)
);
ALTER TABLE warehouse.fact_work_order
  ADD COLUMN customer_version_key bigint,
  ADD COLUMN service_location_key bigint,
  ADD CONSTRAINT order_customer_version_fkey FOREIGN KEY(customer_version_key,customer_key) REFERENCES warehouse.dim_customer_version(customer_version_key,customer_key),
  ADD CONSTRAINT order_customer_location_fkey FOREIGN KEY(service_location_key,customer_key) REFERENCES warehouse.dim_service_location(service_location_key,customer_key);

CREATE VIEW analytics.v_customer_registry AS
SELECT team_id, customer_type, status, count(*) AS customer_count,
  sum(contact_count) AS contact_count, sum(location_count) AS location_count,
  sum(active_location_count) AS active_location_count,
  sum(email_consent_count) AS email_consent_count,
  sum(phone_consent_count) AS phone_consent_count,
  max(last_ingested_at_utc) AS refreshed_at_utc
FROM warehouse.dim_customer WHERE source_version > 0 GROUP BY team_id,customer_type,status;
