"""Real PostgreSQL warehouse tests; run in the analytics-worker container."""

# ruff: noqa: E501
import importlib.util
import os
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import psycopg

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "warehouse_worker", ROOT / "analytics/ingestion-worker/worker.py"
)
WORKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(WORKER)


class WarehouseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dsn = os.environ["WAREHOUSE_DSN"]
        with psycopg.connect(cls.dsn) as connection:
            WORKER.migrate(connection)

    def setUp(self):
        self.db = psycopg.connect(self.dsn)
        self.order = str(uuid4())
        self.stage = str(uuid4())
        self.team = "test-" + str(uuid4())
        self.now = datetime(2026, 11, 4, 12, tzinfo=timezone.utc)

    def tearDown(self):
        self.db.rollback()
        self.db.close()

    def event(self, kind, sequence=1, minutes=0, payload=None, stage=False, source=None):
        return {
            "eventId": str(uuid4()),
            "eventType": kind,
            "eventVersion": 1,
            "workOrderId": self.order,
            "workflowId": str(uuid4()),
            "stageInstanceId": self.stage if stage else None,
            "actorId": "synthetic-supervisor",
            "actorRole": "Supervisor",
            "sourceService": source or ("workflows" if stage else "work-orders"),
            "occurredAtUtc": (self.now + timedelta(minutes=minutes)).isoformat(),
            "recordedAtUtc": (self.now + timedelta(minutes=minutes)).isoformat(),
            "sequenceNumber": sequence,
            "eventPayload": {
                "teamId": self.team,
                "technicianId": "tech-" + self.order,
                "stageIndex": 0,
                **(payload or {}),
            },
            "schemaVersion": 1,
        }

    def test_duplicate_business_event_is_idempotent(self):
        event = self.event("WorkOrderCreated.v1", payload={"createdAtUtc": self.now.isoformat()})
        self.assertTrue(WORKER.project(self.db, event))
        self.assertFalse(WORKER.project(self.db, event))
        self.assertEqual(
            1,
            self.db.execute(
                "SELECT count(*) FROM warehouse.ingestion_ledger WHERE event_id=%s",
                (event["eventId"],),
            ).fetchone()[0],
        )

    def test_changed_duplicate_is_rejected(self):
        event = self.event("WorkOrderCreated.v1")
        WORKER.project(self.db, event)
        event["eventPayload"]["priority"] = "Critical"
        with self.assertRaisesRegex(ValueError, "identity collision"):
            WORKER.project(self.db, event)

    def test_late_stage_started_does_not_erase_completion_or_breach(self):
        common = {
            "startedAtUtc": self.now.isoformat(),
            "deadlineUtc": (self.now + timedelta(minutes=30)).isoformat(),
        }
        WORKER.project(
            self.db,
            self.event(
                "StageCompleted.v1",
                5,
                40,
                {
                    **common,
                    "completedAtUtc": (self.now + timedelta(minutes=40)).isoformat(),
                    "pausedSeconds": 120,
                    "status": "Completed",
                },
                True,
            ),
        )
        WORKER.project(
            self.db,
            self.event("StageSLABreached.v1", 3, 30, {**common, "slaStatus": "Breached"}, True),
        )
        WORKER.project(
            self.db, self.event("StageStarted.v1", 1, 0, {**common, "status": "Active"}, True)
        )
        row = self.db.execute(
            "SELECT status,breached,effective_minutes FROM analytics.v_stage_duration WHERE stage_instance_id=%s",
            (self.stage,),
        ).fetchone()
        self.assertEqual("Completed", row[0])
        self.assertTrue(row[1])
        self.assertAlmostEqual(38, float(row[2]))

    def test_late_order_creation_preserves_completed_state(self):
        WORKER.project(
            self.db,
            self.event(
                "WorkflowCompleted.v1",
                9,
                90,
                {"completedAtUtc": (self.now + timedelta(minutes=90)).isoformat()},
            ),
        )
        WORKER.project(
            self.db,
            self.event(
                "WorkOrderCreated.v1",
                1,
                0,
                {
                    "createdAtUtc": self.now.isoformat(),
                    "number": "SYNTH-1",
                    "serviceCategory": "HVAC",
                    "status": "Created",
                },
            ),
        )
        row = self.db.execute(
            "SELECT s.status,o.created_at_utc,o.completed_at_utc FROM warehouse.fact_work_order o JOIN warehouse.dim_work_order_status s USING(status_key) WHERE work_order_id=%s",
            (self.order,),
        ).fetchone()
        self.assertEqual("Completed", row[0])
        self.assertEqual(self.now, row[1])
        self.assertEqual(self.now + timedelta(minutes=90), row[2])

    def test_analytics_staging_excludes_customer_and_answers(self):
        event = self.event(
            "WorkOrderCreated.v1",
            payload={
                "customerName": "SYNTHETIC PRIVATE",
                "siteAddress": "PRIVATE",
                "answers": {"freeText": "PRIVATE"},
                "number": "SYNTH-2",
            },
        )
        WORKER.project(self.db, event)
        payload = self.db.execute(
            "SELECT safe_payload FROM warehouse.staging_event WHERE event_id=%s",
            (event["eventId"],),
        ).fetchone()[0]
        self.assertEqual("SYNTH-2", payload["number"])
        self.assertFalse({"customerName", "siteAddress", "answers"} & payload.keys())

    def test_unknown_schema_is_rejected_before_ledger_write(self):
        event = self.event("WorkOrderCreated.v1")
        event["schemaVersion"] = 2
        with self.assertRaisesRegex(ValueError, "Unsupported"):
            WORKER.project(self.db, event)
        self.assertEqual(
            0,
            self.db.execute(
                "SELECT count(*) FROM warehouse.ingestion_ledger WHERE event_id=%s",
                (event["eventId"],),
            ).fetchone()[0],
        )

    def test_booking_cancel_before_creation_remains_cancelled(self):
        booking_id = str(uuid4())
        WORKER.project(
            self.db,
            self.event("BookingCancelled.v1", 2, 2, {"id": booking_id, "technicianId": None}),
        )
        WORKER.project(
            self.db,
            self.event(
                "BookingCreated.v1",
                1,
                0,
                {
                    "id": booking_id,
                    "startUtc": self.now.isoformat(),
                    "endUtc": (self.now + timedelta(hours=1)).isoformat(),
                },
            ),
        )
        row = self.db.execute(
            "SELECT status,start_utc,end_utc,technician_key,source_version FROM warehouse.fact_booking WHERE booking_id=%s",
            (booking_id,),
        ).fetchone()
        self.assertEqual("Cancelled", row[0])
        self.assertEqual(self.now, row[1])
        self.assertEqual(self.now + timedelta(hours=1), row[2])
        self.assertIsNotNone(row[3])
        self.assertEqual(2, row[4])

    def test_late_work_order_metadata_cannot_replace_newer_source_version(self):
        WORKER.project(
            self.db,
            self.event(
                "WorkOrderUpdated.v1",
                4,
                10,
                {
                    "number": "LATEST",
                    "serviceCategory": "Cooling",
                    "priority": "Critical",
                    "status": "Cancelled",
                    "createdAtUtc": self.now.isoformat(),
                },
            ),
        )
        WORKER.project(
            self.db,
            self.event(
                "WorkOrderCreated.v1",
                1,
                0,
                {
                    "number": "OLD",
                    "serviceCategory": "HVAC",
                    "priority": "Normal",
                    "status": "Created",
                    "createdAtUtc": self.now.isoformat(),
                },
            ),
        )
        row = self.db.execute(
            "SELECT o.number,c.category,o.priority,s.status,o.order_source_sequence FROM warehouse.fact_work_order o JOIN warehouse.dim_service_category c USING(category_key) JOIN warehouse.dim_work_order_status s USING(status_key) WHERE work_order_id=%s",
            (self.order,),
        ).fetchone()
        self.assertEqual(("LATEST", "Cooling", "Critical", "Cancelled", 4), row)

    def test_different_service_sequence_does_not_order_work_order_metadata(self):
        WORKER.project(
            self.db,
            self.event("StageStarted.v1", 99, 30, {"startedAtUtc": self.now.isoformat()}, True),
        )
        WORKER.project(
            self.db,
            self.event(
                "WorkOrderUpdated.v1",
                2,
                5,
                {"number": "SOURCE-2", "priority": "High", "createdAtUtc": self.now.isoformat()},
            ),
        )
        self.assertEqual(
            ("SOURCE-2", "High", 2),
            self.db.execute(
                "SELECT number,priority,order_source_sequence FROM warehouse.fact_work_order WHERE work_order_id=%s",
                (self.order,),
            ).fetchone(),
        )

    def test_booking_workflow_and_completion_lifecycle_are_projected(self):
        WORKER.project(
            self.db,
            self.event("WorkOrderCreated.v1", payload={"createdAtUtc": self.now.isoformat()}),
        )
        booking_id = str(uuid4())
        WORKER.project(
            self.db,
            self.event(
                "BookingCreated.v1",
                payload={
                    "id": booking_id,
                    "startUtc": self.now.isoformat(),
                    "endUtc": (self.now + timedelta(hours=1)).isoformat(),
                },
                source="scheduling",
            ),
        )

        def status():
            return self.db.execute(
                "SELECT s.status FROM warehouse.fact_work_order o JOIN warehouse.dim_work_order_status s USING(status_key) WHERE work_order_id=%s",
                (self.order,),
            ).fetchone()[0]

        self.assertEqual("Scheduled", status())
        WORKER.project(self.db, self.event("WorkflowStarted.v1", source="workflows"))
        self.assertEqual("InProgress", status())
        WORKER.project(
            self.db,
            self.event("WorkOrderCreated.v1", payload={"createdAtUtc": self.now.isoformat()}),
        )
        self.assertEqual("InProgress", status())
        WORKER.project(self.db, self.event("WorkflowCompleted.v1", 9, 60, source="workflows"))
        WORKER.project(
            self.db,
            self.event("BookingCancelled.v1", 2, 61, {"id": booking_id}, source="scheduling"),
        )
        self.assertEqual("Completed", status())

    def test_late_booking_metadata_cannot_overwrite_rescheduled_interval(self):
        booking_id = str(uuid4())
        WORKER.project(
            self.db,
            self.event(
                "BookingRescheduled.v1",
                3,
                1,
                {
                    "id": booking_id,
                    "startUtc": (self.now + timedelta(hours=2)).isoformat(),
                    "endUtc": (self.now + timedelta(hours=3)).isoformat(),
                },
                source="scheduling",
            ),
        )
        WORKER.project(
            self.db,
            self.event(
                "BookingCreated.v1",
                1,
                0,
                {
                    "id": booking_id,
                    "startUtc": self.now.isoformat(),
                    "endUtc": (self.now + timedelta(hours=1)).isoformat(),
                },
                source="scheduling",
            ),
        )
        self.assertEqual(
            (self.now + timedelta(hours=2), self.now + timedelta(hours=3)),
            self.db.execute(
                "SELECT start_utc,end_utc FROM warehouse.fact_booking WHERE booking_id=%s",
                (booking_id,),
            ).fetchone(),
        )

    def publish_hours(self, start=8, end=17, zone="UTC", sequence=1):
        event = self.event(
            "TechnicianAvailabilityChanged.v1",
            sequence,
            payload={"workingStartHour": start, "workingEndHour": end, "timeZone": zone},
            source="technicians",
        )
        event["workOrderId"] = "00000000-0000-0000-0000-000000000000"
        WORKER.project(self.db, event)

    def utilization(self, start, end, team=None, technician=None):
        return self.db.execute(
            "SELECT technician_id,booked_minutes,capacity_minutes,utilization FROM analytics.technician_utilization(%s,%s,%s,false,%s,NULL,NULL)",
            (start, end, team or self.team, technician or "tech-" + self.order),
        ).fetchall()

    def test_technician_working_hours_use_own_latest_sequence(self):
        self.publish_hours(6, 14, "America/New_York", 3)
        self.publish_hours(8, 17, "UTC", 1)
        row = self.db.execute(
            "SELECT working_start_hour,working_end_hour,time_zone,working_minutes_per_day,source_sequence FROM warehouse.dim_technician WHERE technician_id=%s",
            ("tech-" + self.order,),
        ).fetchone()
        self.assertEqual((6, 14, "America/New_York", 480, 3), row)

    def test_utilization_clips_bookings_and_includes_orders_created_before_range(self):
        self.publish_hours()
        WORKER.project(
            self.db,
            self.event(
                "WorkOrderCreated.v1",
                payload={"createdAtUtc": (self.now - timedelta(days=2)).isoformat()},
            ),
        )
        WORKER.project(
            self.db,
            self.event(
                "BookingCreated.v1",
                payload={
                    "id": str(uuid4()),
                    "startUtc": (self.now + timedelta(hours=1)).isoformat(),
                    "endUtc": (self.now + timedelta(hours=3)).isoformat(),
                },
                source="scheduling",
            ),
        )
        row = self.utilization(self.now + timedelta(minutes=90), self.now + timedelta(minutes=150))[
            0
        ]
        self.assertEqual((60.0, 60.0, 1.0), row[1:])

    def test_utilization_boundaries_are_half_open_and_team_scoped(self):
        self.publish_hours()
        WORKER.project(
            self.db,
            self.event(
                "BookingCreated.v1",
                payload={
                    "id": str(uuid4()),
                    "startUtc": self.now.isoformat(),
                    "endUtc": (self.now + timedelta(hours=1)).isoformat(),
                },
                source="scheduling",
            ),
        )
        row = self.utilization(self.now + timedelta(hours=1), self.now + timedelta(hours=2))[0]
        self.assertEqual((0.0, 60.0, 0.0), row[1:])
        self.assertEqual(
            [], self.utilization(self.now, self.now + timedelta(hours=1), "another-team")
        )

    def test_local_working_shift_capacity_handles_dst_and_session_timezone(self):
        self.publish_hours(0, 4, "America/New_York")
        self.db.execute("SET LOCAL TIME ZONE 'Pacific/Auckland'")
        # Nov 1, 2026 repeats one hour in New York: 00:00-04:00 is five actual hours.
        start = datetime(2026, 11, 1, 4, tzinfo=timezone.utc)
        row = self.utilization(start, start + timedelta(hours=5))[0]
        self.assertEqual(300.0, row[2])
        self.assertEqual(0.0, row[3])

    def test_unknown_timezone_or_open_range_has_no_invented_capacity(self):
        self.publish_hours(zone="Unknown/NotAZone")
        row = self.utilization(self.now, self.now + timedelta(hours=1))[0]
        self.assertIsNone(row[2])
        self.assertIsNone(row[3])
        self.publish_hours(sequence=2)
        row = self.utilization(None, self.now + timedelta(hours=1))[0]
        self.assertIsNone(row[2])
        self.assertIsNone(row[3])

    def test_missing_stage_start_is_unknown_duration_instead_of_zero(self):
        WORKER.project(
            self.db,
            self.event(
                "StageCompleted.v1",
                3,
                30,
                {"completedAtUtc": (self.now + timedelta(minutes=30)).isoformat()},
                True,
            ),
        )
        self.assertIsNone(
            self.db.execute(
                "SELECT effective_minutes FROM analytics.v_stage_duration WHERE stage_instance_id=%s",
                (self.stage,),
            ).fetchone()[0]
        )

    def test_prediction_decision_is_an_idempotent_supervisor_intervention(self):
        event = self.event(
            "RecommendationDecisionRecorded.v1", 3, 20, {"decision": "Accepted"}, True
        )
        WORKER.project(self.db, event)
        WORKER.project(self.db, event)
        self.assertEqual(
            1,
            self.db.execute(
                "SELECT count(*) FROM warehouse.fact_supervisor_intervention WHERE work_order_id=%s AND intervention_type='RecommendationDecisionRecorded.v1'",
                (self.order,),
            ).fetchone()[0],
        )

    def test_migration_ledger_prevents_repeated_backfill(self):
        WORKER.project(
            self.db,
            self.event(
                "WorkOrderUpdated.v1",
                4,
                10,
                {"number": "KEEP", "createdAtUtc": self.now.isoformat()},
            ),
        )
        migration_count = self.db.execute(
            "SELECT count(*) FROM warehouse.schema_migration"
        ).fetchone()[0]
        WORKER.migrate(self.db)
        self.assertEqual(
            ("KEEP", 4),
            self.db.execute(
                "SELECT number,order_source_sequence FROM warehouse.fact_work_order WHERE work_order_id=%s",
                (self.order,),
            ).fetchone(),
        )
        self.assertEqual(
            migration_count,
            self.db.execute("SELECT count(*) FROM warehouse.schema_migration").fetchone()[0],
        )

    def test_late_warning_cannot_downgrade_critical_server_sla_status(self):
        WORKER.project(self.db, self.event("StageCriticalWarningRaised.v1", 3, 25, {}, True))
        WORKER.project(self.db, self.event("StageWarningRaised.v1", 2, 20, {}, True))
        self.assertEqual(
            "Critical",
            self.db.execute(
                "SELECT sla_status FROM warehouse.fact_workflow_stage WHERE stage_instance_id=%s",
                (self.stage,),
            ).fetchone()[0],
        )

    def test_utc_date_bucketing_ignores_database_session_timezone(self):
        created = datetime(2026, 11, 4, 23, 30, tzinfo=timezone.utc)
        WORKER.project(
            self.db,
            self.event("WorkOrderCreated.v1", payload={"createdAtUtc": created.isoformat()}),
        )
        self.db.execute("SET LOCAL TIME ZONE 'Pacific/Auckland'")
        date = self.db.execute(
            "SELECT (created_at_utc AT TIME ZONE 'UTC')::date FROM warehouse.fact_work_order WHERE work_order_id=%s",
            (self.order,),
        ).fetchone()[0]
        self.assertEqual(created.date(), date)

    def test_known_metric_grain_and_denominators(self):
        WORKER.project(
            self.db,
            self.event(
                "WorkOrderCreated.v1",
                payload={"createdAtUtc": self.now.isoformat(), "serviceCategory": "HVAC"},
            ),
        )
        WORKER.project(
            self.db,
            self.event(
                "StageCompleted.v1",
                4,
                40,
                {
                    "startedAtUtc": self.now.isoformat(),
                    "completedAtUtc": (self.now + timedelta(minutes=40)).isoformat(),
                    "status": "Completed",
                },
                True,
            ),
        )
        WORKER.project(self.db, self.event("StageSLABreached.v1", 3, 30, {}, True))
        WORKER.project(self.db, self.event("WorkflowCompleted.v1", 8, 60))
        row = self.db.execute(
            "SELECT total_work_orders,completed_work_orders,completion_rate,sla_compliance_rate,average_service_minutes,average_stage_minutes FROM analytics.v_team_summary WHERE team_id=%s",
            (self.team,),
        ).fetchone()
        self.assertEqual((1, 1, 1.0, 0.0), row[:4])
        self.assertEqual(60, float(row[4]))
        self.assertEqual(40, float(row[5]))

    def test_completion_without_creation_metadata_cannot_inflate_cohort_rate(self):
        WORKER.project(
            self.db,
            self.event("WorkOrderCreated.v1", payload={"createdAtUtc": self.now.isoformat()}),
        )
        self.order = str(uuid4())
        WORKER.project(self.db, self.event("WorkflowCompleted.v1", 9, 60, source="workflows"))
        row = self.db.execute(
            "SELECT total_work_orders,completed_work_orders,completion_rate FROM analytics.v_team_summary WHERE team_id=%s",
            (self.team,),
        ).fetchone()
        self.assertEqual((1, 0, 0.0), row)


if __name__ == "__main__":
    unittest.main()
