"""Signed-identity HTTP verification of offers against the actual local Compose stack.

Creates labeled synthetic operational records, never bypasses authentication, and
releases its appointments. Run after rebuilding/migrating scheduling and work-orders.
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


class AssignmentOffersHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tokens = {role: AUTH.login(ROOT, role) for role in ["dispatcher", "technician", "supervisor", "analyst"]}

    def request(self, method, path, role="dispatcher", data=None):
        headers = {"Authorization": "Bearer " + self.tokens[role]}
        if data is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request("http://localhost:5100" + path,
            data=json.dumps(data).encode() if data is not None else None, headers=headers, method=method)
        try:
            with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=30) as response:
                payload = response.read()
                return response.status, json.loads(payload) if payload else None
        except urllib.error.HTTPError as error:
            with error:
                payload = error.read()
                return error.code, json.loads(payload) if payload else None

    def order(self, category="HVAC"):
        status, order = self.request("POST", "/api/work-orders", data={
            "title": "Synthetic offer integrity verification", "customerName": "Synthetic Customer",
            "siteAddress": "100 Demonstration Avenue", "serviceCategory": category, "priority": "Normal",
            "teamId": "north", "unregisteredCustomerReason": "Synthetic offer verification without registered customer data."})
        self.assertEqual(201, status, order)
        self.addCleanup(self.cleanup_order, order["id"])
        return order

    def offer_request(self, order, technician="tech-01", expires_seconds=1200):
        start = (datetime.now(timezone.utc) + timedelta(days=1000 + int(uuid4().hex[:6], 16) % 7000)).replace(hour=14, minute=0, second=0, microsecond=0)
        return {"workOrderId": order["id"], "technicianId": technician,
            "startUtc": start.isoformat(), "endUtc": (start + timedelta(hours=1)).isoformat(),
            "expiresAtUtc": (datetime.now(timezone.utc) + timedelta(seconds=expires_seconds)).isoformat(), "idempotencyKey": str(uuid4())}

    def create_offer(self, order, technician="tech-01", expires_seconds=1200):
        request = self.offer_request(order, technician, expires_seconds)
        status, offer = self.request("POST", "/api/assignment-offers", data=request)
        self.assertEqual(201, status, offer)
        return offer, request

    def wait(self, probe, description):
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            value = probe()
            if value:
                return value
            time.sleep(0.2)
        self.fail("Timed out waiting for " + description)

    def cleanup_order(self, order_id):
        status, offers = self.request("GET", "/api/assignment-offers?workOrderId=" + order_id)
        if status == 200:
            for offer in offers:
                if offer["status"] == "Pending":
                    self.request("POST", "/api/assignment-offers/" + offer["id"] + "/revoke", data={
                        "expectedVersion": offer["version"], "idempotencyKey": str(uuid4()), "reason": "Synthetic verification cleanup"})
        status, bookings = self.request("GET", "/api/bookings?workOrderId=" + order_id)
        if status == 200:
            for booking in bookings:
                if booking["workOrderId"] == order_id and booking["status"] == "Confirmed":
                    self.request("POST", "/api/bookings/" + booking["id"] + "/cancel", data={
                        "expectedVersion": booking["version"], "reason": "Synthetic verification cleanup"})
        current = self.wait(lambda: (result := self.request("GET", "/api/work-orders/" + order_id))[0] == 200 and result[1]["status"] in ["Created", "Cancelled"] and result[1], "released test appointment")
        if current["status"] == "Created":
            status, result = self.request("PUT", "/api/work-orders/" + order_id, data={
                "expectedVersion": current["version"], "title": current["title"], "priority": current["priority"], "status": "Cancelled"})
            self.assertEqual(200, status, result)

    def test_decline_keeps_order_unassigned_and_replays_without_duplicate_offer(self):
        order = self.order()
        offer, request = self.create_offer(order)
        self.assertEqual(200, self.request("GET", "/api/work-orders/" + order["id"], "technician")[0])
        status, replayed = self.request("POST", "/api/assignment-offers", data=request)
        self.assertEqual(200, status, replayed)
        self.assertEqual(offer["id"], replayed["id"])
        status, declined = self.request("POST", "/api/assignment-offers/" + offer["id"] + "/decline", "technician", {
            "expectedVersion": offer["version"], "idempotencyKey": str(uuid4()), "reason": "Required vehicle is unavailable"})
        self.assertEqual(200, status, declined)
        self.assertEqual("Declined", declined["status"])
        self.assertEqual(404, self.request("GET", "/api/work-orders/" + order["id"], "technician")[0])
        self.assertEqual("Created", self.request("GET", "/api/work-orders/" + order["id"])[1]["status"])
        replacement, _ = self.create_offer(order)
        self.assertNotEqual(offer["id"], replacement["id"])

    def test_concurrent_retry_accepts_exactly_once_and_rejects_changed_payload(self):
        order = self.order()
        offer, _ = self.create_offer(order)
        path = "/api/assignment-offers/" + offer["id"] + "/accept"
        command = {"expectedVersion": offer["version"], "idempotencyKey": str(uuid4())}
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(lambda _: self.request("POST", path, "technician", command), range(2)))
        for status, result in responses:
            self.assertEqual(200, status, result)
            self.assertEqual("Accepted", result["status"])
        self.assertEqual(responses[0][1]["bookingId"], responses[1][1]["bookingId"])
        status, bookings = self.request("GET", "/api/bookings?workOrderId=" + order["id"], "technician")
        self.assertEqual(200, status)
        self.assertEqual(1, len([x for x in bookings if x["workOrderId"] == order["id"] and x["status"] == "Confirmed"]))
        self.assertEqual(409, self.request("POST", path, "technician", {**command, "reason": "A changed request"})[0])
        self.assertEqual(409, self.request("POST", path, "technician", {**command, "idempotencyKey": str(uuid4())})[0])
        self.wait(lambda: self.request("GET", "/api/work-orders/" + order["id"])[1]["status"] == "Scheduled", "assignment event projection")

    def test_direct_assignment_revokes_offer_and_removes_candidate_access(self):
        order = self.order()
        offer, request = self.create_offer(order)
        status, booking = self.request("POST", "/api/bookings", data={
            "workOrderId": order["id"], "technicianId": "tech-02", "startUtc": request["startUtc"],
            "endUtc": request["endUtc"], "overrideReason": "Synthetic dispatcher-controlled assignment"})
        self.assertEqual(201, status, booking)
        self.assertEqual(409, self.request("POST", "/api/assignment-offers/" + offer["id"] + "/accept", "technician", {
            "expectedVersion": offer["version"], "idempotencyKey": str(uuid4())})[0])
        self.assertEqual(404, self.request("GET", "/api/work-orders/" + order["id"], "technician")[0])
        current = self.request("GET", "/api/assignment-offers?workOrderId=" + order["id"], "technician")[1]
        self.assertEqual("Revoked", current[0]["status"])
        self.wait(lambda: self.request("GET", "/api/work-orders/" + order["id"])[1]["status"] == "Scheduled", "direct assignment projection")

    def test_expired_offer_cannot_be_accepted_and_expiration_is_audited(self):
        order = self.order()
        offer, _ = self.create_offer(order, expires_seconds=3)
        time.sleep(3.2)
        self.assertEqual(409, self.request("POST", "/api/assignment-offers/" + offer["id"] + "/accept", "technician", {
            "expectedVersion": offer["version"], "idempotencyKey": str(uuid4())})[0])
        self.assertEqual(404, self.request("GET", "/api/work-orders/" + order["id"], "technician")[0])
        current = self.request("GET", "/api/assignment-offers?workOrderId=" + order["id"], "technician")[1]
        self.assertEqual("Expired", current[0]["status"])
        self.wait(lambda: (result := self.request("GET", "/api/replay/" + order["id"], "supervisor"))[0] == 200 and
            any(x["eventType"] == "AssignmentOfferExpired.v1" for x in result[1]["events"]), "expiration outbox event in immutable replay")

    def test_role_isolation_required_qualification_and_reason_validation(self):
        order = self.order()
        offer, _ = self.create_offer(order, "tech-02")
        status, visible = self.request("GET", "/api/assignment-offers", "technician")
        self.assertEqual(200, status)
        self.assertNotIn(offer["id"], [x["id"] for x in visible])
        self.assertEqual(404, self.request("POST", "/api/assignment-offers/" + offer["id"] + "/accept", "technician", {
            "expectedVersion": offer["version"], "idempotencyKey": str(uuid4())})[0])
        self.assertEqual(403, self.request("GET", "/api/assignment-offers", "analyst")[0])
        self.assertEqual(403, self.request("POST", "/api/assignment-offers", "technician", self.offer_request(order))[0])
        self.assertEqual(400, self.request("POST", "/api/assignment-offers/" + offer["id"] + "/revoke", data={
            "expectedVersion": offer["version"], "idempotencyKey": str(uuid4()), "reason": " "})[0])
        electrical = self.order("Electrical")
        status, result = self.request("POST", "/api/assignment-offers", data=self.offer_request(electrical, "tech-02"))
        self.assertEqual(409, status, result)
        self.assertIn("skill", result["detail"])


if __name__ == "__main__":
    unittest.main()
