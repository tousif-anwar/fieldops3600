"""Real signed-identity races for scheduling cancellation and service execution.

Unstarted synthetic records are cancelled. If service start wins, its workflow is
completed through the ordinary API and retained as labeled service evidence.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("offer_http", ROOT / "tests/backend/verify_assignment_offers_http.py")
OFFER_HTTP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(OFFER_HTTP)


class SchedulingRacesHttpTests(unittest.TestCase):
    request = OFFER_HTTP.AssignmentOffersHttpTests.request
    offer_request = OFFER_HTTP.AssignmentOffersHttpTests.offer_request
    order = OFFER_HTTP.AssignmentOffersHttpTests.order
    wait = OFFER_HTTP.AssignmentOffersHttpTests.wait

    @classmethod
    def setUpClass(cls):
        cls.tokens = {role: OFFER_HTTP.AUTH.login(ROOT, role) for role in ["dispatcher", "technician", "supervisor"]}

    def setUp(self):
        self.completed_orders = set()

    def cleanup_order(self, order_id):
        if order_id not in self.completed_orders:
            OFFER_HTTP.AssignmentOffersHttpTests.cleanup_order(self, order_id)

    def test_pending_offer_keeps_deployed_warehouse_unassigned(self):
        order = self.order()
        status, offer = self.request("POST", "/api/assignment-offers", data=self.offer_request(order))
        self.assertEqual(201, status, offer)
        # Read through the deployed worker's existing database identity. No tokens,
        # credentials, synthetic metrics, or direct database writes are involved.
        probe = """
import json, os, sys
import psycopg
with psycopg.connect(os.environ['WAREHOUSE_DSN']) as connection:
    row = connection.execute('''SELECT o.technician_key,
      (SELECT count(*) FROM warehouse.fact_booking b WHERE b.work_order_id=o.work_order_id),
      (SELECT count(*) FROM warehouse.staging_event s JOIN warehouse.ingestion_ledger l USING(event_id)
       WHERE s.work_order_id=o.work_order_id AND l.event_type='AssignmentOfferCreated.v1'), st.status
      FROM warehouse.fact_work_order o LEFT JOIN warehouse.dim_work_order_status st USING(status_key)
      WHERE o.work_order_id=%s AND o.created_at_utc IS NOT NULL''', (sys.argv[1],)).fetchone()
    print(json.dumps(row))
