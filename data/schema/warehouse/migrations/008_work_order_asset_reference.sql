-- The asset reference is a logical cross-service identifier, not a warehouse FK:
-- an order event may arrive before the asset dimension projection.
ALTER TABLE warehouse.fact_work_order
    ADD COLUMN asset_reference uuid;

CREATE INDEX fact_work_order_asset
    ON warehouse.fact_work_order(asset_reference, created_at_utc)
    WHERE asset_reference IS NOT NULL;

CREATE INDEX fact_work_order_asset_team
    ON warehouse.fact_work_order(team_id, asset_reference)
    WHERE asset_reference IS NOT NULL;

-- Grain: one linked asset. Orders without an explicit asset reference are excluded
-- rather than being attributed to a customer's other equipment.
CREATE OR REPLACE VIEW analytics.v_asset_service_history AS
SELECT
    a.asset_reference,
    a.team_id,
    count(o.work_order_id) AS linked_work_orders,
    max(o.created_at_utc) AS last_service_at_utc
FROM warehouse.dim_asset a
JOIN warehouse.fact_work_order o
  ON o.asset_reference = a.asset_reference
 AND o.team_id = a.team_id
GROUP BY a.asset_reference, a.team_id;
