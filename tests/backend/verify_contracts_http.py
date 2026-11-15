"""Live contract workflow through Keycloak, the gateway, customers and work-orders.

The test creates uniquely labelled synthetic evidence. It does not bypass authorization,
reset databases, or call an external provider. The agreement is cancelled at the end;
its audit records remain.
"""
from datetime import date, datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
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
            "partsCost": 10,
        }
        status, used = self.request("POST", f"/api/contracts/{contract['id']}/usage", usage)
        self.assertEqual(200, status, used)
        self.assertEqual(1, used["lines"][0]["visitsUsed"])
        self.assertEqual(409, self.request("POST", f"/api/contracts/{contract['id']}/usage", {**usage, "operationId": str(uuid4())})[0])
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
