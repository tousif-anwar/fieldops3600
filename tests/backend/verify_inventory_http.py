"""Real Keycloak/gateway/inventory/order integration using uniquely labelled synthetic stock.

No business-table inserts, database reset, auth bypass or external delivery. Stock
and movement records are retained as audit evidence. The test releases its own
booking; it does not delete or rewrite existing appointments.
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
SPEC = importlib.util.spec_from_file_location("inventory_auth", ROOT / "scripts/local-auth.py")
AUTH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUTH)


class InventoryHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tokens = {role: AUTH.login(ROOT, role) for role in ("manager", "technician", "analyst")}

    def request(self, method, path, data=None, role="manager"):
        headers = {"Authorization": "Bearer " + self.tokens[role]}
        if data is not None:
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request("http://localhost:5100" + path,
            data=json.dumps(data).encode() if data is not None else None, headers=headers, method=method)
        try:
            with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=25) as response:
                body = response.read()
                return response.status, json.loads(body) if body else None
        except urllib.error.HTTPError as error:
            with error:
                body = error.read()
                return error.code, json.loads(body) if body else None

    def command(self, path, payload, role="manager"):
        payload = {"operationId": str(uuid4()), **payload}
        status, response = self.request("POST", "/api/inventory" + path, payload, role)
        self.assertIn(status, (200, 201), response)
        return payload, response

    def wait_order(self, order_id, expected):
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            status, order = self.request("GET", "/api/work-orders/" + order_id)
            if status == 200 and order["status"] == expected:
                return order
            time.sleep(0.25)
        self.fail("The real work-order projection did not reach " + expected)

    def test_parts_reservation_transfer_consumption_and_return_through_real_services(self):
        suffix = uuid4().hex[:12]
        status, order = self.request("POST", "/api/work-orders", {
            "title": "Synthetic enterprise inventory verification " + suffix,
            "customerName": "Synthetic Inventory Customer", "siteAddress": "100 Demonstration Avenue",
            "serviceCategory": "HVAC", "priority": "Normal", "teamId": "north",
            "unregisteredCustomerReason": "Isolated synthetic stock lifecycle verification without registry data."})
        self.assertEqual(201, status, order)
        start = (datetime.now(timezone.utc) + timedelta(days=10 + int(suffix[:4], 16) % 3500)).replace(hour=15, minute=0, second=0, microsecond=0)
        booking = None
        try:
            status, booking = self.request("POST", "/api/bookings", {
                "workOrderId": order["id"], "technicianId": "tech-01", "startUtc": start.isoformat(),
                "endUtc": (start + timedelta(hours=1)).isoformat(), "overrideReason": "Synthetic inventory integration verification"})
            self.assertEqual(201, status, booking)
            self.wait_order(order["id"], "Scheduled")
            _, part = self.command("/parts", {"sku": "VERIFY-" + suffix, "name": "Synthetic test filter " + suffix,
                "category": "HVAC filter", "unit": "Each", "currency": "USD", "unitCost": 12.3456,
                "reorderPoint": 2, "reorderQuantity": 10})
            _, warehouse = self.command("/locations", {"name": "Synthetic stock source " + suffix, "kind": "RegionalWarehouse"})
            status, locations = self.request("GET", "/api/inventory/locations")
            self.assertEqual(200, status, locations)
            vehicle = next((item for item in locations if item["kind"] == "Vehicle" and item.get("technicianId") == "tech-01" and item["active"]), None)
            if vehicle is None:
                _, vehicle = self.command("/locations", {"name": "Synthetic technician vehicle", "kind": "Vehicle", "technicianId": "tech-01"})
            receipt, initial = self.command("/stock/receive", {"partId": part["id"], "locationId": warehouse["id"], "quantity": 12, "reason": "Synthetic supplier receipt"})
            status, replay = self.request("POST", "/api/inventory/stock/receive", receipt)
            self.assertEqual(200, status, replay)
            self.assertEqual(initial, replay)
            self.assertEqual(409, self.request("POST", "/api/inventory/stock/receive", {**receipt, "quantity": 13})[0])
            _, reservation = self.command("/reservations", {"workOrderId": order["id"], "partId": part["id"], "locationId": warehouse["id"], "quantity": 4})
            self.assertEqual(404, self.request("POST", "/api/inventory/consumptions", {"operationId": str(uuid4()), "workOrderId": order["id"], "partId": part["id"], "locationId": warehouse["id"], "quantity": 1}, "technician")[0])
            self.assertEqual(403, self.request("POST", "/api/inventory/adjustments", {"operationId": str(uuid4()), "partId": part["id"], "locationId": vehicle["id"], "quantityDelta": 1, "reason": "Unprivileged adjustment attempt"}, "technician")[0])
            self.assertEqual(403, self.request("GET", "/api/inventory/parts", role="analyst")[0])
            _, released = self.command("/reservations/" + reservation["id"] + "/release", {"quantity": 4, "reason": "Move available stock to assigned vehicle"})
            self.assertEqual(0, released["remaining"])
            self.assertEqual(4, released["releasedQuantity"])
            _, transfer = self.command("/transfers", {"partId": part["id"], "sourceLocationId": warehouse["id"], "destinationLocationId": vehicle["id"], "quantity": 4, "workOrderId": order["id"]})
            _, partial = self.command("/transfers/" + transfer["id"] + "/receive", {"quantity": 1}, "technician")
            self.assertEqual("InTransit", partial["status"])
            _, finished = self.command("/transfers/" + transfer["id"] + "/receive", {"quantity": 3}, "technician")
            self.assertEqual("Received", finished["status"])
            self.assertEqual(409, self.request("POST", "/api/inventory/transfers/" + transfer["id"] + "/receive", {"operationId": str(uuid4()), "quantity": 1}, "technician")[0])
            _, vehicle_reservation = self.command("/reservations", {"workOrderId": order["id"], "partId": part["id"], "locationId": vehicle["id"], "quantity": 3})
            consumption_request, consumption = self.command("/consumptions", {"workOrderId": order["id"], "partId": part["id"], "locationId": vehicle["id"], "reservationId": vehicle_reservation["id"], "quantity": 3}, "technician")
            self.assertEqual(12.3456, consumption["unitCost"])
            self.assertEqual(consumption, self.request("POST", "/api/inventory/consumptions", consumption_request, "technician")[1])
            _, returned = self.command("/consumptions/" + consumption["id"] + "/return", {"quantity": 1, "reason": "Unused sealed filter returned"}, "technician")
            self.assertEqual(1, returned["returnedQuantity"])
            self.assertEqual(409, self.request("POST", "/api/inventory/consumptions/" + consumption["id"] + "/return", {"operationId": str(uuid4()), "quantity": 3, "reason": "Cannot return more than actual consumption"}, "technician")[0])
            _, part_request = self.command("/requests", {"workOrderId": order["id"], "partId": part["id"], "quantity": 1, "reason": "Additional synthetic verification filter", "kind": "Additional"}, "technician")
            self.command("/requests/" + part_request["id"] + "/close", {"reason": "Request fulfilled during verification"})
            status, context = self.request("GET", "/api/inventory/work-orders/" + order["id"], role="technician")
            self.assertEqual(200, status, context)
            balances = [item for item in context["balances"] if item["partId"] == part["id"] and item["locationId"] == vehicle["id"]]
            self.assertEqual(1, len(balances))
            self.assertEqual((2, 0, 2), (balances[0]["onHand"], balances[0]["reserved"], balances[0]["available"]))
            self.assertTrue(any(item["kind"] == "Consumption" for item in context["movements"]))
            # Racing new commands contend for the same authoritative available balance.
            payloads = [{"operationId": str(uuid4()), "workOrderId": order["id"], "partId": part["id"], "locationId": vehicle["id"], "quantity": 2} for _ in range(2)]
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(lambda data: self.request("POST", "/api/inventory/consumptions", data, "technician"), payloads))
            self.assertEqual([200, 409], sorted(status for status, _ in results), results)
        finally:
            if booking and booking.get("id"):
                status, current = self.request("GET", "/api/bookings/" + booking["id"])
                if status == 200 and current["status"] == "Confirmed":
                    status, result = self.request("POST", "/api/bookings/" + booking["id"] + "/cancel", {"expectedVersion": current["version"], "reason": "Synthetic inventory verification complete"})
                    self.assertEqual(200, status, result)


if __name__ == "__main__":
    unittest.main()
