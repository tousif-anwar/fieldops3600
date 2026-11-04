"""Exercise the real authenticated Scheduling -> OR-Tools HTTP adapter locally.

Creates one labeled synthetic, unbooked work order and cancels it after evaluation.
Tokens stay in memory and are never printed or persisted.
"""
from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
import unittest
import urllib.error
import urllib.request
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("local_auth", ROOT / "scripts/local-auth.py")
AUTH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUTH)


class OptimizerHttpContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.token = AUTH.login(ROOT, "dispatcher")

    def request(self, method, path, data):
        request = urllib.request.Request(
            "http://localhost:5100" + path,
            data=json.dumps(data).encode(),
            headers={"Authorization": "Bearer " + self.token, "Content-Type": "application/json"},
            method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=25) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            with error:
                return error.code, json.load(error)

    def test_real_optimizer_selected_assignment_and_validation(self):
        title = "Synthetic optimizer HTTP contract verification"
        status, order = self.request("POST", "/api/work-orders", {
            "title": title, "customerName": "Synthetic Customer",
            "siteAddress": "100 Demonstration Avenue", "serviceCategory": "HVAC",
            "priority": "High", "teamId": "north",
        })
        self.assertEqual(201, status, order)
        try:
            start = (datetime.now(timezone.utc) + timedelta(days=1 + int(uuid4().hex[:4], 16) % 3650)).replace(hour=14, minute=0, second=0, microsecond=0)
            body = {"workOrderId": order["id"], "startUtc": start.isoformat(), "durationMinutes": 60}
            status, baseline = self.request("POST", "/api/scheduling/recommendations", body | {"strategy": "baseline"})
            self.assertEqual(200, status, baseline)
            self.assertGreater(len(baseline), 0)
            self.assertTrue(all(row["strategy"] == "baseline" for row in baseline))
            status, optimized = self.request("POST", "/api/scheduling/recommendations", body | {"strategy": "optimized"})
            self.assertEqual(200, status, optimized)
            self.assertEqual(1, len(optimized))
            assignment = optimized[0]
            self.assertEqual("optimized", assignment["strategy"])
            self.assertIn(assignment["solverStatus"], ["OPTIMAL", "FEASIBLE"])
            self.assertGreaterEqual(assignment["runtimeMilliseconds"], 0)
            self.assertIsNone(assignment["estimatedTravelMinutes"])
            self.assertIn(assignment["technicianId"], [row["technicianId"] for row in baseline])
            self.assertTrue(any("OR-Tools" in line for line in assignment["explanation"]))
            self.assertTrue(any("Travel unavailable" in line for line in assignment["explanation"]))
            self.assertEqual(400, self.request("POST", "/api/scheduling/recommendations", body | {"strategy": "invented"})[0])
            self.assertEqual(400, self.request("POST", "/api/scheduling/recommendations", body | {"strategy": "optimized", "startUtc": (start + timedelta(seconds=1)).isoformat()})[0])
        finally:
            status, result = self.request("PUT", "/api/work-orders/" + order["id"], {
                "expectedVersion": order["version"], "title": title,
                "priority": "High", "status": "Cancelled",
            })
            self.assertEqual(200, status, result)


if __name__ == "__main__":
    unittest.main()
