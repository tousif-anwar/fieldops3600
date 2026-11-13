"""Real Android logout/PKCE-login regression check using the local identity form.

Requires the installed native app open on Home and adb reverse for identity/API.
Never logs credentials, callback queries, tokens or form contents. Does not clear
app data: existing account-scoped drafts and the installed build are preserved.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess
import time
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", default="emulator-5556")
    parser.add_argument("--cycles", type=int, default=3)
    args = parser.parse_args()
    if not 1 <= args.cycles <= 5:
        raise SystemExit("Choose 1–5 complete auth cycles")
    adb = [str(ROOT / ".tools/android-sdk/platform-tools/adb.exe"), "-s", args.serial]
    values = dict(line.split("=", 1) for line in (ROOT / ".env").read_text().splitlines() if line and not line.startswith("#"))
    output = ROOT / "artifacts/native-auth"
    output.mkdir(parents=True, exist_ok=True)

    def call(*command):
        result = subprocess.run(adb + list(command), capture_output=True, check=False, timeout=20)
        if result.returncode:
            raise RuntimeError("Android control command failed; credentials and raw command omitted")
        return result.stdout

    def tree():
        for _ in range(4):
            try:
                result = call("shell", "uiautomator", "dump", "/sdcard/fieldops-auth-smoke.xml")
            except RuntimeError:
                time.sleep(0.2)
                continue
            if b"dumped to" in result:
                return list(ET.fromstring(call("shell", "cat", "/sdcard/fieldops-auth-smoke.xml")).iter("node"))
        raise RuntimeError("Android UI is busy; no stale tree was used")

    def label(node):
        return (node.get("text") or "") + " " + (node.get("content-desc") or "")

    def wait(predicate, description, timeout=65):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            nodes = tree()
            if any("Unmatched Route" in label(n) for n in nodes):
                raise RuntimeError("Unmatched Route observed during " + description)
            result = predicate(nodes)
            if result is not None and result is not False:
                return result
        raise RuntimeError("Timed out waiting for " + description)

    def find(nodes, name):
        return next((n for n in nodes if n.get("text") == name or n.get("content-desc") == name), None)

    def tap(node):
        bounds = [int(n) for n in re.findall(r"\d+", node.get("bounds", ""))]
        if len(bounds) != 4 or bounds[2] <= bounds[0] or bounds[3] <= bounds[1]:
            raise RuntimeError("Expected visible Android control has no usable bounds")
        call("shell", "input", "tap", str((bounds[0] + bounds[2]) // 2), str((bounds[1] + bounds[3]) // 2))

    def home(nodes):
        # Home can retain a scroll position, so a greeting need not be visible.
        return any("Good morning," in label(n) or "Good afternoon," in label(n) or "Good evening," in label(n) or n.get("text") in {"Current job", "Assistance and alerts"} for n in nodes) and find(nodes, "Account") is not None

    def focus(identifier):
        tap(wait(lambda nodes: next((n for n in nodes if n.get("resource-id") == identifier), None), identifier + " field"))
        return wait(lambda nodes: next((n for n in nodes if n.get("resource-id") == identifier and n.get("focused") == "true"), None), identifier + " input focus")

    def screenshot(name):
        remote = "/sdcard/" + name
        call("shell", "screencap", "-p", remote)
        call("pull", remote, str(output / name))

    results = []
    try:
        for cycle in range(1, args.cycles + 1):
            nodes = wait(lambda nodes: nodes if find(nodes, "Account") is not None or find(nodes, "Sign out") is not None else None, "signed-in app")
            if find(nodes, "Sign out") is None:
                tap(find(nodes, "Account"))
            print(f"Cycle {cycle}: signing out from Account", flush=True)
            tap(wait(lambda nodes: find(nodes, "Sign out"), "Account sign-out"))
            tap(wait(lambda nodes: find(nodes, "Continue to secure sign in"), "signed-out login screen"))
            form = wait(lambda nodes: nodes if any(n.get("resource-id") == "kc-login" for n in nodes) else None, "real Keycloak login form")
            print(f"Cycle {cycle}: real identity form opened", flush=True)
            focus("username")
            call("shell", "input", "keyevent", "123")
            call("shell", "input", "keyevent", *("67" for _ in range(100)))
            call("shell", "input", "text", "technician")
            # Opening the keyboard scrolls the browser form. Re-read its bounds
            # before focusing the password; pre-keyboard coordinates are stale.
            # Native keyboard navigation follows the form's actual focus order
            # and avoids coordinates shifted by the Android keyboard.
            call("shell", "input", "keyevent", "61")
            wait(lambda nodes: next((n for n in nodes if n.get("resource-id") == "password" and n.get("focused") == "true"), None), "password input focus")
            call("shell", "input", "text", values["DEMO_PASSWORD"])
            call("shell", "input", "keyevent", "66")
            wait(home, "automatic Home after PKCE callback")
            screenshot(f"cycle-{cycle}-home.png")
            results.append({"cycle": cycle, "signedOut": True, "keycloakFormSubmitted": True, "automaticHome": True, "unmatchedRoute": False})
            print(f"Native authentication cycle {cycle}/{args.cycles} passed: logout, real login, automatic Home", flush=True)
        evidence = {"capturedAtUtc": datetime.now(timezone.utc).isoformat(), "serial": args.serial, "cycles": results, "passed": len(results) == args.cycles, "appDataCleared": False}
    except Exception as error:
        screenshot("failure.png")
        evidence = {"capturedAtUtc": datetime.now(timezone.utc).isoformat(), "serial": args.serial, "cycles": results, "passed": False, "error": str(error)}
        (output / "result.json").write_text(json.dumps(evidence, indent=2) + "\n")
        raise
    (output / "result.json").write_text(json.dumps(evidence, indent=2) + "\n")


if __name__ == "__main__":
    main()
