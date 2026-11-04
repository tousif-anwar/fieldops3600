"""Live local integration: real Keycloak PKCE + gateway + six service databases + RabbitMQ.

Requires `docker compose up -d --build`. Creates labeled synthetic records, never production data.
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
BASE = "http://localhost:5100"


class LiveIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tokens = {role: AUTH.login(ROOT, role) for role in ["dispatcher", "technician", "supervisor", "analyst", "administrator"]}

    @classmethod
    def request(cls, method, path, role="dispatcher", data=None):
        headers = {"Authorization": "Bearer " + cls.tokens[role]}
        if data is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(BASE + path, data=json.dumps(data).encode() if data is not None else None, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                body = response.read()
                return response.status, json.loads(body) if "json" in response.headers.get("Content-Type", "") else body
        except urllib.error.HTTPError as error:
            with error:
                body = error.read()
                return error.code, json.loads(body) if "json" in error.headers.get("Content-Type", "") else body

    def create(self, title="Synthetic integration HVAC inspection"):
        status, order = self.request("POST", "/api/work-orders", data={"title": title, "customerName": "Synthetic Customer", "siteAddress": "100 Demonstration Avenue", "serviceCategory": "HVAC", "priority": "High", "teamId": "north"})
        self.assertEqual(201, status, order)
        return order

    def wait_for(self, predicate, description, timeout=20):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            result = predicate()
            if result:
                return result
            time.sleep(0.25)
        self.fail("Timed out waiting for " + description)

    def test_signed_identity_and_role_boundaries(self):
        status, identity = self.request("GET", "/api/session")
        self.assertEqual(200, status); self.assertEqual("dispatcher-01", identity["id"])
        for role in ["technician", "analyst"]:
            status, _ = self.request("POST", "/api/work-orders", role, {"title": "Unauthorized synthetic", "customerName": "Synthetic", "siteAddress": "Synthetic", "serviceCategory": "HVAC", "priority": "Normal", "teamId": "north"})
            self.assertEqual(403, status)
        status, _ = self.request("GET", "/api/reports/summary", "technician")
        self.assertEqual(403, status)

    def test_unassigned_technician_cannot_read_work_order(self):
        order = self.create()
        status, _ = self.request("GET", "/api/work-orders/" + order["id"], "technician")
        self.assertEqual(404, status)
        status, orders = self.request("GET", "/api/work-orders", "technician")
        self.assertEqual(200, status); self.assertNotIn(order["id"], [item["id"] for item in orders])

    def test_complete_pipeline_concurrency_replay_and_warehouse(self):
        order = self.create()
        tomorrow = datetime.now(timezone.utc) + timedelta(days=1)
        # Unique far-future day avoids colliding with a prior demonstration run; 14:00 UTC is inside New York working hours.
        start = tomorrow.replace(hour=14, minute=0, second=0, microsecond=0) + timedelta(days=int(uuid4().hex[:4], 16) % 10000)
        end = start + timedelta(hours=1)
        body = {"workOrderId": order["id"], "technicianId": "tech-01", "startUtc": start.isoformat(), "endUtc": end.isoformat(), "overrideReason": None}
        status, recommendations = self.request("POST", "/api/scheduling/recommendations", data={"workOrderId": order["id"], "startUtc": start.isoformat(), "durationMinutes": 60})
        self.assertEqual(200, status, recommendations); self.assertTrue(any(row["explanation"] for row in recommendations))
        status, booking = self.request("POST", "/api/bookings", data=body)
        self.assertEqual(201, status, booking)
        competing = self.create("Synthetic concurrent booking attempt")
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(lambda _: self.request("POST", "/api/bookings", data=body | {"workOrderId": competing["id"]}), range(2)))
        self.assertEqual([409, 409], sorted(row[0] for row in responses))
        self.wait_for(lambda: (result := self.request("GET", "/api/work-orders/" + order["id"], "technician"))[0] == 200 and result[1], "assignment projection")
        status, workflow = self.request("POST", "/api/workflows", "technician", {"workOrderId": order["id"]})
        self.assertIn(status, [200, 201], workflow)
        workflow_id = workflow["id"]
        status, template = self.request("GET", "/api/workflows/templates/default", "technician")
        self.assertEqual(200, status); self.assertEqual(8, len(template["stages"]))
        status, _ = self.request("POST", f"/api/workflows/{workflow_id}/pause", "technician", {"expectedVersion": workflow["version"], "reason": "Unauthorized pause"})
        self.assertEqual(403, status)
        status, workflow = self.request("POST", f"/api/workflows/{workflow_id}/pause", "supervisor", {"expectedVersion": workflow["version"], "reason": "Synthetic safety review"})
        self.assertEqual(200, status, workflow)
        status, workflow = self.request("POST", f"/api/workflows/{workflow_id}/resume", "supervisor", {"expectedVersion": workflow["version"], "reason": "Synthetic review completed"})
        self.assertEqual(200, status, workflow)
        for stage_index in range(8):
            answers = {}
            for field in template["stages"][stage_index]["fields"]:
                if not field.get("conditionField") or answers.get(field["conditionField"]) == field.get("conditionValue"):
                    answers[field["key"]] = field["options"][0]
            submission = {"expectedVersion": workflow["version"], "idempotencyKey": str(uuid4()), "answers": answers, "clientOccurredAtUtc": datetime.now(timezone.utc).isoformat(), "offline": stage_index == 2}
            if stage_index == 0:
                status, _ = self.request("POST", f"/api/workflows/{workflow_id}/submit", "technician", submission | {"answers": {"assignment": "Invented option", "readiness": "Ready"}})
                self.assertEqual(400, status)
            status, updated = self.request("POST", f"/api/workflows/{workflow_id}/submit", "technician", submission)
            self.assertEqual(200, status, updated)
            duplicate_status, duplicate = self.request("POST", f"/api/workflows/{workflow_id}/submit", "technician", submission)
            self.assertEqual(200, duplicate_status); self.assertEqual(updated["version"], duplicate["version"])
            workflow = updated
        self.assertEqual("Completed", workflow["status"])
        replay_path = "/api/replay/" + order["id"]
        self.assertEqual(403, self.request("GET", replay_path, "technician")[0])
        replay = self.wait_for(lambda: (result := self.request("GET", replay_path, "supervisor"))[0] == 200 and any(e["eventType"] == "WorkflowCompleted.v1" for e in result[1]["events"]) and result[1], "immutable replay consumer")
        events = replay["events"]
        self.assertEqual(len(events), len({e["eventId"] for e in events}))
        self.assertTrue(all(e["integrityVerified"] for e in events))
        self.assertTrue(any(e["eventType"] == "OfflineSubmissionSynchronized.v1" for e in events))
        self.assertTrue(any(e["traceId"] for e in events))
        self.assertEqual("Completed", replay["state"]["status"])
        for export in ["export.csv", "export.pdf"]:
            status, body = self.request("GET", replay_path + "/" + export, "supervisor")
            self.assertEqual(200, status)
            self.assertTrue(body.startswith(b"%PDF") if export.endswith("pdf") else b"EventId" in body)
        summary = self.wait_for(lambda: (result := self.request("GET", "/api/reports/summary", "analyst"))[0] == 200 and result[1].get("completedWorkOrders", 0) >= 1 and result[1], "warehouse completion projection")
        self.assertIn("warehouse", summary["dataSource"].lower())


if __name__ == "__main__":
    unittest.main()
