"""Repeatable local synthetic demo data, created through authenticated APIs.

No database resets, direct business-table inserts, credential output, or invented
audit events. Resume state is private. System/migration/transport tables are
populated only by the running services, not by fabricated seeder rows.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
import time
import urllib.error
import urllib.request
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("demo_auth", ROOT / "scripts/local-auth.py")
AUTH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUTH)
BASE = "http://localhost:5100"
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class Api:
    def __init__(self):
        self.tokens = {}

    def request(self, method, path, body=None, role="administrator", key=None, allowed=(200, 201)):
        if role not in self.tokens:
            self.tokens[role] = AUTH.login(ROOT, role)
        for attempt in range(2):
            headers = {"Authorization": "Bearer " + self.tokens[role]}
            if body is not None:
                headers["Content-Type"] = "application/json"
            if key:
                headers["Idempotency-Key"] = key
            request = urllib.request.Request(BASE + path, method=method, headers=headers, data=json.dumps(body).encode() if body is not None else None)
            try:
                response = OPENER.open(request, timeout=25)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                raw = response.read()
                data = json.loads(raw) if raw else None
                if response.code == 401 and attempt == 0:
                    self.tokens[role] = AUTH.login(ROOT, role)
                    continue
                if response.code not in allowed:
                    detail = data.get("detail", data.get("title", "")) if isinstance(data, dict) else ""
                    raise RuntimeError(f"{method} {path}: HTTP {response.code}; {str(detail)[:180]}")
                return data
        raise RuntimeError("Authentication refresh failed")


def wait(probe, label, seconds=45):
    until = time.monotonic() + seconds
    while time.monotonic() < until:
        value = probe()
        if value:
            return value
        time.sleep(0.35)
    raise RuntimeError("Timed out: " + label)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--orders", type=int, default=30)
    parser.add_argument("--customers", type=int, default=24)
    parser.add_argument("--manifest", type=Path, default=ROOT / ".local/presentation-demo-data.json")
    args = parser.parse_args()
    if args.orders < 8 or args.orders > 100:
        raise SystemExit("Choose 8–100 synthetic work orders")
    if not 8 <= args.customers <= 40:
        raise SystemExit("Choose 8–40 synthetic customers")
    api = Api()
    technician_id = api.request("GET", "/api/session", role="technician")["id"]
    state = json.loads(args.manifest.read_text()) if args.manifest.exists() else {"synthetic": True, "batchId": uuid4().hex[:10], "customers": [], "assets": [], "orders": [], "startedAtUtc": datetime.now(timezone.utc).isoformat()}
    args.manifest.parent.mkdir(parents=True, exist_ok=True)

    def save():
        args.manifest.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")

    save()
    now = datetime.now(timezone.utc)
    names = ["Aurora Training Foods", "Cedar Demo Offices", "Harbor Synthetic Clinic", "Juniper Practice Market", "Maple Demo Residence", "Summit Training Hotel", "Willow Example Workshop", "Pioneer Demo Storage"]
    extra_names = ["Aspen Medical Offices", "Birch Community Market", "Brookside Apartments", "Clearwater Hotel", "Elm Research Offices", "Evergreen Warehouse", "Foxglove Bakery", "Granite Learning Center", "Lakeside Residence", "Meadow Design Studio", "Oakridge Dental", "Redwood Cafe", "Riverbend Apartments", "Spruce Retail Center", "Westhaven Residence", "Willowbrook Logistics"]
    names.extend(extra_names)
    names.extend("Example Customer " + str(i + 1) for i in range(max(0, args.customers - len(names))))
    names = names[:args.customers]
    for i, name in enumerate(names):
        if i < len(state["customers"]):
            continue
        body = {"displayName": "Synthetic " + name, "customerType": "Residential" if i == 4 else "Commercial", "teamId": "north", "status": "Active", "preferredChannel": "Email", "contacts": [{"fullName": "Demo Contact " + str(i + 1), "email": f"demo.contact{i + 1}@example.com", "phone": f"+1 202 555 01{i:02}", "isPrimary": True, "emailConsent": True, "phoneConsent": False}], "locations": [{"name": "Training service site", "addressLine1": f"{100+i} Example Training Lane", "addressLine2": "Synthetic demonstration location", "city": "Example City", "region": "NY", "postalCode": "10001", "countryCode": "US", "accessNotes": "Synthetic site. Use the training entrance; no real customer visit.", "status": "Active"}]}
        customer = api.request("POST", "/api/customers", body, key=f"demo-{state['batchId']}-customer-{i}")
        state["customers"].append(customer)
        save()
    for i, customer in enumerate(state["customers"]):
        if i < len(state["assets"]):
            continue
        body = {"name": f"Synthetic rooftop unit {i+1}", "assetType": "HVAC", "manufacturer": "Demo Climate", "model": "TRAIN-" + str(100+i), "serialNumber": f"SYN-{state['batchId']}-{i+1:03}", "qrCode": f"FIELDOPS-DEMO-{state['batchId']}-{i+1}", "criticality": ["Low", "Medium", "High", "Critical"][i % 4], "customerId": customer["id"], "serviceLocationId": customer["locations"][0]["id"], "customerVersion": customer["version"], "parentAssetId": None, "installedAtUtc": (now-timedelta(days=700+i*35)).isoformat(), "warrantyEndUtc": (now+timedelta(days=[-30, 25, 70, 400][i % 4])).isoformat()}
        asset = api.request("POST", "/api/assets", body, key=f"demo-{state['batchId']}-asset-{i}")
        state["assets"].append(asset)
        save()
    print(f"Synthetic registry ready: {len(state['customers'])} customers, {len(state['assets'])} assets", flush=True)
    # Publishing the existing synthetic profile through its real edit API makes
    # authoritative working-hours metadata available to the warehouse.
    if not state.get("profilePublished"):
        technicians = api.request("GET", "/api/technicians")
        technician = next(t for t in technicians if t["id"] == technician_id)
        api.request("PUT", "/api/technicians/" + technician_id, technician)
        state["profilePublished"] = True
        save()
    # Use a real availability command, away from the demonstration bookings.
    # A repeated run discovers the same labeled interval before creating one.
    if not state.get("timeOffId"):
        reason = "Synthetic training availability " + state["batchId"]
        intervals = api.request("GET", f"/api/technicians/{technician_id}/time-off")
        interval = next((item for item in intervals if item["reason"] == reason), None)
        if interval is None:
            start = (now + timedelta(days=45)).replace(hour=14, minute=0, second=0, microsecond=0)
            while start.weekday() > 4:
                start += timedelta(days=1)
            interval = api.request("POST", f"/api/technicians/{technician_id}/time-off", {
                "startUtc": start.isoformat(), "endUtc": (start + timedelta(hours=1)).isoformat(), "reason": reason,
            })
        state["timeOffId"] = interval["id"]
        save()
    existing_bookings = api.request("GET", "/api/bookings")
    template = api.request("GET", "/api/workflows/templates/default")

    def booking(order):
        found = next((b for b in existing_bookings if b["workOrderId"] == order["id"] and b["status"] == "Confirmed"), None)
        if found:
            return found
        for day in range(1, 25):
            date = (now + timedelta(days=day))
            if date.weekday() > 4:
                continue
            for hour in range(14, 20):
                start = date.replace(hour=hour, minute=0, second=0, microsecond=0)
                end = start + timedelta(minutes=45)
                if any(b["technicianId"] == technician_id and b["status"] == "Confirmed" and datetime.fromisoformat(b["startUtc"].replace("Z", "+00:00")) < end and datetime.fromisoformat(b["endUtc"].replace("Z", "+00:00")) > start for b in existing_bookings):
                    continue
                result = api.request("POST", "/api/bookings", {"workOrderId": order["id"], "technicianId": technician_id, "startUtc": start.isoformat(), "endUtc": end.isoformat(), "overrideReason": None})
                existing_bookings.append(result)
                return result
        raise RuntimeError("No free presentation booking slot within the bounded search")

    for i in range(args.orders):
        if i >= len(state["orders"]):
            customer = state["customers"][i % len(state["customers"])]
            asset = state["assets"][i % len(state["assets"])]
            order = api.request("POST", "/api/work-orders", {"title": f"Synthetic presentation {i+1:02}: {['cooling inspection','preventive service','sensor diagnosis','airflow verification'][i % 4]}", "customerId": customer["id"], "serviceLocationId": customer["locations"][0]["id"], "assetId": asset["id"], "teamId": "north", "serviceCategory": "HVAC", "priority": ["Normal", "High", "Critical", "Low"][i % 4]})
            state["orders"].append({"id": order["id"], "number": order["number"], "kind": "Completed" if i < args.orders - 8 else "Active" if i < args.orders - 2 else "Unassigned"})
            save()
        record = state["orders"][i]
        if record["kind"] == "Unassigned":
            continue
        order = api.request("GET", "/api/work-orders/" + record["id"])
        workflows = api.request("GET", "/api/workflows?workOrderId=" + record["id"])
        if not workflows:
            booking(order)
            wait(lambda: api.request("GET", "/api/work-orders/" + record["id"]).get("technicianId") == technician_id, "booking assignment projection")
            workflow = api.request("POST", "/api/workflows", {"workOrderId": record["id"]})
        else:
            workflow = workflows[0]
        target = 8 if record["kind"] == "Completed" else (i % 4)
        while workflow["status"] == "Active" and workflow["currentStageIndex"] < target:
            index = workflow["currentStageIndex"]
            fields = template["stages"][index]["fields"]
            answers = {}
            for field in fields:
                if field.get("conditionField") and answers.get(field["conditionField"]) != field.get("conditionValue"):
                    continue
                if field.get("inputType") in ("number", "text"):
                    answers[field["key"]] = "45" if field["inputType"] == "number" else "Synthetic demo service evidence. No real customer data."
                    continue
                choices = field["options"]
                answers[field["key"]] = next((choice for choice in ["Accept", "Ready", "Arrived", "Accessible", "Good", "None", "Passed", "Confirmed", "Completed"] if choice in choices), choices[0])
            workflow = api.request("POST", f"/api/workflows/{workflow['id']}/submit", {"expectedVersion": workflow["version"], "idempotencyKey": f"demo-{state['batchId']}-{record['id']}-{index}", "answers": answers, "offline": False})
        record.update(workflowId=workflow["id"], currentStageIndex=workflow["currentStageIndex"], workflowStatus=workflow["status"])
        if record["kind"] == "Active" and not record.get("interventionDone"):
            workflow = api.request("POST", f"/api/workflows/{workflow['id']}/assistance", {"expectedVersion": workflow["version"], "reason": "Synthetic presentation: supervisor review requested."})
            workflow = api.request("POST", f"/api/workflows/{workflow['id']}/pause", {"expectedVersion": workflow["version"], "reason": "Synthetic presentation: approved training review."})
            workflow = api.request("POST", f"/api/workflows/{workflow['id']}/resume", {"expectedVersion": workflow["version"], "reason": "Synthetic presentation: training review completed."})
            record["interventionDone"] = True
        save()
        print(f"Demo work order {i+1}/{args.orders}: {record['kind']}", flush=True)
    ids = {r["id"] for r in state["orders"]}
    notifications = wait(lambda: [n for n in api.request("GET", "/api/notifications") if n["workOrderId"] in ids], "synthetic notifications")
    for notice in notifications[:5]:
        api.request("POST", f"/api/notifications/{notice['id']}/acknowledge")
    state["readyAtUtc"] = datetime.now(timezone.utc).isoformat()
    state["nativeDemoOrder"] = next(r for r in reversed(state["orders"]) if r["kind"] == "Active")
    save()
    print(json.dumps({"synthetic": True, "customers": len(state["customers"]), "assets": len(state["assets"]), "orders": len(state["orders"]), "nativeDemoOrder": state["nativeDemoOrder"], "manifest": str(args.manifest), "notes": "Commands ran at actual server time; scheduled training appointments do not imply historical production activity."}, indent=2))


if __name__ == "__main__":
    main()
