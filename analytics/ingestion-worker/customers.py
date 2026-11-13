"""Privacy-limited customer projections with exact source-version history."""
from __future__ import annotations

import hashlib
import json
from uuid import UUID

EVENTS = {"CustomerRegistered.v1", "CustomerUpdated.v1"}
FIELDS = ("customerType", "status", "preferredChannel", "contactCount", "locationCount", "activeLocationCount", "emailConsentCount", "phoneConsentCount")


def identity(connection, customer_id: str, team: str) -> int:
    customer_id = str(UUID(customer_id))
    row = connection.execute(
        "INSERT INTO warehouse.dim_customer(customer_reference,team_id) VALUES(%s,%s) ON CONFLICT(customer_reference) DO UPDATE SET team_id=COALESCE(warehouse.dim_customer.team_id,excluded.team_id) RETURNING customer_key,team_id",
        (customer_id, team),
    ).fetchone()
    if row[1] != team:
        raise ValueError("Customer scope cannot change across events")
    return row[0]


def version(connection, key: int, source_version: int, team: str) -> int:
    if isinstance(source_version, bool) or not isinstance(source_version, int) or source_version < 1:
        raise ValueError("Customer source version must be positive")
    return connection.execute(
        "INSERT INTO warehouse.dim_customer_version(customer_key,source_version,team_id) VALUES(%s,%s,%s) ON CONFLICT(customer_key,source_version) DO UPDATE SET source_version=excluded.source_version RETURNING customer_version_key",
        (key, source_version, team),
    ).fetchone()[0]


def location(connection, location_id: str, key: int, team: str, state=None, source_version=0) -> int:
    location_id = str(UUID(location_id))
    row = connection.execute(
        """INSERT INTO warehouse.dim_service_location(service_location_id,customer_key,team_id,status,source_version) VALUES(%s,%s,%s,%s,%s)
        ON CONFLICT(service_location_id) DO UPDATE SET status=CASE WHEN excluded.source_version>warehouse.dim_service_location.source_version THEN excluded.status ELSE warehouse.dim_service_location.status END,
        source_version=GREATEST(excluded.source_version,warehouse.dim_service_location.source_version)
        RETURNING service_location_key,customer_key,team_id""",
        (location_id, key, team, state, source_version),
    ).fetchone()
    if row[1] != key or row[2] != team:
        raise ValueError("Service location ownership cannot change")
    return row[0]


def project(connection, event: dict, payload: dict) -> None:
    team = payload.get("teamId")
    if not isinstance(team, str) or not team.strip():
        raise ValueError("Customer event requires team scope")
    key = identity(connection, payload["customerId"], team)
    source_version = payload["version"]
    version_key = version(connection, key, source_version, team)
    state = {field: payload.get(field) for field in FIELDS}
    if state["customerType"] not in {"Residential", "Commercial"} or state["status"] not in {"Active", "Archived"} or state["preferredChannel"] not in {"None", "Email", "Phone"}:
        raise ValueError("Customer classification is invalid")
    if any(isinstance(state[k], bool) or not isinstance(state[k], int) or state[k] < 0 for k in FIELDS[3:]):
        raise ValueError("Customer aggregate counts must be nonnegative integers")
    locations = payload.get("locations", [])
    if not isinstance(locations, list) or len(locations) != state["locationCount"]:
        raise ValueError("Customer location count must match its sanitized location identities")
    safe_locations = []
    for item in locations:
        if item.get("status") not in {"Active", "Archived"}:
            raise ValueError("Customer location status is invalid")
        safe_locations.append({"serviceLocationId": str(UUID(item["serviceLocationId"])), "status": item["status"]})
    if len({item["serviceLocationId"] for item in safe_locations}) != len(safe_locations):
        raise ValueError("Customer location identities must be unique")
    if state["activeLocationCount"] != sum(item["status"] == "Active" for item in safe_locations):
        raise ValueError("Customer active-location count differs from its identities")
    digest = hashlib.sha256(json.dumps({**state, "locations": sorted(safe_locations, key=lambda x: x["serviceLocationId"]), "createdAtUtc": payload.get("createdAtUtc"), "updatedAtUtc": payload.get("updatedAtUtc")}, sort_keys=True).encode()).hexdigest()
    old = connection.execute("SELECT snapshot_hash FROM warehouse.dim_customer_version WHERE customer_version_key=%s", (version_key,)).fetchone()[0]
    if old is not None and old != digest:
        raise ValueError("Customer version collision: snapshot differs")
    values = tuple(state[k] for k in FIELDS)
    connection.execute(
        """UPDATE warehouse.dim_customer_version SET customer_type=%s,status=%s,preferred_channel=%s,contact_count=%s,location_count=%s,
        active_location_count=%s,email_consent_count=%s,phone_consent_count=%s,occurred_at_utc=%s,inferred=false,snapshot_hash=%s WHERE customer_version_key=%s""",
        (*values, event["occurredAtUtc"], digest, version_key),
    )
    connection.execute(
        """UPDATE warehouse.dim_customer SET customer_type=%s,status=%s,preferred_channel=%s,contact_count=%s,location_count=%s,
        active_location_count=%s,email_consent_count=%s,phone_consent_count=%s,source_version=%s,created_at_utc=%s,updated_at_utc=%s,last_ingested_at_utc=now()
        WHERE customer_key=%s AND source_version<%s""",
        (*values, source_version, payload.get("createdAtUtc"), payload.get("updatedAtUtc") or event["occurredAtUtc"], key, source_version),
    )
    for item in safe_locations:
        location(connection, item["serviceLocationId"], key, team, item["status"], source_version)
    connection.execute(
        """INSERT INTO warehouse.fact_customer_change(event_id,customer_key,customer_version_key,source_version,event_type,occurred_at_utc)
        VALUES(%s,%s,%s,%s,%s,%s) ON CONFLICT(customer_key,source_version) DO NOTHING""",
        (event["eventId"], key, version_key, source_version, event["eventType"], event["occurredAtUtc"]),
    )


def link_order(connection, order_id: str, payload: dict, team: str) -> None:
    customer_id = payload.get("customerId")
    if not customer_id:
        connection.execute("UPDATE warehouse.fact_work_order SET customer_key=(SELECT customer_key FROM warehouse.dim_customer WHERE customer_reference='unresolved-synthetic-reference') WHERE work_order_id=%s AND customer_key IS NULL", (order_id,))
        return
    key = identity(connection, customer_id, team)
    version_key = version(connection, key, payload["customerVersion"], team)
    location_key = location(connection, payload["serviceLocationId"], key, team)
    connection.execute("UPDATE warehouse.fact_work_order SET customer_key=%s,customer_version_key=%s,service_location_key=%s WHERE work_order_id=%s", (key, version_key, location_key, order_id))
