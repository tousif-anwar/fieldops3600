"""Real signed-identity checks for team/technician scope and booking-first cancellation.

Requires the local Compose stack. Creates labeled synthetic records and releases
its own bookings. Uses actual Keycloak PKCE, never a role switch or auth bypass.
"""
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


class ResourceAuthorizationHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tokens = {role: AUTH.login(ROOT, role) for role in ["dispatcher", "technician", "supervisor", "analyst", "administrator"]}

    def request(self, method, path, role="dispatcher", data=None, extra_headers=None):
        headers = {"Authorization": "Bearer " + self.tokens[role]}
        if data is not None:
            headers["Content-Type"] = "application/json"
        headers.update(extra_headers or {})
        request = urllib.request.Request("http://localhost:5100" + path,
            data=json.dumps(data).encode() if data is not None else None,
            headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=25) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            with error:
                return error.code, json.load(error)

    def create_order(self, team="north", role="dispatcher"):
        status, order = self.request("POST", "/api/work-orders", role, {
            "title": "Synthetic resource authorization verification",
            "customerName": "Synthetic Customer", "siteAddress": "100 Demonstration Avenue",
            "serviceCategory": "HVAC", "priority": "Normal", "teamId": team})
        self.assertEqual(201, status, order)
        return order

    def wait(self, probe, description):
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            result = probe()
            if result:
                return result
            time.sleep(0.2)
        self.fail("Timed out waiting for " + description)

    def cancel_order(self, order_id, role="dispatcher"):
        status, order = self.request("GET", "/api/work-orders/" + order_id, role)
        self.assertEqual(200, status, order)
        if order["status"] == "Cancelled":
            return
        status, result = self.request("PUT", "/api/work-orders/" + order_id, role, {
            "expectedVersion": order["version"], "title": order["title"],
            "priority": order["priority"], "status": "Cancelled"})
        self.assertEqual(200, status, result)

    def test_supervisor_cannot_read_or_update_another_team_or_its_replay(self):
        order = self.create_order("south", "administrator")
        path = "/api/work-orders/" + order["id"]
        try:
            self.assertEqual(200, self.request("GET", path, "administrator")[0])
            self.assertEqual(404, self.request("GET", path, "supervisor")[0])
            self.assertEqual(404, self.request("GET", path, "technician")[0])
            self.assertEqual(403, self.request("GET", path, "analyst")[0])
            self.assertEqual(404, self.request("PUT", path, "supervisor", {
                "expectedVersion": order["version"], "title": order["title"],
                "priority": "Critical", "status": "Created"})[0])
            status, visible = self.request("GET", "/api/work-orders", "supervisor")
            self.assertEqual(200, status)
            self.assertNotIn(order["id"], [item["id"] for item in visible])
            self.assertEqual(404, self.request("GET", path, "supervisor", extra_headers={
                "X-Role": "Administrator", "X-User-Id": "admin-01", "X-Team-Id": "south"})[0])
            replay_path = "/api/replay/" + order["id"]
            self.wait(lambda: self.request("GET", replay_path, "administrator")[0] == 200, "administrator-visible foreign-team replay evidence")
            self.assertEqual(404, self.request("GET", replay_path, "supervisor")[0])
            self.assertEqual(403, self.request("GET", replay_path, "analyst")[0])
        finally:
            self.cancel_order(order["id"], "administrator")

    def test_other_technician_scope_and_booking_first_order_cancellation(self):
        order = self.create_order()
        booking = None
        try:
            start = (datetime.now(timezone.utc) + timedelta(days=1 + int(uuid4().hex[:4], 16) % 3650)).replace(hour=14, minute=0, second=0, microsecond=0)
            status, booking = self.request("POST", "/api/bookings", data={
                "workOrderId": order["id"], "technicianId": "tech-02", "startUtc": start.isoformat(),
                "endUtc": (start + timedelta(hours=1)).isoformat(), "overrideReason": "Synthetic authorization verification"})
            self.assertEqual(201, status, booking)
            path = "/api/work-orders/" + order["id"]
            current = self.wait(lambda: (result := self.request("GET", path))[0] == 200 and result[1]["status"] == "Scheduled" and result[1], "confirmed booking assignment projection")
            self.assertEqual(200, self.request("GET", path, "supervisor")[0])
            self.assertEqual(404, self.request("GET", path, "technician")[0])
            self.assertEqual(404, self.request("POST", "/api/workflows", "technician", {"workOrderId": order["id"]})[0])
            status, technician_bookings = self.request("GET", "/api/bookings", "technician")
            self.assertEqual(200, status)
            self.assertNotIn(booking["id"], [item["id"] for item in technician_bookings])
            status, rejection = self.request("PUT", path, data={
                "expectedVersion": current["version"], "title": current["title"],
                "priority": current["priority"], "status": "Cancelled"})
            self.assertEqual(409, status, rejection)
            self.assertIn("booking first", rejection["detail"])
            status, cancelled_booking = self.request("POST", "/api/bookings/" + booking["id"] + "/cancel", data={
                "expectedVersion": booking["version"], "reason": "Synthetic verification complete"})
            self.assertEqual(200, status, cancelled_booking)
            booking = None
            self.wait(lambda: (result := self.request("GET", path))[0] == 200 and result[1]["status"] == "Created", "released booking projection")
        finally:
            if booking and "id" in booking:
                self.request("POST", "/api/bookings/" + booking["id"] + "/cancel", data={
                    "expectedVersion": booking["version"], "reason": "Synthetic verification cleanup"})
                self.wait(lambda: self.request("GET", "/api/work-orders/" + order["id"])[1]["status"] in ["Created", "Cancelled"], "cleanup booking release")
            self.cancel_order(order["id"])


if __name__ == "__main__":
    unittest.main()
