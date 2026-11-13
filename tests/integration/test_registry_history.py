"""Live regressions for assigned equipment history and registry-report freshness.

Uses real Keycloak PKCE and persisted local APIs. Each test creates its own labeled
synthetic registry records; no presentation manifest, reused IDs or mocked server.
Cleanup cancels only its bookings/orders and archives its retained registry data.
"""

from __future__ import annotations

import importlib.util
import json
import time
import unittest
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("local_auth", ROOT / "scripts/local-auth.py")
AUTH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUTH)
BASE = "http://localhost:5100"


def instant(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


class RegistryHistoryLiveTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tokens = {
            role: AUTH.login(ROOT, role) for role in ("dispatcher", "technician", "analyst")
        }

    @classmethod
    def request(cls, method, path, role="dispatcher", body=None, retry_identity=True):
        headers = {"Authorization": "Bearer " + cls.tokens[role]}
        if body is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(
            BASE + path,
            data=json.dumps(body).encode() if body is not None else None,
            headers=headers,
            method=method,
        )
        try:
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open(request, timeout=25) as response:
                raw = response.read()
                payload = json.loads(raw) if raw else None
                return response.status, payload
        except urllib.error.HTTPError as error:
            with error:
                status = error.code
                raw = error.read()
                payload = json.loads(raw) if raw else None
            if status == 401 and retry_identity:
                # A long local run may outlive its five-minute access token.
                # Renew the same signed role; never bypass a 403/404 decision.
                cls.tokens[role] = AUTH.login(ROOT, role)
                return cls.request(method, path, role, body, retry_identity=False)
            return status, payload

    def wait_for(self, probe, description, timeout=60):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            result = probe()
            if result:
                return result
            time.sleep(0.25)
        self.fail("Timed out waiting for " + description)

    def setUp(self):
        self.tag = uuid4().hex[:12]
        self.before_reports = {}
        for domain in ("customers", "assets"):
            status, report = self.request("GET", "/api/reports/" + domain, "analyst")
            self.assertEqual(200, status, report)
            self.before_reports[domain] = report
        status, self.customer = self.request(
            "POST",
            "/api/customers",
            body={
                "displayName": "Synthetic registry regression " + self.tag,
                "customerType": "Commercial",
                "teamId": "north",
                "preferredChannel": "None",
                "contacts": [
                    {
                        "fullName": "Synthetic Regression Contact",
                        "email": self.tag + "@example.invalid",
                        "phone": None,
                        "isPrimary": True,
                        "emailConsent": False,
                        "phoneConsent": False,
                    }
                ],
                "locations": [
                    {
                        "name": "Synthetic Test Location",
                        "addressLine1": "100 Demonstration Avenue",
                        "addressLine2": None,
                        "city": "Boston",
                        "region": "MA",
                        "postalCode": "02101",
                        "countryCode": "US",
                        "accessNotes": "Synthetic local regression data only.",
                        "status": "Active",
                    }
                ],
            },
        )
        self.assertEqual(201, status, self.customer)
        self.addCleanup(self.archive_customer, self.customer["id"])
        self.location = self.customer["locations"][0]
        now = datetime.now(timezone.utc)
        status, self.asset = self.request(
            "POST",
            "/api/assets",
            body={
                "name": "Synthetic Regression Equipment " + self.tag,
                "assetType": "HVAC",
                "manufacturer": "Synthetic Manufacturer",
                "model": "REGRESSION-1",
                "serialNumber": "SYN-REG-" + self.tag,
                "qrCode": "fieldops360://asset/regression-" + self.tag,
                "criticality": "Medium",
                "customerId": self.customer["id"],
                "serviceLocationId": self.location["id"],
                "customerVersion": self.customer["version"],
                "parentAssetId": None,
                "installedAtUtc": (now - timedelta(days=10)).isoformat(),
                "warrantyEndUtc": (now + timedelta(days=365)).isoformat(),
            },
        )
        self.assertEqual(201, status, self.asset)
        self.addCleanup(self.retire_asset, self.asset["id"])
        self.order = self.create_order("Assigned-history candidate")

    def create_order(self, label):
        status, order = self.request(
            "POST",
            "/api/work-orders",
            body={
                "title": "Synthetic registry regression " + label + " " + self.tag,
                "serviceCategory": "HVAC",
                "priority": "Normal",
                "teamId": "north",
                "customerId": self.customer["id"],
                "serviceLocationId": self.location["id"],
                "assetId": self.asset["id"],
            },
        )
        self.assertEqual(201, status, order)
        self.addCleanup(self.cancel_order, order["id"])
        return order

    def book_free_weekday(self):
        status, technician = self.request("GET", "/api/technicians/tech-01")
        self.assertEqual(200, status, technician)
        self.assertTrue(technician["available"])
        self.assertIn("HVAC", technician["skills"])
        self.assertIn("HVAC Safety", technician["certifications"])
        status, time_off = self.request("GET", "/api/technicians/tech-01/time-off")
        self.assertEqual(200, status, time_off)
        status, bookings = self.request("GET", "/api/bookings")
        self.assertEqual(200, status, bookings)
        occupied = [(instant(row["startUtc"]), instant(row["endUtc"])) for row in time_off] + [
            (instant(row["startUtc"]), instant(row["endUtc"]))
            for row in bookings
            if row["technicianId"] == "tech-01" and row["status"] == "Confirmed"
        ]
        zone = ZoneInfo(technician["timeZone"])
        first = datetime.now(zone).date() + timedelta(days=90 + int(self.tag[:4], 16) % 3000)
        for offset in range(60):
            date = first + timedelta(days=offset)
            if date.weekday() >= 5:
                continue
            start = datetime(
                date.year, date.month, date.day, technician["workingStartHour"], tzinfo=zone
            ).astimezone(timezone.utc)
            end = start + timedelta(hours=1)
            if technician["workingEndHour"] - technician["workingStartHour"] < 1:
                self.fail("The technician has no one-hour working interval.")
            if any(
                start < occupied_end and end > occupied_start
                for occupied_start, occupied_end in occupied
            ):
                continue
            status, booking = self.request(
                "POST",
                "/api/bookings",
                body={
                    "workOrderId": self.order["id"],
                    "technicianId": "tech-01",
                    "startUtc": start.isoformat(),
                    "endUtc": end.isoformat(),
                    "overrideReason": None,
                },
            )
            if status == 409:
                # A concurrent local verification can reserve the same interval.
                occupied.append((start, end))
                continue
            self.assertEqual(201, status, booking)
            self.addCleanup(self.cancel_booking, booking)
            return booking
        self.fail("No free future weekday was available in the bounded candidate window.")

    def test_assigned_history_does_not_require_office_only_asset_reference(self):
        asset_id = self.asset["id"]
        history_path = "/api/work-orders/by-asset/" + asset_id
        self.assertEqual(404, self.request("GET", history_path, "technician")[0])
        self.assertEqual(
            404, self.request("GET", "/api/assets/" + asset_id + "/reference", "technician")[0]
        )
        unassigned = self.create_order("Unassigned must remain hidden")
        self.book_free_weekday()
        self.wait_for(
            lambda: (
                (
                    result := self.request(
                        "GET", "/api/work-orders/" + self.order["id"], "technician"
                    )
                )[0]
                == 200
                and result[1]["technicianId"] == "tech-01"
                and result[1]
            ),
            "the persisted booking's work-order assignment projection",
        )
        # This is the original regression: private registry identity remains hidden,
        # while the work-order owner authorizes its own assigned service history.
        self.assertEqual(
            404, self.request("GET", "/api/assets/" + asset_id + "/reference", "technician")[0]
        )
        status, history = self.request("GET", history_path, "technician")
        self.assertEqual(200, status, history)
        self.assertIn(self.order["id"], [row["id"] for row in history["items"]])
        self.assertNotIn(unassigned["id"], [row["id"] for row in history["items"]])
        self.assertTrue(all(row["technicianId"] == "tech-01" for row in history["items"]))
        self.assertEqual(1, history["total"])
        customer_context = (
            "/api/customers/"
            + self.customer["id"]
            + "/service-context?workOrderId="
            + self.order["id"]
        )
        status, context = self.request("GET", customer_context, "technician")
        self.assertEqual(200, status, context)
        self.assertEqual(self.customer["id"], context["customerId"])
        self.assertEqual(self.location["id"], context["location"]["id"])
        self.assertFalse(context["contacts"][0]["emailConsent"])
        status, context = self.request(
            "GET",
            "/api/assets/" + asset_id + "/service-context?workOrderId=" + self.order["id"],
            "technician",
        )
        self.assertEqual(200, status, context)
        self.assertEqual(asset_id, context["id"])
        self.assertEqual(self.asset["serialNumber"], context["serialNumber"])
        self.assertEqual(
            404, self.request("GET", "/api/work-orders/by-asset/" + str(uuid4()), "technician")[0]
        )
        self.assertEqual(403, self.request("GET", history_path, "analyst")[0])

    def test_registry_reports_include_persisted_events_and_nonnull_freshness(self):
        for domain, count_field, source_time in (
            ("customers", "registeredCustomers", self.customer["createdAtUtc"]),
            ("assets", "registeredAssets", self.asset["createdAtUtc"]),
        ):
            with self.subTest(domain=domain):
                minimum = self.before_reports[domain][count_field] + 1

                def projected():
                    status, report = self.request("GET", "/api/reports/" + domain, "analyst")
                    self.assertEqual(200, status, report)
                    refreshed = report.get("refreshedAtUtc")
                    return (
                        report[count_field] >= minimum
                        and refreshed is not None
                        and instant(refreshed) >= instant(source_time)
                        and report
                    )

                report = self.wait_for(projected, domain + " registry event ingestion", timeout=90)
                self.assertGreaterEqual(report["linkedWorkOrders"], 0)
                self.assertIn("freshness", report["definitions"])
                self.assertNotIn(self.tag, json.dumps(report))
                self.assertEqual(
                    403, self.request("GET", "/api/reports/" + domain, "technician")[0]
                )

    def cancel_booking(self, booking):
        status, result = self.request(
            "POST",
            "/api/bookings/" + booking["id"] + "/cancel",
            body={"expectedVersion": booking["version"], "reason": "Synthetic regression cleanup"},
        )
        self.assertEqual(200, status, result)
        self.wait_for(
            lambda: (
                (result := self.request("GET", "/api/work-orders/" + self.order["id"]))[0] == 200
                and result[1]["status"] in ("Created", "Cancelled")
            ),
            "cleanup booking-release projection",
        )

    def cancel_order(self, order_id):
        status, order = self.request("GET", "/api/work-orders/" + order_id)
        self.assertEqual(200, status, order)
        if order["status"] == "Cancelled":
            return
        status, result = self.request(
            "PUT",
            "/api/work-orders/" + order_id,
            body={
                "expectedVersion": order["version"],
                "title": order["title"],
                "priority": order["priority"],
                "status": "Cancelled",
            },
        )
        self.assertEqual(200, status, result)

    def retire_asset(self, asset_id):
        status, asset = self.request("GET", "/api/assets/" + asset_id)
        self.assertEqual(200, status, asset)
        status, result = self.request(
            "PUT",
            "/api/assets/" + asset_id,
            body=asset | {"expectedVersion": asset["version"], "status": "Retired"},
        )
        self.assertEqual(200, status, result)

    def archive_customer(self, customer_id):
        status, customer = self.request("GET", "/api/customers/" + customer_id)
        self.assertEqual(200, status, customer)
        status, result = self.request(
            "PUT",
            "/api/customers/" + customer_id,
            body=customer | {"expectedVersion": customer["version"], "status": "Archived"},
        )
        self.assertEqual(200, status, result)


if __name__ == "__main__":
    unittest.main()
