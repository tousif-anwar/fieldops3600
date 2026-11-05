"""Idempotent analytical projection; consumes MT business events without reading operational DBs."""

# SQL statements retain their schema-qualified expressions for review.
# ruff: noqa: E501
from __future__ import annotations

import hashlib
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

import pika
import psycopg
from psycopg.types.json import Jsonb

LOG = logging.getLogger("fieldops.warehouse")
QUEUE = "fieldops-warehouse"
SAFE_FIELDS = {
    "teamId",
    "technicianId",
    "number",
    "serviceCategory",
    "priority",
    "status",
    "createdAtUtc",
    "completedAtUtc",
    "startedAtUtc",
    "deadlineUtc",
    "stageName",
    "stageIndex",
    "pausedSeconds",
    "slaStatus",
    "id",
    "startUtc",
    "endUtc",
    "version",
    "workingStartHour",
    "workingEndHour",
    "timeZone",
    "supervisorId",
    "skills",
    "certifications",
    "available",
    "timeOffId",
}

TECHNICIAN_EVENT = "TechnicianAvailabilityChanged.v1"
TIME_OFF_EVENT = "TechnicianTimeOffChanged.v1"


def _utc(value) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    else:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _array(value) -> list:
    if isinstance(value, list):
        return [item for item in value if isinstance(item, str)]
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
            return [item for item in decoded if isinstance(item, str)] if isinstance(decoded, list) else []
        except ValueError:
            return []
    return []


def _technician_state(payload: dict) -> dict:
    start, end, zone = (
        payload.get("workingStartHour"),
        payload.get("workingEndHour"),
        payload.get("timeZone"),
    )
    valid_hours = (
        isinstance(start, int)
        and isinstance(end, int)
        and 0 <= start < end <= 24
    )
    minutes = (end - start) * 60 if valid_hours else 1
    return {
        "team_id": payload.get("teamId") or "Unknown",
        "supervisor_id": payload.get("supervisorId"),
        "working_minutes_per_day": max(1, min(1440, minutes)),
        "working_start_hour": start if valid_hours else None,
        "working_end_hour": end if valid_hours else None,
        "time_zone": zone if isinstance(zone, str) and zone.strip() else None,
        "available": bool(payload.get("available", True)),
        "skills": _array(payload.get("skills", [])),
        "certifications": _array(payload.get("certifications", [])),
    }


