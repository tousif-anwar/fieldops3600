"""Real PKCE customer intake -> qualification -> offer -> service report verification.

Run scripts/seed-customer-portal.py first. Uses synthetic data and the local stack.
Completed evidence is intentionally retained; pending test requests are rejected.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
import time
import unittest
import urllib.error
import urllib.request
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("local_auth", ROOT / "scripts/local-auth.py")
AUTH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUTH)


class CustomerLifecycleHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tokens = {name: AUTH.login(ROOT, name) for name in ["customer", "customer-other", "dispatcher", "technician", "supervisor"]}

    def call(self, method, path, role="customer", data=None, headers=None):
        auth = {"Authorization": "Bearer " + self.tokens[role]} | (headers or {})
        if data is not None:
            auth["Content-Type"] = "application/json"
        request = urllib.request.Request("http://localhost:5100" + path, method=method, headers=auth,
            data=json.dumps(data).encode() if data is not None else None)
        try:
            with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=30) as response:
                body = response.read()
                return response.status, json.loads(body) if body else None
        except urllib.error.HTTPError as error:
            with error:
                body = error.read()
                return error.code, json.loads(body) if body else None

    def wait(self, probe, description):
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            value = probe()
            if value:
                return value
            time.sleep(0.25)
        self.fail("Timed out waiting for " + description)

    def command(self):
        status, account = self.call("GET", "/api/customer-portal/account")
        self.assertEqual(200, status, account)
        return {"serviceLocationId": next(x["id"] for x in account["locations"] if x["status"] == "Active"), "assetId": None,
            "title": "Synthetic portal lifecycle verification", "description": "The synthetic air handler requires a diagnostic inspection.",
            "serviceType": "Diagnostic", "urgency": "Urgent", "idempotencyKey": str(uuid4())}

    def test_customer_isolation_role_boundaries_and_validation(self):
        status, primary = self.call("GET", "/api/customer-portal/account")
        self.assertEqual(200, status, primary)
        status, other = self.call("GET", "/api/customer-portal/account", "customer-other")
        self.assertEqual(200, status, other)
        self.assertNotEqual(primary["id"], other["id"])
        self.assertNotIn("contacts", primary)
        self.assertTrue(all("accessNotes" not in x for x in primary["locations"]))
        for path in ["/api/work-orders", "/api/customers", "/api/bookings", "/api/assignment-offers", "/api/reports/summary"]:
            self.assertEqual(403, self.call("GET", path, headers={"X-Role": "Administrator", "X-Customer-Id": other["id"]})[0], path)
        self.assertEqual(403, self.call("GET", "/api/customer-portal/account", "technician")[0])
        self.assertEqual(403, self.call("GET", "/api/service-requests", "technician")[0])
        command = self.command()
        self.assertEqual(404, self.call("POST", "/api/service-requests", data=command | {"serviceLocationId": other["locations"][0]["id"]})[0])
        self.assertEqual(404, self.call("POST", "/api/service-requests", data=command | {"assetId": str(uuid4())})[0])
        self.assertEqual(400, self.call("POST", "/api/service-requests", data=command | {"urgency": "Invented"})[0])

    def test_concurrent_qualification_creates_one_work_order(self):
        status, request = self.call("POST", "/api/service-requests", data=self.command())
        self.assertEqual(201, status, request)
        path = "/api/service-requests/" + request["id"] + "/qualify"
        command = {"expectedVersion": 1, "decision": "Approve", "reason": "Synthetic diagnostic scope accepted for dispatch review.", "serviceCategory": "HVAC", "priority": "High"}
        self.assertEqual(403, self.call("POST", path, data=command)[0])
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(lambda _: self.call("POST", path, "dispatcher", command), range(2)))
        self.assertEqual([200, 409], sorted(x[0] for x in outcomes), outcomes)
        order_id = next(body["workOrderId"] for status, body in outcomes if status == 200)
        status, orders = self.call("GET", "/api/customer-portal/work-orders")
        self.assertEqual(200, status, orders)
        self.assertEqual(1, sum(x["id"] == order_id for x in orders))
        self.assertEqual(404, self.call("GET", "/api/customer-portal/work-orders/" + order_id, "customer-other")[0])
        status, order = self.call("GET", "/api/work-orders/" + order_id, "dispatcher")
        self.assertEqual(200, status, order)
        self.assertEqual(200, self.call("PUT", "/api/work-orders/" + order_id, "dispatcher", {"expectedVersion": order["version"], "title": order["title"], "priority": order["priority"], "status": "Cancelled"})[0])

    def test_request_offer_guided_service_report_and_customer_visibility(self):
        command = self.command()
        status, request = self.call("POST", "/api/service-requests", data=command)
        self.assertEqual(201, status, request)
        status, duplicate = self.call("POST", "/api/service-requests", data=command)
        self.assertEqual(201, status, duplicate); self.assertEqual(request["id"], duplicate["id"])
        self.assertEqual(409, self.call("POST", "/api/service-requests", data=command | {"title": "Different operation payload"})[0])
        self.assertEqual(404, self.call("GET", "/api/service-requests/" + request["id"], "customer-other")[0])
        status, qualified = self.call("POST", "/api/service-requests/" + request["id"] + "/qualify", "dispatcher",
            {"expectedVersion": 1, "decision": "Approve", "reason": "Synthetic diagnostic appointment qualifies for HVAC service.", "serviceCategory": "HVAC", "priority": "High"})
        self.assertEqual(200, status, qualified)
        order_id = qualified["workOrderId"]
        self.assertEqual("Qualified", qualified["status"])
        status, appointments = self.call("GET", "/api/customer-portal/appointments")
        self.assertEqual(200, status, appointments)
        self.assertFalse(any(x["workOrderId"] == order_id and x["status"] == "Confirmed" for x in appointments))
        start = (datetime.now(timezone.utc) + timedelta(days=500 + int(uuid4().hex[:5], 16) % 7000)).replace(hour=14, minute=0, second=0, microsecond=0)
        status, offer = self.call("POST", "/api/assignment-offers", "dispatcher", {"workOrderId": order_id, "technicianId": "tech-01", "startUtc": start.isoformat(), "endUtc": (start + timedelta(hours=1)).isoformat(), "expiresAtUtc": (datetime.now(timezone.utc) + timedelta(minutes=20)).isoformat(), "idempotencyKey": str(uuid4())})
        self.assertEqual(201, status, offer)
        status, accepted = self.call("POST", "/api/assignment-offers/" + offer["id"] + "/accept", "technician", {"expectedVersion": offer["version"], "idempotencyKey": str(uuid4())})
        self.assertEqual(200, status, accepted); self.assertEqual("Accepted", accepted["status"])
        self.wait(lambda: (result := self.call("GET", "/api/work-orders/" + order_id, "technician"))[0] == 200 and result[1]["technicianId"] == "tech-01", "technician assignment projection")
        status, workflow = self.call("POST", "/api/workflows", "technician", {"workOrderId": order_id})
        self.assertIn(status, [200, 201], workflow); self.assertEqual(2, workflow["templateVersion"])
        status, appointments = self.call("GET", "/api/customer-portal/appointments")
        self.assertEqual(200, status, appointments)
        booking = next(x for x in appointments if x["workOrderId"] == order_id and x["status"] == "Confirmed")
        self.assertNotIn("technicianId", booking)
        self.assertEqual(409, self.call("POST", "/api/bookings/" + booking["id"] + "/cancel", "dispatcher", {"expectedVersion": booking["version"], "reason": "Must not cancel active service"})[0])
        self.assertEqual(409, self.call("PUT", "/api/bookings/" + booking["id"], "dispatcher", {"expectedVersion": booking["version"], "startUtc": (start + timedelta(hours=1)).isoformat(), "endUtc": (start + timedelta(hours=2)).isoformat(), "reason": "Must not reschedule active service"})[0])
        self.assertEqual(409, self.call("GET", "/api/workflows/service-report/" + order_id)[0])
        status, template = self.call("GET", "/api/workflows/templates/2", "technician")
        self.assertEqual(200, status, template)
        for index in range(8):
            answers = {}
            for field in template["stages"][index]["fields"]:
                if not field.get("conditionField") or answers.get(field["conditionField"]) == field.get("conditionValue"):
                    answers[field["key"]] = "45.5" if field.get("inputType") == "number" else "Synthetic technician service findings and recommendations." if field.get("inputType") == "text" else field["options"][0]
            payload = {"expectedVersion": workflow["version"], "idempotencyKey": str(uuid4()), "answers": answers, "offline": index == 3, "clientOccurredAtUtc": datetime.now(timezone.utc).isoformat()}
            path = "/api/workflows/" + workflow["id"] + "/submit"
            if index in [0, 1, 4]:
                key, value = {0: ("readiness", "Missing Equipment"), 1: ("travelStatus", "Departed"), 4: ("partsStatus", "Ordered")}[index]
                self.assertEqual(409, self.call("POST", path, "technician", payload | {"answers": answers | {key: value}})[0])
            status, workflow = self.call("POST", path, "technician", payload)
            self.assertEqual(200, status, workflow)
            status, duplicate = self.call("POST", path, "technician", payload)
            self.assertEqual(200, status, duplicate); self.assertEqual(workflow["version"], duplicate["version"])
        self.assertEqual("Completed", workflow["status"])
        status, report = self.call("GET", "/api/workflows/service-report/" + order_id)
        self.assertEqual(200, status, report); self.assertEqual(8, len(report["sections"]))
        self.assertTrue(any(x["label"] == "Labor minutes" and x["value"] == "45.5" for x in report["sections"][4]["responses"]))
        self.assertEqual(404, self.call("GET", "/api/workflows/service-report/" + order_id, "customer-other")[0])
        self.wait(lambda: (result := self.call("GET", "/api/customer-portal/work-orders/" + order_id))[0] == 200 and result[1]["status"] == "Completed", "customer completion status")
        events = self.wait(lambda: (result := self.call("GET", "/api/replay/" + order_id, "supervisor"))[0] == 200 and any(x["eventType"] == "WorkflowCompleted.v1" for x in result[1]["events"]) and result[1]["events"], "retained service evidence")
        self.assertTrue(any(x["eventType"] == "OfflineSubmissionSynchronized.v1" for x in events))
        self.assertEqual(len(events), len({x["eventId"] for x in events}))


if __name__ == "__main__":
    unittest.main()
