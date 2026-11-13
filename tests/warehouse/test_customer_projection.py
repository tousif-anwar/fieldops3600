"""Customer pipeline assertions against real PostgreSQL, isolated by rollback."""
import importlib.util
import os
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import psycopg

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "analytics/ingestion-worker"))
SPEC = importlib.util.spec_from_file_location("customer_warehouse_worker", ROOT / "analytics/ingestion-worker/worker.py")
WORKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(WORKER)


class CustomerProjectionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dsn = os.environ["WAREHOUSE_DSN"]
        with psycopg.connect(cls.dsn) as connection:
            WORKER.migrate(connection)

    def setUp(self):
        self.db = psycopg.connect(self.dsn)
        self.customer = str(uuid4())
        self.location = str(uuid4())
        self.team = "customer-test-" + str(uuid4())
        self.now = datetime(2026, 11, 5, 12, tzinfo=timezone.utc).isoformat()

    def tearDown(self):
        self.db.rollback()
        self.db.close()

    def event(self, version=1, status="Active"):
        return {"eventId": str(uuid4()), "eventType": "CustomerRegistered.v1" if version == 1 else "CustomerUpdated.v1", "sourceService": "customers", "workOrderId": "00000000-0000-0000-0000-000000000000", "occurredAtUtc": self.now, "schemaVersion": 1, "sequenceNumber": version, "eventPayload": {"customerId": self.customer, "teamId": self.team, "customerType": "Commercial", "status": status, "preferredChannel": "Email", "version": version, "createdAtUtc": self.now, "updatedAtUtc": self.now, "contactCount": 1, "locationCount": 1, "activeLocationCount": 1, "emailConsentCount": 1, "phoneConsentCount": 0, "locations": [{"serviceLocationId": self.location, "status": "Active"}]}}

    def test_registry_revisions_do_not_create_work_orders(self):
        event = self.event()
        self.assertTrue(WORKER.project(self.db, event))
        self.assertFalse(WORKER.project(self.db, event))
        self.assertEqual(0, self.db.execute("SELECT count(*) FROM warehouse.fact_work_order WHERE team_id=%s", (self.team,)).fetchone()[0])
        self.assertEqual((1, 1), self.db.execute("SELECT customer_count,active_location_count FROM analytics.v_customer_registry WHERE team_id=%s", (self.team,)).fetchone())

    def test_late_old_revision_preserves_current_and_historical_attributes(self):
        WORKER.project(self.db, self.event(2, "Archived"))
        WORKER.project(self.db, self.event(1))
        self.assertEqual((2, "Archived"), self.db.execute("SELECT source_version,status FROM warehouse.dim_customer WHERE customer_reference=%s", (self.customer,)).fetchone())
        self.assertEqual([(1, "Active"), (2, "Archived")], self.db.execute("SELECT v.source_version,v.status FROM warehouse.dim_customer_version v JOIN warehouse.dim_customer c USING(customer_key) WHERE c.customer_reference=%s ORDER BY v.source_version", (self.customer,)).fetchall())

    def test_same_revision_with_new_delivery_identity_does_not_double_count(self):
        WORKER.project(self.db, self.event())
        WORKER.project(self.db, self.event())
        self.assertEqual(1, self.db.execute("SELECT count(*) FROM warehouse.fact_customer_change f JOIN warehouse.dim_customer c USING(customer_key) WHERE customer_reference=%s", (self.customer,)).fetchone()[0])

    def test_conflicting_revision_is_rejected(self):
        WORKER.project(self.db, self.event())
        event = self.event()
        event["eventPayload"]["status"] = "Archived"
        with self.assertRaisesRegex(ValueError, "version collision"):
            WORKER.project(self.db, event)

    def test_customer_pii_is_not_retained_in_staging_or_dimensions(self):
        event = self.event()
        event["eventPayload"].update(displayName="PRIVATE_SENTINEL", email="PRIVATE_SENTINEL", addressLine1="PRIVATE_SENTINEL", accessNotes="PRIVATE_SENTINEL", contacts=[{"fullName": "PRIVATE_SENTINEL"}])
        WORKER.project(self.db, event)
        staged = str(self.db.execute("SELECT safe_payload FROM warehouse.staging_event WHERE event_id=%s", (event["eventId"],)).fetchone()[0])
        self.assertNotIn("PRIVATE_SENTINEL", staged)
        dimension = str(self.db.execute("SELECT row_to_json(c) FROM warehouse.dim_customer c WHERE customer_reference=%s", (self.customer,)).fetchone()[0])
        self.assertNotIn("PRIVATE_SENTINEL", dimension)

    def test_order_before_registry_event_keeps_stable_version_key(self):
        order = str(uuid4())
        event = {**self.event(), "eventId": str(uuid4()), "eventType": "WorkOrderCreated.v1", "sourceService": "work-orders", "workOrderId": order, "eventPayload": {"teamId": self.team, "customerId": self.customer, "customerVersion": 1, "serviceLocationId": self.location, "createdAtUtc": self.now, "status": "Created", "priority": "Normal", "serviceCategory": "HVAC"}}
        WORKER.project(self.db, event)
        before = self.db.execute("SELECT o.customer_version_key,v.inferred FROM warehouse.fact_work_order o JOIN warehouse.dim_customer_version v USING(customer_version_key) WHERE work_order_id=%s", (order,)).fetchone()
        self.assertTrue(before[1])
        WORKER.project(self.db, self.event())
        after = self.db.execute("SELECT o.customer_version_key,v.inferred FROM warehouse.fact_work_order o JOIN warehouse.dim_customer_version v USING(customer_version_key) WHERE work_order_id=%s", (order,)).fetchone()
        self.assertEqual(before[0], after[0])
        self.assertFalse(after[1])

    def test_location_ownership_cannot_change(self):
        WORKER.project(self.db, self.event())
        self.customer = str(uuid4())
        with self.assertRaisesRegex(ValueError, "location ownership"):
            WORKER.project(self.db, self.event())

    def test_location_count_mismatch_is_rejected(self):
        event = self.event()
        event["eventPayload"]["locationCount"] = 2
        with self.assertRaisesRegex(ValueError, "location count"):
            WORKER.project(self.db, event)


if __name__ == "__main__":
    unittest.main(verbosity=2)