def _state_hash(state: dict) -> str:
    return hashlib.sha256(
        json.dumps(state, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def _same_version(row, state: dict) -> bool:
    return (
        row[1] == state["team_id"]
        and row[2] == state["working_minutes_per_day"]
        and row[3] == state["capacity_authoritative"]
        and row[4] == state["working_start_hour"]
        and row[5] == state["working_end_hour"]
        and row[6] == state["time_zone"]
        and row[7] == state["supervisor_id"]
        and row[8] == state["skills"]
        and row[9] == state["certifications"]
        and row[10] == state["available"]
    )


def _insert_version(connection, technician: str, state: dict, occurred, effective_to, current: bool, sequence: int) -> int:
    return connection.execute(
        """INSERT INTO warehouse.dim_technician(technician_id,team_id,working_minutes_per_day,capacity_authoritative,source_sequence,working_start_hour,working_end_hour,time_zone,effective_from_utc,effective_to_utc,is_current,supervisor_id,skills,certifications,available,row_hash)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING technician_key""",
        (
            technician, state["team_id"], state["working_minutes_per_day"],
            state["capacity_authoritative"], sequence, state["working_start_hour"],
            state["working_end_hour"], state["time_zone"], occurred, effective_to,
            current, state["supervisor_id"], Jsonb(state["skills"]),
            Jsonb(state["certifications"]), state["available"],
            _state_hash(state),
        ),
    ).fetchone()[0]


def _apply_technician_version(connection, payload: dict, occurred: datetime, sequence: int) -> int:
    """Append or correct an SCD2 version, including late and out-of-order events."""
    state = _technician_state(payload)
    state["capacity_authoritative"] = bool(
        state["working_start_hour"] is not None
        and state["time_zone"] is not None
        and connection.execute(
            "SELECT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=%s)",
            (state["time_zone"],),
        ).fetchone()[0]
    )
    technician = str(payload["technicianId"])
    active = connection.execute(
        """SELECT technician_key,team_id,working_minutes_per_day,capacity_authoritative,working_start_hour,working_end_hour,time_zone,supervisor_id,skills,certifications,available,effective_from_utc,source_sequence
        FROM warehouse.dim_technician WHERE technician_id=%s AND effective_from_utc<=%s
        AND (effective_to_utc IS NULL OR %s<effective_to_utc) ORDER BY effective_from_utc DESC,technician_key DESC LIMIT 1""",
        (technician, occurred, occurred),
    ).fetchone()
    if active and _same_version(active, state):
        connection.execute(
            "UPDATE warehouse.dim_technician SET source_sequence=GREATEST(source_sequence,%s) WHERE technician_key=%s",
            (sequence, active[0]),
        )
        return active[0]
    if active and active[11] == occurred:
        connection.execute(
            """UPDATE warehouse.dim_technician SET team_id=%s,working_minutes_per_day=%s,capacity_authoritative=%s,
            working_start_hour=%s,working_end_hour=%s,time_zone=%s,supervisor_id=%s,skills=%s,certifications=%s,
            available=%s,row_hash=%s,source_sequence=GREATEST(source_sequence,%s) WHERE technician_key=%s""",
            (state["team_id"], state["working_minutes_per_day"], state["capacity_authoritative"],
             state["working_start_hour"], state["working_end_hour"], state["time_zone"],
             state["supervisor_id"], Jsonb(state["skills"]), Jsonb(state["certifications"]),
             state["available"], _state_hash(state), sequence, active[0]),
        )
        return active[0]
    next_row = connection.execute(
        "SELECT effective_from_utc FROM warehouse.dim_technician WHERE technician_id=%s AND effective_from_utc>%s ORDER BY effective_from_utc LIMIT 1",
        (technician, occurred),
    ).fetchone()
    if active:
        connection.execute(
            "UPDATE warehouse.dim_technician SET effective_to_utc=%s,is_current=false WHERE technician_key=%s",
            (occurred, active[0]),
        )
    else:
        previous = connection.execute(
            "SELECT technician_key FROM warehouse.dim_technician WHERE technician_id=%s AND effective_from_utc<%s ORDER BY effective_from_utc DESC LIMIT 1",
            (technician, occurred),
        ).fetchone()
        if previous:
            connection.execute(
                "UPDATE warehouse.dim_technician SET effective_to_utc=%s,is_current=false WHERE technician_key=%s",
                (occurred, previous[0]),
            )
    return _insert_version(
        connection, technician, state, occurred,
        next_row[0] if next_row else None, next_row is None, sequence,
    )


def _ensure_technician(connection, payload: dict, occurred: datetime) -> int:
    technician = str(payload["technicianId"])
    existing = connection.execute(
        "SELECT technician_key FROM warehouse.dim_technician WHERE technician_id=%s AND is_current LIMIT 1",
        (technician,),
    ).fetchone()
    if existing:
        return existing[0]
    state = _technician_state(payload)
    state["capacity_authoritative"] = False
    return _insert_version(connection, technician, state, occurred, None, True, 0)


def _technician_key_at(connection, technician: str, at: datetime) -> int | None:
    row = connection.execute(
        """SELECT technician_key FROM warehouse.dim_technician WHERE technician_id=%s
        AND effective_from_utc<=%s AND (effective_to_utc IS NULL OR %s<effective_to_utc)
        ORDER BY effective_from_utc DESC,technician_key DESC LIMIT 1""",
        (technician, at, at),
    ).fetchone()
    if row:
        return row[0]
    row = connection.execute(
        "SELECT technician_key FROM warehouse.dim_technician WHERE technician_id=%s ORDER BY effective_from_utc,technician_key LIMIT 1",
        (technician,),
    ).fetchone()
    return row[0] if row else None


def _project_time_off(connection, event_id: str, payload: dict, occurred: datetime, sequence: int) -> None:
    time_off_id = payload.get("timeOffId") or payload.get("id")
    technician = payload.get("technicianId")
    team = payload.get("teamId")
    if not time_off_id or not technician or not team:
        raise ValueError("Time-off events require timeOffId, technicianId and teamId")
    start, end = _utc(payload["startUtc"]), _utc(payload["endUtc"])
    if end <= start:
        raise ValueError("Time-off interval must be positive")
    technician = str(technician)
    key = _technician_key_at(connection, technician, start) or _ensure_technician(connection, payload, occurred)
    connection.execute(
        """INSERT INTO warehouse.fact_technician_time_off(event_id,time_off_id,technician_key,technician_id,team_id,start_utc,end_utc,source_sequence)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(time_off_id) DO UPDATE SET
        technician_key=COALESCE(excluded.technician_key,warehouse.fact_technician_time_off.technician_key),
        start_utc=excluded.start_utc,end_utc=excluded.end_utc,
        source_sequence=GREATEST(excluded.source_sequence,warehouse.fact_technician_time_off.source_sequence)""",
        (event_id, time_off_id, key, technician, team, start, end, sequence),
    )


def migrate(connection) -> None:
    """Versioned, transactional and serialized warehouse-only migrations."""
    connection.execute("SELECT pg_advisory_xact_lock(360002)")
    connection.execute("CREATE SCHEMA IF NOT EXISTS warehouse")
    connection.execute(
        "CREATE TABLE IF NOT EXISTS warehouse.schema_migration(version text PRIMARY KEY, applied_at_utc timestamptz NOT NULL DEFAULT now())"
    )
    for migration in sorted((Path(__file__).resolve().parents[1] / "migrations").glob("*.sql")):
        if connection.execute(
            "SELECT 1 FROM warehouse.schema_migration WHERE version=%s", (migration.name,)
        ).fetchone():
            continue
        connection.execute(migration.read_text(encoding="utf-8"))
        connection.execute(
            "INSERT INTO warehouse.schema_migration(version) VALUES(%s)", (migration.name,)
        )


def project(connection, event: dict) -> bool:
    """The caller owns commit. A repeated event is a no-op; changed duplicate evidence is rejected."""
    event_id = str(UUID(event["eventId"]))
    if event.get("schemaVersion", 1) != 1:
        raise ValueError("Unsupported event schema")
    digest = hashlib.sha256(
        json.dumps(event, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    old = connection.execute(
        "SELECT payload_hash FROM warehouse.ingestion_ledger WHERE event_id=%s", (event_id,)
    ).fetchone()
    if old:
        if old[0] != digest:
            raise ValueError("Event identity collision: immutable payload differs")
        return False
    kind, occurred = event["eventType"], event["occurredAtUtc"]
    sequence = int(event.get("sequenceNumber") or 0)
    connection.execute(
        "INSERT INTO warehouse.ingestion_ledger(event_id,event_type,source_service,occurred_at_utc,payload_hash,schema_version,source_sequence) VALUES(%s,%s,%s,%s,%s,1,%s)",
        (event_id, kind, event["sourceService"], occurred, digest, sequence),
    )
    order_id = str(UUID(event["workOrderId"]))
    payload = event.get("eventPayload", {})
    safe = {key: value for key, value in payload.items() if key in SAFE_FIELDS}
    connection.execute(
        "INSERT INTO warehouse.staging_event VALUES(%s,%s,%s)", (event_id, order_id, Jsonb(safe))
    )
    team = payload.get("teamId")
    # Availability events have no work order; update a conformed dimension independently.
    technician = payload.get("technicianId")
    tech_key = None
    if technician and team:
        hours = payload.get("workingEndHour", 17) - payload.get("workingStartHour", 8)
        technician_event = (
            event["sourceService"] == "technicians" and kind == "TechnicianAvailabilityChanged.v1"
        )
        known = (
            technician_event
            and 0 < hours <= 24
            and all(key in payload for key in ("workingStartHour", "workingEndHour", "timeZone"))
        )
        if known:
            known = connection.execute(
                "SELECT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=%s)",
                (payload["timeZone"],),
            ).fetchone()[0]
        tech_key = connection.execute(
            """INSERT INTO warehouse.dim_technician(technician_id,team_id,working_minutes_per_day,capacity_authoritative,source_sequence,working_start_hour,working_end_hour,time_zone) VALUES(%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT(technician_id) DO UPDATE SET
            team_id=CASE WHEN %s AND excluded.source_sequence>=warehouse.dim_technician.source_sequence THEN excluded.team_id ELSE warehouse.dim_technician.team_id END,
            working_minutes_per_day=CASE WHEN excluded.capacity_authoritative AND excluded.source_sequence>=warehouse.dim_technician.source_sequence THEN excluded.working_minutes_per_day ELSE warehouse.dim_technician.working_minutes_per_day END,
            capacity_authoritative=CASE WHEN %s AND excluded.source_sequence>=warehouse.dim_technician.source_sequence THEN excluded.capacity_authoritative ELSE warehouse.dim_technician.capacity_authoritative END,
            working_start_hour=CASE WHEN excluded.capacity_authoritative AND excluded.source_sequence>=warehouse.dim_technician.source_sequence THEN excluded.working_start_hour ELSE warehouse.dim_technician.working_start_hour END,
            working_end_hour=CASE WHEN excluded.capacity_authoritative AND excluded.source_sequence>=warehouse.dim_technician.source_sequence THEN excluded.working_end_hour ELSE warehouse.dim_technician.working_end_hour END,
            time_zone=CASE WHEN excluded.capacity_authoritative AND excluded.source_sequence>=warehouse.dim_technician.source_sequence THEN excluded.time_zone ELSE warehouse.dim_technician.time_zone END,
            source_sequence=CASE WHEN %s THEN GREATEST(warehouse.dim_technician.source_sequence,excluded.source_sequence) ELSE warehouse.dim_technician.source_sequence END
            RETURNING technician_key""",
            (
                technician,
                team,
                max(1, hours * 60),
                known,
                sequence if technician_event else 0,
                payload.get("workingStartHour"),
                payload.get("workingEndHour"),
                payload.get("timeZone"),
                technician_event,
                technician_event,
                technician_event,
            ),
        ).fetchone()[0]
    if UUID(order_id).int == 0 or not team:
        return True
    connection.execute(
        """INSERT INTO warehouse.fact_work_order(work_order_id,team_id,last_occurrence_utc,technician_key)
        VALUES(%s,%s,%s,%s) ON CONFLICT(work_order_id) DO UPDATE SET
        technician_key=COALESCE(warehouse.fact_work_order.technician_key,excluded.technician_key),
        last_occurrence_utc=GREATEST(excluded.last_occurrence_utc,warehouse.fact_work_order.last_occurrence_utc),last_ingested_at_utc=now()""",
        (order_id, team, occurred, tech_key),
    )
    if kind in {"WorkOrderCreated.v1", "WorkOrderUpdated.v1", "WorkOrderCompleted.v1"}:
        category = payload.get("serviceCategory", "Unknown")
        category_key = connection.execute(
            "INSERT INTO warehouse.dim_service_category(category) VALUES(%s) ON CONFLICT(category) DO UPDATE SET category=excluded.category RETURNING category_key",
            (category,),
        ).fetchone()[0]
        created = payload.get("createdAtUtc", occurred)
        calendar = (
            datetime.fromisoformat(created.replace("Z", "+00:00")).astimezone(timezone.utc).date()
        )
        date_key = int(calendar.strftime("%Y%m%d"))
        connection.execute(
            "INSERT INTO warehouse.dim_date VALUES(%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
            (date_key, calendar, calendar.year, calendar.month, calendar.isoweekday()),
        )
        status = (
            "Completed" if kind == "WorkOrderCompleted.v1" else payload.get("status", "Created")
        )
        connection.execute(
            "INSERT INTO warehouse.dim_work_order_status(status) VALUES(%s) ON CONFLICT(status) DO NOTHING",
            (status,),
        )
        connection.execute(
            """UPDATE warehouse.fact_work_order SET number=%s,category_key=%s,created_date_key=%s,priority=%s,
            created_at_utc=COALESCE(created_at_utc,%s::timestamptz),customer_key=(SELECT customer_key FROM warehouse.dim_customer ORDER BY customer_key LIMIT 1),
            source_status=%s,order_source_sequence=GREATEST(order_source_sequence,%s),order_source_occurred_at_utc=%s
            WHERE work_order_id=%s AND ((order_source_sequence>0 AND %s>=order_source_sequence)
              OR (order_source_sequence=0 AND (order_source_occurred_at_utc IS NULL OR %s::timestamptz>=order_source_occurred_at_utc)))""",
            (
                payload.get("number", ""),
                category_key,
                date_key,
                payload.get("priority", "Normal"),
                created,
                status,
                sequence,
                occurred,
                order_id,
                sequence,
                occurred,
            ),
        )
    if kind == "WorkflowStarted.v1":
        connection.execute(
            "UPDATE warehouse.fact_work_order SET workflow_started_at_utc=COALESCE(workflow_started_at_utc,%s::timestamptz),technician_key=COALESCE(%s,technician_key) WHERE work_order_id=%s",
            (occurred, tech_key, order_id),
        )
    if kind in {"WorkflowCompleted.v1", "WorkOrderCompleted.v1"}:
        connection.execute(
            """UPDATE warehouse.fact_work_order SET completed_at_utc=COALESCE(completed_at_utc,%s::timestamptz),
            status_key=(SELECT status_key FROM warehouse.dim_work_order_status WHERE status='Completed') WHERE work_order_id=%s""",
            (payload.get("completedAtUtc") or occurred, order_id),
        )
    stage_id = event.get("stageInstanceId")
    if stage_id and kind.startswith(("Stage", "SupervisorOverride")):
        stage_index = payload.get("stageIndex")
        stage_key = None
        if stage_index is not None:
            row = connection.execute(
                "SELECT stage_key FROM warehouse.dim_workflow_stage WHERE stage_index=%s",
                (stage_index,),
            ).fetchone()
            stage_key = row[0] if row else None
        status = payload.get("status") or (
            "Completed"
            if kind == "StageCompleted.v1"
            else "Paused"
            if kind == "StagePaused.v1"
            else "Overridden"
            if kind == "SupervisorOverrideApplied.v1"
            else "Active"
        )
        sla_status = (
            "Breached"
            if kind == "StageSLABreached.v1"
            else payload.get("slaStatus")
            or (
                "Critical"
                if kind == "StageCriticalWarningRaised.v1"
                else "Warning"
                if kind == "StageWarningRaised.v1"
                else "OnTime"
            )
        )
        connection.execute(
            """INSERT INTO warehouse.fact_workflow_stage(stage_instance_id,work_order_id,stage_key,started_at_utc,deadline_utc,completed_at_utc,paused_seconds,breached,status,last_sequence,sla_status)
            VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(stage_instance_id) DO UPDATE SET
            stage_key=COALESCE(excluded.stage_key,warehouse.fact_workflow_stage.stage_key),
            started_at_utc=COALESCE(warehouse.fact_workflow_stage.started_at_utc,excluded.started_at_utc),
            deadline_utc=CASE WHEN excluded.last_sequence>=warehouse.fact_workflow_stage.last_sequence THEN COALESCE(excluded.deadline_utc,warehouse.fact_workflow_stage.deadline_utc) ELSE warehouse.fact_workflow_stage.deadline_utc END,
            completed_at_utc=COALESCE(warehouse.fact_workflow_stage.completed_at_utc,excluded.completed_at_utc),
            paused_seconds=GREATEST(warehouse.fact_workflow_stage.paused_seconds,excluded.paused_seconds),
            breached=warehouse.fact_workflow_stage.breached OR excluded.breached,
            sla_status=CASE WHEN warehouse.fact_workflow_stage.breached OR excluded.breached THEN 'Breached' WHEN excluded.last_sequence>=warehouse.fact_workflow_stage.last_sequence THEN excluded.sla_status ELSE warehouse.fact_workflow_stage.sla_status END,
            status=CASE WHEN warehouse.fact_workflow_stage.completed_at_utc IS NOT NULL THEN warehouse.fact_workflow_stage.status WHEN excluded.last_sequence>=warehouse.fact_workflow_stage.last_sequence THEN excluded.status ELSE warehouse.fact_workflow_stage.status END,
            last_sequence=GREATEST(warehouse.fact_workflow_stage.last_sequence,excluded.last_sequence)""",
            (
                stage_id,
                order_id,
                stage_key,
                payload.get("startedAtUtc"),
                payload.get("deadlineUtc"),
                payload.get("completedAtUtc"),
                payload.get("pausedSeconds", 0),
                kind == "StageSLABreached.v1" or payload.get("slaStatus") == "Breached",
                status,
                sequence,
                sla_status,
            ),
        )
    if kind == "StageSLABreached.v1" and stage_id:
        connection.execute(
            "INSERT INTO warehouse.fact_sla_breach VALUES(%s,%s,%s,%s) ON CONFLICT DO NOTHING",
            (event_id, order_id, stage_id, occurred),
        )
    if kind in {
        "StagePaused.v1",
        "StageResumed.v1",
        "SupervisorOverrideApplied.v1",
        "RecommendationDecisionRecorded.v1",
    }:
        supervisor_key = connection.execute(
            "INSERT INTO warehouse.dim_supervisor(supervisor_id,team_id) VALUES(%s,%s) ON CONFLICT(supervisor_id) DO UPDATE SET team_id=excluded.team_id RETURNING supervisor_key",
            (event["actorId"], team),
        ).fetchone()[0]
        connection.execute(
            "INSERT INTO warehouse.fact_supervisor_intervention VALUES(%s,%s,%s,%s,%s)",
            (event_id, order_id, supervisor_key, kind, occurred),
        )
    if kind.startswith("Booking") and payload.get("id"):
        status = (
            "Cancelled" if kind == "BookingCancelled.v1" else payload.get("status", "Confirmed")
        )
        connection.execute(
            """INSERT INTO warehouse.fact_booking(booking_id,work_order_id,technician_key,start_utc,end_utc,status,source_version) VALUES(%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT(booking_id) DO UPDATE SET
             start_utc=CASE WHEN excluded.source_version>=warehouse.fact_booking.source_version THEN COALESCE(excluded.start_utc,warehouse.fact_booking.start_utc) ELSE COALESCE(warehouse.fact_booking.start_utc,excluded.start_utc) END,
             end_utc=CASE WHEN excluded.source_version>=warehouse.fact_booking.source_version THEN COALESCE(excluded.end_utc,warehouse.fact_booking.end_utc) ELSE COALESCE(warehouse.fact_booking.end_utc,excluded.end_utc) END,
             technician_key=CASE WHEN excluded.source_version>=warehouse.fact_booking.source_version THEN COALESCE(excluded.technician_key,warehouse.fact_booking.technician_key) ELSE COALESCE(warehouse.fact_booking.technician_key,excluded.technician_key) END,
             status=CASE WHEN excluded.source_version>warehouse.fact_booking.source_version THEN excluded.status ELSE warehouse.fact_booking.status END,
             source_version=GREATEST(excluded.source_version,warehouse.fact_booking.source_version)""",
            (
                payload["id"],
                order_id,
                tech_key,
                payload.get("startUtc"),
                payload.get("endUtc"),
                status,
                sequence,
            ),
        )
    connection.execute("SELECT analytics.refresh_order_status(%s)", (order_id,))
    return True


def run() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    dsn = os.environ["WAREHOUSE_DSN"]
    migrate_only = "--migrate-only" in sys.argv[1:]
    initialize = os.environ.get("DATABASE_INITIALIZE", "false").lower() == "true"
    if migrate_only or initialize:
        with psycopg.connect(dsn) as database:
            migrate(database)
            grants = os.environ.get("DATABASE_RUNTIME_GRANTS_PATH")
            if grants:
                database.execute(Path(grants).read_text(encoding="utf-8"))
    if migrate_only:
        LOG.info("warehouse migrations completed; consumer was not started")
        return
    credentials = pika.PlainCredentials(
        os.environ.get("RABBITMQ_USER", "fieldops"), os.environ["RABBITMQ_PASSWORD"]
    )
    parameters = pika.ConnectionParameters(
        os.environ.get("RABBITMQ_HOST", "rabbitmq"),
        credentials=credentials,
        heartbeat=60,
        blocked_connection_timeout=30,
    )
    while True:
        try:
            rabbit = pika.BlockingConnection(parameters)
            channel = rabbit.channel()
            channel.exchange_declare(
                "FieldOps.Core:AuditEvent", exchange_type="fanout", durable=True
            )
            channel.queue_declare(QUEUE, durable=True)
            channel.queue_bind(QUEUE, "FieldOps.Core:AuditEvent")
            channel.queue_declare(
                QUEUE + ".retry",
                durable=True,
                arguments={
                    "x-message-ttl": 2000,
                    "x-dead-letter-exchange": "",
                    "x-dead-letter-routing-key": QUEUE,
                },
            )
            channel.queue_declare(QUEUE + ".error", durable=True)
            channel.basic_qos(prefetch_count=1)
            channel.confirm_delivery()

            def received(ch, method, properties, body):
                try:
                    envelope = json.loads(body)
                    event = envelope.get("message", envelope)
                    with psycopg.connect(dsn) as database:
                        changed = project(database, event)
                    ch.basic_ack(method.delivery_tag)
                    LOG.info(
                        "event=%s result=%s",
                        event.get("eventId"),
                        "projected" if changed else "duplicate",
                    )
                except Exception as error:
                    # Log error type only: event bodies and DSNs can contain private data.
                    retries = int((properties.headers or {}).get("fieldops-retries", 0)) + 1
                    target = QUEUE + (".error" if retries >= 5 else ".retry")
                    LOG.error(
                        "warehouse attempt=%s status=%s errorType=%s",
                        retries,
                        target,
                        type(error).__name__,
                    )
                    try:
                        ch.basic_publish(
                            "",
                            target,
                            body,
                            properties=pika.BasicProperties(
                                delivery_mode=2,
                                content_type=properties.content_type,
                                headers={"fieldops-retries": retries},
                            ),
                            mandatory=True,
                        )
                        ch.basic_ack(method.delivery_tag)
                    except Exception:
                        ch.basic_nack(method.delivery_tag, requeue=True)
                        raise

            channel.basic_consume(QUEUE, received)
            LOG.info("warehouse consumer ready")
            channel.start_consuming()
        except (pika.exceptions.AMQPError, OSError, psycopg.Error) as error:
            LOG.warning("consumer reconnect errorType=%s", type(error).__name__)
            time.sleep(2)


if __name__ == "__main__":
    run()
