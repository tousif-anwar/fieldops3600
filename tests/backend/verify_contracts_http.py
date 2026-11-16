"""Live contract workflow through Keycloak, the gateway, customers and work-orders.

The test creates uniquely labelled synthetic evidence. It does not bypass authorization,
reset databases, or call an external provider. The agreement is cancelled at the end;
its audit records remain.
"""
from datetime import date, datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
from pathlib import Path
import time
import unittest
import urllib.error
import urllib.request
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("contract_auth", ROOT / "scripts/local-auth.py")
AUTH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUTH)


class ContractHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tokens = {role: AUTH.login(ROOT, role) for role in ("manager", "technician", "analyst")}

    def request(self, method, path, data=None, role="manager"):
        headers = {"Authorization": "Bearer " + self.tokens[role]}
        if data is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(
            "http://localhost:5100" + path,
            data=json.dumps(data).encode() if data is not None else None,
            headers=headers,
            method=method,
        )
        try:
            with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=30) as response:
                body = response.read()
                return response.status, json.loads(body) if body else None
        except urllib.error.HTTPError as error:
            with error:
                body = error.read()
                return error.code, json.loads(body) if body else None

    def command(self, path, payload, role="manager"):
        payload = {"operationId": str(uuid4()), **payload}
        status, response = self.request("POST", "/api/contracts" + path, payload, role)
        self.assertIn(status, (200, 201), response)
        return payload, response

    def wait(self, predicate, description, timeout=45):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            value = predicate()
            if value:
                return value
            time.sleep(0.2)
        self.fail("Timed out waiting for " + description)

    def complete_maintenance_service(self, work_order_id):
        # Capacity and owner rules stay authoritative. Repeated local verification
        # retains service evidence, so search unoccupied future working windows.
        booked = None
        for days in range(1, 61):
            candidate = datetime.now(timezone.utc).replace(hour=15, minute=0, second=0, microsecond=0) + timedelta(days=days)
            if candidate.weekday() > 4:
                continue
            status, response = self.request("POST", "/api/bookings", {
                "workOrderId": work_order_id, "technicianId": "tech-01",
                "startUtc": candidate.isoformat(), "endUtc": (candidate + timedelta(hours=1)).isoformat(),
            })
            if status == 201:
                booked = response
                break
            self.assertEqual(409, status, response)
        self.assertIsNotNone(booked, "No available synthetic service window in the next 60 days")
        self.wait(lambda: (result := self.request("GET", "/api/work-orders/" + work_order_id))[0] == 200
                  and result[1]["status"] == "Scheduled", "real booking projection")
        status, workflow = self.request("POST", "/api/workflows", {"workOrderId": work_order_id}, "technician")
        self.assertIn(status, (200, 201), workflow)
        status, template = self.request("GET", "/api/workflows/templates/" + str(workflow["templateVersion"]), role="technician")
        self.assertEqual(200, status, template)
        for stage in template["stages"]:
            answers = {}
            for field in stage["fields"]:
                if not field.get("conditionField") or answers.get(field["conditionField"]) == field.get("conditionValue"):
                    answers[field["key"]] = ("45.5" if field.get("inputType") == "number" else
                                             "Synthetic completed maintenance service evidence." if field.get("inputType") == "text" else field["options"][0])
            payload = {"expectedVersion": workflow["version"], "idempotencyKey": str(uuid4()), "answers": answers,
                       "offline": False, "clientOccurredAtUtc": datetime.now(timezone.utc).isoformat()}
            status, workflow = self.request("POST", "/api/workflows/" + workflow["id"] + "/submit", payload, "technician")
            self.assertEqual(200, status, workflow)
        self.assertEqual("Completed", workflow["status"])
        self.wait(lambda: (result := self.request("GET", "/api/work-orders/" + work_order_id))[0] == 200
                  and result[1]["status"] == "Completed", "real work-order completion projection")

    def test_synthetic_agreement_recurrence_entitlement_and_usage(self):
        # A fresh customer isolates this agreement from earlier retained evidence.
        status, candidate = self.request(
            "POST",
            "/api/customers",
            {
                "displayName": "Synthetic Agreement Customer " + uuid4().hex[:8],
                "customerType": "Commercial",
                "teamId": "north",
                "preferredChannel": "Email",
                "contacts": [
                    {
                        "fullName": "Synthetic Agreement Contact",
                        "email": "agreement-contact@example.invalid",
                        "isPrimary": True,
                        "emailConsent": True,
                    }
                ],
                "locations": [
                    {
                        "name": "Synthetic Agreement Site",
                        "addressLine1": "100 Agreement Avenue",
                        "city": "Test City",
                        "region": "NY",
                        "postalCode": "10001",
                        "countryCode": "US",
                        "status": "Active",
                    }
                ],
            },
        )
        self.assertEqual(201, status, candidate)
        status, customer = self.request("GET", "/api/customers/" + candidate["id"])
        self.assertEqual(200, status, customer)
        location = next((item for item in customer["locations"] if item["status"] == "Active"), None)
        self.assertIsNotNone(location)

        suffix = uuid4().hex[:10]
        today = date.today()
        service_type = "HVAC"
        create = {
            "operationId": str(uuid4()),
            "customerId": customer["id"],
            "effectiveFromUtc": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(),
            "expiresAtUtc": (datetime.now(timezone.utc) + timedelta(days=365)).isoformat(),
            "timeZoneId": "UTC",
            "coversAllAssets": True,
            "lines": [
                {
                    "serviceType": service_type,
                    "laborCovered": True,
                    "partsCovered": True,
                    "includedVisits": 2,
                    "partsAllowance": 100,
                }
            ],
            "coveredAssets": [],
            "exclusions": [],
        }
        status, contract = self.request("POST", "/api/contracts", create)
        self.assertEqual(200, status, contract)
        self.assertEqual(contract["id"], self.request("POST", "/api/contracts", create)[1]["id"])
        changed = {**create, "lines": [{**create["lines"][0], "includedVisits": 3}]}
        self.assertEqual(409, self.request("POST", "/api/contracts", changed)[0])
        self.assertEqual(403, self.request("GET", "/api/contracts", role="analyst")[0])
        self.assertEqual(403, self.request("POST", "/api/contracts", {**create, "operationId": str(uuid4())}, "technician")[0])
        line = contract["lines"][0]

        plan = {
            "operationId": str(uuid4()),
            "contractId": contract["id"],
            "contractLineId": line["id"],
            "assetId": None,
            "frequency": "Quarterly",
            "startDate": today.isoformat(),
            "endsOn": (today + timedelta(days=365)).isoformat(),
        }
        status, planned = self.request("POST", f"/api/contracts/{contract['id']}/plans", plan)
        self.assertEqual(200, status, planned)
        self.assertEqual(1, len(planned["plans"]))
        status, active = self.request(
            "POST",
            f"/api/contracts/{contract['id']}/status",
            {
                "operationId": str(uuid4()),
                "contractId": contract["id"],
                "expectedVersion": planned["version"],
                "status": "Active",
                "reason": "Synthetic agreement verification",
            },
        )
        self.assertEqual(200, status, active)
        self.assertEqual("Active", active["status"])
        status, generated = self.request(
            "POST",
            f"/api/contracts/{contract['id']}/visits/generate",
            {
                "operationId": str(uuid4()),
                "contractId": contract["id"],
                "throughDate": (today + timedelta(days=200)).isoformat(),
            },
        )
        self.assertEqual(200, status, generated)
        self.assertEqual(3, generated["generated"], generated)
        status, replay = self.request(
            "POST",
            f"/api/contracts/{contract['id']}/visits/generate",
            {
                "operationId": str(uuid4()),
                "contractId": contract["id"],
                "throughDate": (today + timedelta(days=200)).isoformat(),
            },
        )
        self.assertEqual(200, status, replay)
        self.assertEqual(0, replay["generated"], replay)

        # Dispatch commits a durable intent and uses the visit ID as the work-order key.
        # Concurrent retries go through the real service owners, not database inserts.
        visit = generated["visits"][0]
        dispatch = {"operationId": str(uuid4()), "serviceLocationId": location["id"]}
        route = f"/api/contracts/{contract['id']}/visits/{visit['id']}/dispatch"
        with ThreadPoolExecutor(max_workers=2) as pool:
            attempts = list(pool.map(lambda _: self.request("POST", route, dispatch), range(2)))
        self.assertEqual([200, 200], sorted(status for status, _ in attempts), attempts)
        self.assertEqual(attempts[0][1], attempts[1][1])
        self.assertTrue(attempts[0][1]["dispatchComplete"])
        status, recurring_order = self.request("GET", "/api/work-orders/" + attempts[0][1]["workOrderId"])
        self.assertEqual(200, status, recurring_order)
        self.assertEqual(visit["id"], recurring_order["id"])
        self.assertEqual(visit["id"], recurring_order["maintenanceVisitId"])
        self.assertEqual(location["id"], recurring_order["serviceLocationId"])
        self.assertEqual(contract["id"], recurring_order["contractId"])
        self.assertEqual("Created", recurring_order["status"])
        self.assertIsNone(recurring_order["technicianId"])
        self.assertIsNotNone(recurring_order["coverageEvaluatedAtUtc"])
        self.assertEqual(403, self.request("POST", route, dispatch, "technician")[0])
        changed_visit = generated["visits"][1]
        self.assertEqual(409, self.request("POST", f"/api/contracts/{contract['id']}/visits/{changed_visit['id']}/dispatch", dispatch)[0])
        status, orders_for_customer = self.request("GET", f"/api/work-orders/by-customer/{customer['id']}")
        self.assertEqual(200, status, orders_for_customer)
        self.assertEqual(1, orders_for_customer["total"])

        status, entitlement = self.request(
            "GET",
            f"/api/contracts/entitlements?customerId={customer['id']}&serviceType={service_type}",
        )
        self.assertEqual(200, status, entitlement)
        self.assertTrue(entitlement["covered"], entitlement)
        self.assertEqual(2, entitlement["visitsRemaining"], entitlement)

        status, order = self.request(
            "POST",
            "/api/work-orders",
            {
                "title": "Synthetic agreement usage " + suffix,
                "customerName": customer["displayName"],
                "siteAddress": "Synthetic agreement site",
                "serviceCategory": service_type,
                "priority": "Normal",
                "teamId": "north",
                "customerId": customer["id"],
                "serviceLocationId": location["id"],
            },
        )
        self.assertEqual(201, status, order)
        usage = {
            "operationId": str(uuid4()),
            "contractId": contract["id"],
            "contractLineId": line["id"],
            "workOrderId": order["id"],
            "visitsUsed": 1,
            "partsCost": 0,
        }
        # An arbitrary uncompleted customer job cannot consume the allowance.
        self.assertEqual(409, self.request("POST", f"/api/contracts/{contract['id']}/usage", usage)[0])
        self.complete_maintenance_service(recurring_order["id"])

        def completed_agreement():
            status, result = self.request("GET", f"/api/contracts/{contract['id']}")
            self.assertEqual(200, status, result)
            completed_visit = next(item for item in result["visits"] if item["id"] == visit["id"])
            return result if completed_visit["status"] == "Completed" and len(result["usage"]) == 1 else None

        used = self.wait(completed_agreement, "customer consumer completion and append-only usage")
        completed_visit = next(item for item in used["visits"] if item["id"] == visit["id"])
        self.assertFalse(completed_visit["completionReviewRequired"], completed_visit)
        self.assertIsNotNone(completed_visit["completedAtUtc"])
        self.assertEqual(recurring_order["id"], used["usage"][0]["workOrderId"])
        self.assertEqual(0, used["usage"][0]["partsCost"])
        self.assertEqual(1, used["lines"][0]["visitsUsed"])
        self.assertEqual(409, self.request("POST", f"/api/contracts/{contract['id']}/usage",
                                         {**usage, "workOrderId": recurring_order["id"], "operationId": str(uuid4())})[0])
        status, remaining = self.request(
            "GET",
            f"/api/contracts/entitlements?customerId={customer['id']}&serviceType={service_type}",
        )
        self.assertEqual(200, status, remaining)
        self.assertEqual(1, remaining["visitsRemaining"], remaining)

        status, cancelled = self.request(
            "POST",
            f"/api/contracts/{contract['id']}/status",
            {
                "operationId": str(uuid4()),
                "contractId": contract["id"],
                "expectedVersion": used["version"],
                "status": "Cancelled",
                "reason": "Synthetic contract verification complete.",
            },
        )
        self.assertEqual(200, status, cancelled)
        self.assertEqual("Cancelled", cancelled["status"])


if __name__ == "__main__":
    unittest.main()
