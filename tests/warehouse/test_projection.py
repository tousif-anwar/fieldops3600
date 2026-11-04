"""Real PostgreSQL warehouse tests; run in the analytics-worker container."""
from datetime import datetime, timedelta, timezone
import importlib.util
import os
from pathlib import Path
import unittest
from uuid import uuid4

import psycopg

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("warehouse_worker", ROOT / "analytics/ingestion-worker/worker.py")
WORKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(WORKER)


class WarehouseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dsn = os.environ["WAREHOUSE_DSN"]
        with psycopg.connect(cls.dsn) as connection:
            connection.execute((ROOT / "analytics/migrations/001_star_schema.sql").read_text(encoding="utf-8"))

    def setUp(self):
        self.db = psycopg.connect(self.dsn)
        self.order = str(uuid4())
        self.stage = str(uuid4())
        self.team = "test-" + str(uuid4())
        self.now = datetime(2026, 11, 4, 12, tzinfo=timezone.utc)

    def tearDown(self):
        self.db.rollback()
        self.db.close()

    def event(self, kind, sequence=1, minutes=0, payload=None, stage=False):
        return {"eventId": str(uuid4()), "eventType": kind, "eventVersion": 1, "workOrderId": self.order,
                "workflowId": str(uuid4()), "stageInstanceId": self.stage if stage else None,
                "actorId": "synthetic-supervisor", "actorRole": "Supervisor", "sourceService": "workflows" if stage else "work-orders",
                "occurredAtUtc": (self.now + timedelta(minutes=minutes)).isoformat(),
                "recordedAtUtc": (self.now + timedelta(minutes=minutes)).isoformat(), "sequenceNumber": sequence,
                "eventPayload": {"teamId": self.team, "technicianId": "tech-" + self.order,
                                 "stageIndex": 0, **(payload or {})}, "schemaVersion": 1}

    def test_duplicate_business_event_is_idempotent(self):
        event = self.event("WorkOrderCreated.v1", payload={"createdAtUtc": self.now.isoformat()})
        self.assertTrue(WORKER.project(self.db, event))
        self.assertFalse(WORKER.project(self.db, event))
        self.assertEqual(1, self.db.execute("SELECT count(*) FROM warehouse.ingestion_ledger WHERE event_id=%s", (event["eventId"],)).fetchone()[0])

    def test_changed_duplicate_is_rejected(self):
        event = self.event("WorkOrderCreated.v1")
        WORKER.project(self.db, event)
        event["eventPayload"]["priority"] = "Critical"
        with self.assertRaisesRegex(ValueError, "identity collision"):
            WORKER.project(self.db, event)

    def test_late_stage_started_does_not_erase_completion_or_breach(self):
        common = {"startedAtUtc": self.now.isoformat(), "deadlineUtc": (self.now + timedelta(minutes=30)).isoformat()}
        WORKER.project(self.db, self.event("StageCompleted.v1", 5, 40, {**common, "completedAtUtc": (self.now + timedelta(minutes=40)).isoformat(), "pausedSeconds": 120, "status": "Completed"}, True))
        WORKER.project(self.db, self.event("StageSLABreached.v1", 3, 30, {**common, "slaStatus": "Breached"}, True))
        WORKER.project(self.db, self.event("StageStarted.v1", 1, 0, {**common, "status": "Active"}, True))
        row = self.db.execute("SELECT status,breached,effective_minutes FROM analytics.v_stage_duration WHERE stage_instance_id=%s", (self.stage,)).fetchone()
        self.assertEqual("Completed", row[0]); self.assertTrue(row[1]); self.assertAlmostEqual(38, float(row[2]))

    def test_late_order_creation_preserves_completed_state(self):
        WORKER.project(self.db, self.event("WorkflowCompleted.v1", 9, 90, {"completedAtUtc": (self.now + timedelta(minutes=90)).isoformat()}))
        WORKER.project(self.db, self.event("WorkOrderCreated.v1", 1, 0, {"createdAtUtc": self.now.isoformat(), "number": "SYNTH-1", "serviceCategory": "HVAC", "status": "Created"}))
        row = self.db.execute("SELECT s.status,o.created_at_utc,o.completed_at_utc FROM warehouse.fact_work_order o JOIN warehouse.dim_work_order_status s USING(status_key) WHERE work_order_id=%s", (self.order,)).fetchone()
        self.assertEqual("Completed", row[0]); self.assertEqual(self.now, row[1]); self.assertEqual(self.now + timedelta(minutes=90), row[2])

    def test_analytics_staging_excludes_customer_and_answers(self):
        event = self.event("WorkOrderCreated.v1", payload={"customerName": "SYNTHETIC PRIVATE", "siteAddress": "PRIVATE", "answers": {"freeText": "PRIVATE"}, "number": "SYNTH-2"})
        WORKER.project(self.db, event)
        payload = self.db.execute("SELECT safe_payload FROM warehouse.staging_event WHERE event_id=%s", (event["eventId"],)).fetchone()[0]
        self.assertEqual("SYNTH-2", payload["number"])
        self.assertFalse({"customerName", "siteAddress", "answers"} & payload.keys())

    def test_unknown_schema_is_rejected_before_ledger_write(self):
        event = self.event("WorkOrderCreated.v1"); event["schemaVersion"] = 2
        with self.assertRaisesRegex(ValueError, "Unsupported"):
            WORKER.project(self.db, event)
        self.assertEqual(0, self.db.execute("SELECT count(*) FROM warehouse.ingestion_ledger WHERE event_id=%s", (event["eventId"],)).fetchone()[0])

    def test_booking_cancel_before_creation_remains_cancelled(self):
        booking_id = str(uuid4())
        WORKER.project(self.db, self.event("BookingCancelled.v1", 2, 2, {"id": booking_id}))
        WORKER.project(self.db, self.event("BookingCreated.v1", 1, 0, {"id": booking_id, "startUtc": self.now.isoformat(), "endUtc": (self.now + timedelta(hours=1)).isoformat()}))
        self.assertEqual("Cancelled", self.db.execute("SELECT status FROM warehouse.fact_booking WHERE booking_id=%s", (booking_id,)).fetchone()[0])

    def test_known_metric_grain_and_denominators(self):
        WORKER.project(self.db, self.event("WorkOrderCreated.v1", payload={"createdAtUtc": self.now.isoformat(), "serviceCategory": "HVAC"}))
        WORKER.project(self.db, self.event("StageCompleted.v1", 4, 40, {"startedAtUtc": self.now.isoformat(), "completedAtUtc": (self.now + timedelta(minutes=40)).isoformat(), "status": "Completed"}, True))
        WORKER.project(self.db, self.event("StageSLABreached.v1", 3, 30, {}, True))
        WORKER.project(self.db, self.event("WorkflowCompleted.v1", 8, 60))
        row = self.db.execute("SELECT total_work_orders,completed_work_orders,completion_rate,sla_compliance_rate,average_service_minutes,average_stage_minutes FROM analytics.v_team_summary WHERE team_id=%s", (self.team,)).fetchone()
        self.assertEqual((1, 1, 1.0, 0.0), row[:4]); self.assertEqual(60, float(row[4])); self.assertEqual(40, float(row[5]))


if __name__ == "__main__":
    unittest.main()
