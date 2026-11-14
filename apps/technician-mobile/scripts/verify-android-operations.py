"""Real Android offer-response and guided-service verification.

Uses the prerequisites from verify-android-offline.py. Run from repository root:
  python apps/technician-mobile/scripts/verify-android-operations.py
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
import re
import time
from uuid import uuid4

SPEC = importlib.util.spec_from_file_location("native_offline", Path(__file__).with_name("verify-android-offline.py"))
NATIVE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(NATIVE)


class OperationsCheck(NATIVE.NativeCheck):
    def visible(self, text, *, prefix=False, editable=False):
        for _ in range(10):
            for node in self.nodes():
                label = self.label(node).casefold()
                if (label.startswith(text.casefold()) if prefix else label == text.casefold()) and node.get("enabled") != "false" and (not editable or node.get("class") == "android.widget.EditText"):
                    bounds = list(map(int, re.findall(r"\d+", node.get("bounds", ""))))
                    if len(bounds) == 4 and bounds[3] > bounds[1]:
                        return node
            self.call("shell", "input", "swipe", "530", "1800", "530", "680", "250")
        raise AssertionError("Native visible control unavailable: " + text)

    def tap_visible(self, text, *, prefix=False, editable=False):
        node = self.visible(text, prefix=prefix, editable=editable)
        bounds = list(map(int, re.findall(r"\d+", node.get("bounds", ""))))
        self.call("shell", "input", "tap", str((bounds[0] + bounds[2]) // 2), str((bounds[1] + bounds[3]) // 2))

    def open(self, path):
        self.call("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", "fieldops360:///" + path)

    def create_offer(self):
        order = self.request("POST", "/api/work-orders", "dispatcher", {
            "title": "Synthetic Android assignment offer verification",
            "customerName": "Synthetic native test customer", "siteAddress": "100 Demonstration Avenue, Example City, NY",
            "serviceCategory": "HVAC", "priority": "High", "teamId": "north",
            "unregisteredCustomerReason": "Synthetic native runtime verification fixture.",
        })
        start = (datetime.now(timezone.utc) + timedelta(days=30 + int(uuid4().hex[:4], 16))).replace(hour=15, minute=0, second=0, microsecond=0)
        offer = self.request("POST", "/api/assignment-offers", "dispatcher", {
            "workOrderId": order["id"], "technicianId": "tech-01", "startUtc": start.isoformat(),
            "endUtc": (start + timedelta(hours=1)).isoformat(),
            "expiresAtUtc": (datetime.now(timezone.utc) + timedelta(minutes=25)).isoformat(), "idempotencyKey": str(uuid4()),
        })
        return order, offer

    def set_text(self, label, value):
        self.tap_visible(label + ", required", editable=True)
        self.call("shell", "input", "text", value.replace(" ", "%s"))
        self.call("shell", "input", "keyevent", "4")

    def run_operations(self):
        for port in (8080, 8081, 5100):
            self.call("reverse", f"tcp:{port}", f"tcp:{port}")
        if any(self.label(node) == "Accept this appointment?" for node in self.nodes()):
            self.tap("Keep reviewing")
        accepted_order, accepted = self.create_offer()
        self.open("offer/" + accepted["id"])
        self.find(accepted["workOrderNumber"], attempts=20)
        self.tap_visible("Accept appointment")
        self.find("Accept this appointment?")
        self.tap("Accept appointment")
        self.find("Assignment confirmed", attempts=20)
        self.wait(lambda: self.request("GET", "/api/work-orders/" + accepted_order["id"])["technicianId"] == "tech-01", "accepted assignment projection")
        bookings = self.request("GET", "/api/bookings")
        assert len([booking for booking in bookings if booking["workOrderId"] == accepted_order["id"] and booking["status"] == "Confirmed"]) == 1
        self.record("Accepted an offer using native controls and confirmed exactly one real booking plus technician assignment.")

        declined_order, declined = self.create_offer()
        self.open("offer/" + declined["id"])
        self.find(declined["workOrderNumber"], attempts=20)
        self.tap_visible("Reason for declining", editable=True)
        self.call("shell", "input", "text", "Synthetic%svehicle%sequipment%sconflict")
        self.call("shell", "input", "keyevent", "4")
        self.tap_visible("Decline with reason")
        self.find("Decline this offer?")
        self.tap("Decline offer")
        self.find("Decline recorded", attempts=20)
        offers = self.request("GET", "/api/assignment-offers")
        recorded = next(offer for offer in offers if offer["id"] == declined["id"])
        assert recorded["status"] == "Declined" and recorded["reason"] == "Synthetic vehicle equipment conflict"
        assert not any(booking["workOrderId"] == declined_order["id"] and booking["status"] == "Confirmed" for booking in self.request("GET", "/api/bookings"))
        self.record("Declined a second offer through native confirmation; recorded the reason with no booking created.")

        # Advance a new v2 workflow using actual native template-driven forms.
        workflow = self.request("POST", "/api/workflows", data={"workOrderId": accepted_order["id"]})
        template = self.request("GET", "/api/workflows/templates/" + str(workflow["templateVersion"]))
        self.open(f"job/{accepted_order['id']}/stage/{workflow['currentStageIndex']}")
        values = {
            "assignment": "Accept", "readiness": "Ready", "travelStatus": "Arrived", "siteAccess": "Accessible",
            "equipmentCondition": "Good", "visibleDamage": "None", "safetyConcern": "None",
            "problemCategory": "Electrical", "severity": "Low", "rootCause": "Wear", "partsRequired": "No",
            "diagnosisNotes": "Synthetic inspection found worn electrical contacts.",
            "action": "Clean", "partsStatus": "Not Required", "repairResult": "Successful",
            "workPerformed": "Synthetic contacts cleaned and equipment tested.", "laborMinutes": "30.5",
            "functionalTest": "Pass", "safetyVerification": "Pass", "equipmentOperational": "Yes",
            "customerAvailable": "Yes", "customerInformed": "Yes", "serviceAccepted": "Yes",
            "outcome": "Resolved", "equipmentStatus": "Operational", "followUpRequired": "No",
            "completionRecommendations": "Synthetic routine maintenance advised.",
        }
        for stage in template["stages"]:
            # The app navigates after its query refresh has finished. A competing
            # deep link here can unmount a just-opened native dropdown.
            self.find(stage["name"], attempts=20)
            self.find(f"Stage {stage['index'] + 1} of {len(template['stages'])}", attempts=20)
            self.find("Service checklist", attempts=20)
            time.sleep(.5)
            for field in stage["fields"]:
                if field.get("conditionField") and values.get(field["conditionField"]) != field.get("conditionValue"):
                    continue
                value = values[field["key"]]
                if field.get("inputType", "choice") == "choice":
                    self.tap_visible(field["label"] + ".", prefix=True)
                    self.tap(value)
                    self.wait(lambda: any(self.label(node) == field["label"] + ". " + value for node in self.nodes()),
                        "the selected native checklist answer")
                else:
                    self.set_text(field["label"], value)
            self.tap_visible("Submit & continue")
            target_index = stage["index"] + 1
            workflow = self.wait(lambda: (current := self.request("GET", "/api/workflows/" + workflow["id"]))
                and (current["currentStageIndex"] == target_index or current["status"] == "Completed") and current,
                "native stage submission", seconds=45)
            print(f"Android stage {stage['index'] + 1} accepted by the server.", flush=True)
            if target_index < len(template["stages"]):
                self.find(template["stages"][target_index]["name"], attempts=20)
        assert workflow["status"] == "Completed"
        assert workflow["stages"][4]["answers"]["laborMinutes"] == "30.5"
        self.record("Completed all eight v2 stages through Android controls, including diagnosis text, service evidence, decimal labor, and final recommendations.")
        return {"result": "passed", "platform": "Android emulator", "workOrderId": accepted_order["id"],
            "workflowId": workflow["id"], "templateVersion": workflow["templateVersion"], "checks": self.evidence}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", default="emulator-5556")
    args = parser.parse_args()
    check = OperationsCheck(args.serial)
    report = check.run_operations()
    target = NATIVE.ROOT / ".local/mobile-android-operations-verification.json"
    target.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
