"""Reconcile retained original JSONL events and optionally backfill the warehouse.

Uses only WAREHOUSE_DSN. Never connects to or changes operational databases.
The entire bounded archive commits together; errors roll it back. Output contains
counts and an archive hash, never event payloads or connection credentials.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
from uuid import UUID

import psycopg

from worker import project

MAX_BYTES = 50 * 1024 * 1024
MAX_EVENTS = 10_000


def digest(event: dict) -> str:
    return hashlib.sha256(json.dumps(event, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def read_archive(path: Path) -> tuple[list[dict], str]:
    if path.stat().st_size > MAX_BYTES:
        raise ValueError("Archive exceeds the 50 MiB transaction limit; split it first")
    raw = path.read_bytes()
    events = []
    for number, line in enumerate(raw.decode("utf-8-sig").splitlines(), 1):
        if not line.strip():
            continue
        if len(events) >= MAX_EVENTS:
            raise ValueError("Archive exceeds the 10,000 event transaction limit")
        event = json.loads(line)
        if not isinstance(event, dict) or not all(key in event for key in
            ("eventId", "eventType", "sourceService", "workOrderId", "occurredAtUtc", "eventPayload")):
            raise ValueError(f"Line {number} is not an original audit-event envelope")
        UUID(event["eventId"])
        UUID(event["workOrderId"])
        events.append(event)
    if not events:
        raise ValueError("Archive contains no events")
    return events, hashlib.sha256(raw).hexdigest()


def reconcile(connection, events: list[dict], apply: bool = False) -> dict:
    """Caller owns transaction; validate every hash before applying any missing row."""
    unique = {}
    for event in events:
        identity = str(UUID(event["eventId"]))
        if identity in unique and digest(unique[identity]) != digest(event):
            raise ValueError("Archive contains conflicting payloads for one event ID")
        unique[identity] = event
    matched = missing = 0
    for identity, event in unique.items():
        row = connection.execute(
            "SELECT payload_hash FROM warehouse.ingestion_ledger WHERE event_id=%s", (identity,)
        ).fetchone()
        if row and row[0] != digest(event):
            raise ValueError("Retained event differs from the warehouse ledger; no backfill applied")
        if row:
            matched += 1
        else:
            missing += 1
    inserted = 0
    if apply:
        connection.execute("SELECT pg_advisory_xact_lock(360003)")
        for event in unique.values():
            inserted += int(project(connection, event))
    return {"sourceRows": len(events), "distinctEvents": len(unique),
            "repeatedArchiveRows": len(events) - len(unique), "matched": matched,
            "missingBefore": missing, "inserted": inserted, "applied": apply}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path, help="JSONL of unchanged original event envelopes")
    parser.add_argument("--apply", action="store_true", help="Commit missing events; default only reconciles")
    args = parser.parse_args()
    try:
        events, archive_hash = read_archive(args.archive)
        with psycopg.connect(os.environ["WAREHOUSE_DSN"]) as connection:
            report = reconcile(connection, events, args.apply)
        print(json.dumps({"archiveSha256": archive_hash, **report}, sort_keys=True))
    except (ValueError, OSError, KeyError, psycopg.Error) as error:
        # A driver exception can contain SQL/connection details; expose only its type.
        print(json.dumps({"ok": False, "errorType": type(error).__name__,
                          "message": "Archive validation or database transaction failed; no changes committed"}))
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
