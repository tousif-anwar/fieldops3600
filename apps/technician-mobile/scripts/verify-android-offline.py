"""Native Android smoke test against the real local stack and Expo dev client.

Prerequisites: running FieldOps Docker stack, Metro on localhost:8081, an Android
emulator with the FieldOps development build, and a technician already signed in
through Keycloak. Uses labeled synthetic data and restores network connectivity.
No tokens, credentials, customer data, or screenshots are written to the report.

Run from repository root:
  python apps/technician-mobile/scripts/verify-android-offline.py
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import time
import urllib.error
import urllib.request
from uuid import uuid4
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[3]
APP = "com.fieldops360.technician"
BASE = "http://localhost:5100"
SPEC = importlib.util.spec_from_file_location("local_auth", ROOT / "scripts/local-auth.py")
AUTH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUTH)


class NativeCheck:
    def __init__(self, serial: str):
        self.adb = [str(ROOT / ".tools/android-sdk/platform-tools/adb.exe"), "-s", serial]
        self.tokens = {role: AUTH.login(ROOT, role) for role in ("dispatcher", "technician")}
        self.evidence: list[str] = []

    def record(self, message):
        self.evidence.append(message)
        print(message, flush=True)

    def call(self, *args: str) -> bytes:
        return subprocess.run(self.adb + list(args), check=True, capture_output=True, timeout=30).stdout

    def request(self, method: str, path: str, role="technician", data=None, retry_auth=True):
        headers = {"Authorization": "Bearer " + self.tokens[role]}
        if data is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(BASE + path, method=method, headers=headers,
            data=json.dumps(data).encode() if data is not None else None)
        try:
            with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=20) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code != 401 or not retry_auth:
                raise
            error.close()
            self.tokens[role] = AUTH.login(ROOT, role)
            return self.request(method, path, role, data, retry_auth=False)

    def nodes(self):
        self.call("shell", "uiautomator", "dump", "/sdcard/fieldops-native-check.xml")
        raw = self.call("shell", "cat", "/sdcard/fieldops-native-check.xml")
        return list(ET.fromstring(raw).iter("node"))

    @staticmethod
    def label(node):
        return node.get("content-desc") or node.get("text") or ""

    def find(self, text: str, *, prefix=False, attempts=8):
        for _ in range(attempts):
            for node in self.nodes():
                label = self.label(node).casefold()
                if (label.startswith(text.casefold()) if prefix else label == text.casefold()) and node.get("enabled") != "false":
                    return node
            time.sleep(.5)
        raise AssertionError(f"Native control did not appear: {text}")

    def tap(self, text: str, *, prefix=False):
        node = self.find(text, prefix=prefix)
        bounds = list(map(int, re.findall(r"\d+", node.get("bounds", ""))))
        if len(bounds) != 4:
            raise AssertionError(f"Native control has no bounds: {text}")
        self.call("shell", "input", "tap", str((bounds[0] + bounds[2]) // 2), str((bounds[1] + bounds[3]) // 2))

    def wait(self, predicate, description, seconds=30):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if value := predicate():
                return value
            time.sleep(.5)
        raise AssertionError("Timed out waiting for " + description)

    def prepare(self):
        order = self.request("POST", "/api/work-orders", "dispatcher", {
            "title": "Synthetic Android offline verification",
            "customerName": "Synthetic native test customer",
            "siteAddress": "100 Demonstration Avenue, Example City, NY",
            "serviceCategory": "HVAC", "priority": "Normal", "teamId": "north",
            "unregisteredCustomerReason": "Synthetic native runtime verification fixture.",
        })
        # An isolated future day avoids collisions with prior synthetic runs.
        start = (datetime.now(timezone.utc) + timedelta(days=30 + int(uuid4().hex[:4], 16)))
        start = start.replace(hour=15, minute=0, second=0, microsecond=0)
        self.request("POST", "/api/bookings", "dispatcher", {
            "workOrderId": order["id"], "technicianId": "tech-01", "startUtc": start.isoformat(),
            "endUtc": (start + timedelta(hours=1)).isoformat(), "overrideReason": None,
        })
        def assigned():
            try:
                return self.request("GET", "/api/work-orders/" + order["id"])
            except urllib.error.HTTPError as error:
                if error.code == 404:
                    return False
                raise
        self.wait(assigned, "the technician assignment projection")
        workflow = self.request("POST", "/api/workflows", data={"workOrderId": order["id"]})
        if (datetime.fromisoformat(workflow["stages"][0]["deadlineUtc"]) - datetime.now(timezone.utc)).total_seconds() < 300:
            raise AssertionError("Use normal SLA timings for this durability check; accelerated SLA intentionally causes version conflicts.")
        self.record("Created synthetic work, confirmed booking, and workflow through authenticated real APIs.")
        return order, workflow

    def run(self):
        for port in (8080, 8081, 5100):
            self.call("reverse", f"tcp:{port}", f"tcp:{port}")
        self.call("shell", "cmd", "connectivity", "airplane-mode", "disable")
        self.call("shell", "svc", "wifi", "enable")
        order, workflow = self.prepare()
        self.call("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d",
            f"fieldops360:///job/{order['id']}/stage/0")
        self.find("Service checklist", attempts=20)
        self.tap("Assignment.", prefix=True)
        self.tap("Accept")
        self.tap("Readiness.", prefix=True)
        self.tap("Ready")
        self.record("Loaded the real cached assignment and completed stage controls on Android.")
        # The OS connectivity change is observed by NetInfo, not simulated in JS.
        self.call("shell", "cmd", "connectivity", "airplane-mode", "enable")
        self.call("shell", "svc", "wifi", "disable")
        self.find("Queue submission")
        self.tap("Queue submission")
        self.find("Saved on this device", attempts=12)
        server = self.request("GET", "/api/workflows/" + workflow["id"])
        assert server["currentStageIndex"] == 0, "Offline work must not advance authoritative server state"
        self.record("Disabled Android connectivity, queued a stage, and verified the server did not advance.")
        time.sleep(2)  # Query persister throttle must complete before process death.
        self.call("shell", "am", "force-stop", APP)
        self.call("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d",
            "exp+fieldops-technician://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081")
        self.find("Home", attempts=20)
        self.tap("Sync")
        self.find("Waiting to sync")
        self.find("Stage 1")
        self.record("Force-stopped and relaunched the Android app offline; queued answers survived on the Sync screen.")
        self.call("shell", "cmd", "connectivity", "airplane-mode", "disable")
        self.call("shell", "svc", "wifi", "enable")
        self.wait(lambda: self.request("GET", "/api/workflows/" + workflow["id"])["currentStageIndex"] == 1,
            "automatic synchronization after Android reconnect", seconds=45)
        self.find("No queued updates", attempts=15)
        updated = self.request("GET", "/api/workflows/" + workflow["id"])
        assert updated["stages"][0]["answers"] == {"assignment": "Accept", "readiness": "Ready"}
        self.record("Reconnected Android; automatic synchronization advanced exactly one stage and retained the original answers.")
        return {"result": "passed", "platform": "Android emulator", "workOrderId": order["id"],
            "workflowId": workflow["id"], "templateVersion": workflow["templateVersion"], "checks": self.evidence}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", default="emulator-5556")
    args = parser.parse_args()
    check = NativeCheck(args.serial)
    try:
        report = check.run()
        target = ROOT / ".local/mobile-android-offline-verification.json"
        target.parent.mkdir(exist_ok=True)
        target.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(report, indent=2))
    finally:
        check.call("shell", "cmd", "connectivity", "airplane-mode", "disable")
        check.call("shell", "svc", "wifi", "enable")


if __name__ == "__main__":
    main()
