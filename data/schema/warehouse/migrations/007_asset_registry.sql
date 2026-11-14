-- Additive asset registry projection. Serial numbers and QR identities are not ingested.
CREATE TABLE warehouse.dim_asset (
  asset_key bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  asset_reference uuid UNIQUE NOT NULL,
  customer_key bigint NOT NULL REFERENCES warehouse.dim_customer,
  team_id text NOT NULL CHECK(btrim(team_id) <> ''),
  asset_type text NOT NULL CHECK(asset_type IN ('HVAC','Refrigeration','Electrical','Plumbing','Controls','Other')),
  criticality text NOT NULL CHECK(criticality IN ('Low','Medium','High','Critical')),
  status text NOT NULL CHECK(status IN ('Active','Inactive','Retired')),
  manufacturer text NOT NULL CHECK(btrim(manufacturer) <> ''),
  model text NOT NULL CHECK(btrim(model) <> ''),
  parent_asset_reference uuid,
  source_version integer NOT NULL DEFAULT 0 CHECK(source_version >= 0),
  installed_at_utc timestamptz,
  warranty_end_utc timestamptz,
  created_at_utc timestamptz,
  updated_at_utc timestamptz,
  last_ingested_at_utc timestamptz,
  CHECK(warranty_end_utc IS NULL OR installed_at_utc IS NULL OR warranty_end_utc >= installed_at_utc)
);
CREATE INDEX dim_asset_scope ON warehouse.dim_asset(team_id,status);
CREATE INDEX dim_asset_customer ON warehouse.dim_asset(customer_key);
CREATE INDEX dim_asset_warranty ON warehouse.dim_asset(warranty_end_utc) WHERE status <> 'Retired';

-- Grain: one accepted asset revision. A repeated event is a no-op; a different
-- event carrying an already accepted revision is rejected by the ingestion worker.
CREATE TABLE warehouse.fact_asset_change (
  event_id uuid PRIMARY KEY REFERENCES warehouse.ingestion_ledger,
  asset_key bigint NOT NULL REFERENCES warehouse.dim_asset,
  source_version integer NOT NULL CHECK(source_version > 0),
  event_type text NOT NULL CHECK(event_type IN ('AssetRegistered.v1','AssetUpdated.v1')),
  occurred_at_utc timestamptz NOT NULL,
  UNIQUE(asset_key,source_version)
);

CREATE VIEW analytics.v_asset_registry AS
SELECT a.team_id, a.asset_type, a.criticality, a.status, count(*) AS asset_count,
  count(*) FILTER(WHERE a.warranty_end_utc IS NOT NULL AND a.warranty_end_utc BETWEEN now() AND now()+interval '90 days') AS warranty_expiring_90_days,
  count(DISTINCT a.customer_key) AS customers_with_assets,
  max(a.last_ingested_at_utc) AS refreshed_at_utc
FROM warehouse.dim_asset a WHERE a.source_version > 0
GROUP BY a.team_id, a.asset_type, a.criticality, a.status;