"""
        def warehouse_row():
            result = subprocess.run(["docker", "exec", "fieldops360-analytics-worker-1", "python", "-c", probe, order["id"]],
                check=True, capture_output=True, text=True, timeout=15)
            row = json.loads(result.stdout)
            return row if row and row[2] > 0 else None
        row = self.wait(warehouse_row, "offer evidence in deployed warehouse")
        self.assertEqual([None, 0, 1, "Created"], row)

    def test_cancellation_intent_and_booking_cannot_both_win(self):
        order = self.order()
        window = self.offer_request(order)
        allocation = {key: window[key] for key in ["workOrderId", "technicianId", "startUtc", "endUtc"]}
        intent_path = "/api/scheduling/work-orders/" + order["id"] + "/cancel-intent"
        with ThreadPoolExecutor(max_workers=2) as pool:
            intent_future = pool.submit(self.request, "POST", intent_path, "dispatcher", {})
            booking_future = pool.submit(self.request, "POST", "/api/bookings", "dispatcher", allocation)
            intent, booking = intent_future.result(), booking_future.result()
        self.assertIn((intent[0], booking[0]), [(200, 409), (409, 201)], (intent, booking))
        if intent[0] == 200:
            self.assertEqual(200, self.request("POST", intent_path, data={})[0])
            self.assertEqual(409, self.request("POST", "/api/bookings", data=allocation)[0])
            self.assertEqual(409, self.request("POST", "/api/assignment-offers", data=window)[0])
            self.assertEqual([], self.request("GET", "/api/bookings?workOrderId=" + order["id"])[1])
        else:
            self.assertEqual(409, self.request("POST", intent_path, data={})[0])
            self.assertEqual(1, len([x for x in self.request("GET", "/api/bookings?workOrderId=" + order["id"])[1] if x["status"] == "Confirmed"]))
            self.wait(lambda: self.request("GET", "/api/work-orders/" + order["id"])[1]["status"] == "Scheduled", "winning allocation projection")

    def test_service_claim_and_cancellation_cannot_both_win(self):
        order = self.order()
        window = self.offer_request(order)
        allocation = {key: window[key] for key in ["workOrderId", "technicianId", "startUtc", "endUtc"]}
        status, booking = self.request("POST", "/api/bookings", data=allocation)
        self.assertEqual(201, status, booking)
        self.wait(lambda: self.request("GET", "/api/work-orders/" + order["id"])[1]["status"] == "Scheduled", "confirmed appointment projection")
        claim_path = "/api/bookings/" + booking["id"] + "/begin-service"
        with ThreadPoolExecutor(max_workers=2) as pool:
            claim_future = pool.submit(self.request, "POST", claim_path, "technician", {})
            cancel_future = pool.submit(self.request, "POST", "/api/bookings/" + booking["id"] + "/cancel", "dispatcher", {
                "expectedVersion": booking["version"], "reason": "Synthetic concurrent cancellation verification"})
            claim, cancellation = claim_future.result(), cancel_future.result()
        self.assertIn((claim[0], cancellation[0]), [(200, 409), (409, 200)], (claim, cancellation))
        if claim[0] == 200:
            self.assertIsNotNone(claim[1]["serviceStartedAtUtc"])
            status, repeated = self.request("POST", claim_path, "technician", {})
            self.assertEqual(200, status, repeated)
            self.assertEqual(claim[1]["serviceStartedAtUtc"], repeated["serviceStartedAtUtc"])
            self.assertEqual(claim[1]["version"], repeated["version"])
            self.assertEqual(409, self.request("POST", "/api/bookings/" + booking["id"] + "/cancel", data={
                "expectedVersion": repeated["version"], "reason": "Claim must prevent cancellation"})[0])
            self.assertEqual(409, self.request("PUT", "/api/bookings/" + booking["id"], data={
                "expectedVersion": repeated["version"], "startUtc": (datetime.fromisoformat(booking["startUtc"]) + timedelta(days=1)).isoformat(),
                "endUtc": (datetime.fromisoformat(booking["endUtc"]) + timedelta(days=1)).isoformat(), "reason": "Claim must prevent rescheduling"})[0])
            self.complete_service(order["id"])
            events = self.wait(lambda: (result := self.request("GET", "/api/replay/" + order["id"], "supervisor"))[0] == 200 and
                any(x["eventType"] == "WorkflowCompleted.v1" for x in result[1]["events"]) and result[1]["events"], "completed service audit")
            self.assertEqual(1, sum(x["eventType"] == "BookingServiceStarted.v1" for x in events))
        else:
            self.assertEqual(409, self.request("POST", claim_path, "technician", {})[0])

    def complete_service(self, order_id):
        status, workflow = self.request("POST", "/api/workflows", "technician", {"workOrderId": order_id})
        self.assertIn(status, [200, 201], workflow)
        status, template = self.request("GET", "/api/workflows/templates/" + str(workflow["templateVersion"]), "technician")
        self.assertEqual(200, status, template)
        for stage in template["stages"]:
            answers = {}
            for field in stage["fields"]:
                if not field.get("conditionField") or answers.get(field["conditionField"]) == field.get("conditionValue"):
                    answers[field["key"]] = "30" if field.get("inputType") == "number" else "Synthetic scheduling race verification service findings." if field.get("inputType") == "text" else field["options"][0]
            status, workflow = self.request("POST", "/api/workflows/" + workflow["id"] + "/submit", "technician", {
                "expectedVersion": workflow["version"], "idempotencyKey": str(uuid4()), "answers": answers,
                "clientOccurredAtUtc": datetime.now(timezone.utc).isoformat(), "offline": False})
            self.assertEqual(200, status, workflow)
        self.assertEqual("Completed", workflow["status"])
        self.completed_orders.add(order_id)
        self.wait(lambda: self.request("GET", "/api/work-orders/" + order_id)[1]["status"] == "Completed", "completed synthetic order projection")


if __name__ == "__main__":
    unittest.main()
