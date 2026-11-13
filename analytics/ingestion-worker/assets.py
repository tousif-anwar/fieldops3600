"""Asset projections with exact source-version history.

Serial numbers and QR identities stay out of the warehouse; manufacturer, model,
type and criticality are non-personal classification attributes.
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

import customers

EVENTS = {"AssetRegistered.v1", "AssetUpdated.v1"}
TYPES = {"HVAC", "Refrigeration", "Electrical", "Plumbing", "Controls", "Other"}
CRITICALITIES = {"Low", "Medium", "High", "Critical"}
STATUSES = {"Active", "Inactive", "Retired"}


def _utc(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def project(connection, event: dict, payload: dict) -> None:
    team = payload.get("teamId")
    if not isinstance(team, str) or not team.strip():
        raise ValueError("Asset event requires team scope")
    asset_id = str(UUID(payload["assetId"]))
    customer_id = payload.get("customerId")
    if not customer_id:
        raise ValueError("Asset event requires a customer reference")
    customer_key = customers.identity(connection, customer_id, team)
    source_version = payload["version"]
    if isinstance(source_version, bool) or not isinstance(source_version, int) or source_version < 1:
        raise ValueError("Asset source version must be positive")
    asset_type, criticality, status = payload.get("assetType"), payload.get("criticality"), payload.get("status")
    if asset_type not in TYPES or criticality not in CRITICALITIES or status not in STATUSES:
        raise ValueError("Asset classification is invalid")
    manufacturer, model = payload.get("manufacturer"), payload.get("model")
    if not isinstance(manufacturer, str) or not manufacturer.strip() or not isinstance(model, str) or not model.strip():
        raise ValueError("Asset manufacturer and model are required")
    parent = payload.get("parentAssetId")
    parent_reference = str(UUID(parent)) if parent else None
    installed = _utc(payload.get("installedAtUtc"))
    warranty = _utc(payload.get("warrantyEndUtc"))
    row = connection.execute(
        """INSERT INTO warehouse.dim_asset(asset_reference,customer_key,team_id,asset_type,criticality,status,
        manufacturer,model,parent_asset_reference,source_version,installed_at_utc,warranty_end_utc,created_at_utc,updated_at_utc,last_ingested_at_utc)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,now())
        ON CONFLICT(asset_reference) DO UPDATE SET
        customer_key=excluded.customer_key,asset_type=excluded.asset_type,criticality=excluded.criticality,
        status=excluded.status,manufacturer=excluded.manufacturer,model=excluded.model,
        parent_asset_reference=excluded.parent_asset_reference,source_version=excluded.source_version,
        installed_at_utc=excluded.installed_at_utc,warranty_end_utc=excluded.warranty_end_utc,
        created_at_utc=COALESCE(warehouse.dim_asset.created_at_utc,excluded.created_at_utc),
        updated_at_utc=excluded.updated_at_utc,last_ingested_at_utc=now()
        WHERE warehouse.dim_asset.source_version < excluded.source_version
        RETURNING asset_key""",
        (asset_id, customer_key, team, asset_type, criticality, status, manufacturer.strip(), model.strip(),
         parent_reference, source_version, installed, warranty, payload.get("createdAtUtc"),
         payload.get("updatedAtUtc") or event["occurredAtUtc"]),
    ).fetchone()
    if row is None:
        row = connection.execute(
            "SELECT asset_key FROM warehouse.dim_asset WHERE asset_reference=%s", (asset_id,)
        ).fetchone()
    if row is None:
        raise ValueError("Asset projection is unavailable for a stale event")
    key = row[0]
    previous = connection.execute(
        "SELECT event_id FROM warehouse.fact_asset_change WHERE asset_key=%s AND source_version=%s",
        (key, source_version),
    ).fetchone()
    if previous is not None:
        if str(previous[0]) != str(event["eventId"]):
            raise ValueError("Asset version collision: a different event carries this revision")
        return
    connection.execute(
        """INSERT INTO warehouse.fact_asset_change(event_id,asset_key,source_version,event_type,occurred_at_utc)
        VALUES(%s,%s,%s,%s,%s)""",
        (event["eventId"], key, source_version, event["eventType"], event["occurredAtUtc"]),
    )
