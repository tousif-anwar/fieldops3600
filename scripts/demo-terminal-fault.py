"""Exercise a local Notifications poison message and independent replay fault monitor.

Creates synthetic records, preserves/requeues inspected error messages and restores
ordinary Notifications configuration on exit. Requires the local Compose stack.
"""

import base64
import importlib.util
import json
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("local_auth", ROOT / "scripts/local-auth.py")
AUTH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUTH)
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def main():
    tokens = {role: AUTH.login(ROOT, role) for role in ["dispatcher", "technician", "supervisor"]}
    values = AUTH.local_environment(ROOT)
    broker_auth = base64.b64encode(("fieldops:" + values["RABBITMQ_PASSWORD"]).encode()).decode()

    def call(method, path, role="supervisor", body=None, broker=False):
        headers = {"Authorization": "Basic " + broker_auth if broker else "Bearer " + tokens[role]}
        if body is not None:
            headers["Content-Type"] = "application/json"
        url = ("http://localhost:15672" if broker else "http://localhost:5100") + path
        req = urllib.request.Request(
            url,
            method=method,
            headers=headers,
            data=json.dumps(body).encode() if body is not None else None,
        )
        try:
            response = OPENER.open(req, timeout=15)
        except urllib.error.HTTPError as error:
            if error.code == 404:
                error.close()
                return None
            error.close()
            raise RuntimeError(f"Local {method} failed with HTTP {error.code}") from None
        with response:
            raw = response.read()
            return json.loads(raw) if raw else None

    def wait(probe, label, timeout=60):
        until = time.monotonic() + timeout
        while time.monotonic() < until:
            try:
                result = probe()
                if result:
                    return result
            except (urllib.error.URLError, TimeoutError):
                pass
            time.sleep(0.5)
        raise RuntimeError("Timed out waiting for " + label)

    override = ROOT / ".local/compose.terminal-fault.yml"
    override.parent.mkdir(exist_ok=True)
    override.write_text(
        "services:\n  notifications:\n    environment:\n"
        "      Demo__EnableConsumerFailure: 'true'\n"
        "      Demo__AlwaysFailConsumer: 'true'\n"
        "      Demo__FailEventType: AssistanceRequested.v1\n",
        encoding="utf-8",
    )
    command = ["docker", "compose", "-f", str(ROOT / "docker-compose.yml"), "-f", str(override)]
    try:
        subprocess.run(
            command + ["up", "-d", "--no-deps", "notifications"],
            cwd=ROOT,
            check=True,
            timeout=90,
            stdout=subprocess.DEVNULL,
        )
        order = call(
            "POST",
            "/api/work-orders",
            "dispatcher",
            {
                "title": "Synthetic terminal consumer fault investigation",
                "customerName": "Synthetic Customer",
                "siteAddress": "100 Demonstration Avenue",
                "serviceCategory": "HVAC",
                "priority": "Normal",
                "teamId": "north",
            },
        )
        start = (
            datetime.now(timezone.utc) + timedelta(days=10 + int(uuid4().hex[:4], 16) % 1000)
        ).replace(hour=15, minute=0, second=0, microsecond=0)
        call(
            "POST",
            "/api/bookings",
            "dispatcher",
            {
                "workOrderId": order["id"],
                "technicianId": "tech-01",
                "startUtc": start.isoformat(),
                "endUtc": (start + timedelta(hours=1)).isoformat(),
            },
        )
        wait(
            lambda: (
                call("GET", "/api/work-orders/" + order["id"], "dispatcher")["technicianId"]
                == "tech-01"
            ),
            "assignment",
        )
        workflow = call("POST", "/api/workflows", "technician", {"workOrderId": order["id"]})
        path = "/api/workflows/" + workflow["id"]
        call(
            "POST",
            path + "/assistance",
            "technician",
            {
                "expectedVersion": workflow["version"],
                "reason": "Synthetic controlled Notifications failure; review retained evidence",
            },
        )
        print(
            "Created synthetic assistance event; waiting for consumer retry exhaustion.", flush=True
        )
        replay = wait(
            lambda: (
                (r := call("GET", "/api/replay/" + order["id"]))
                and any(e["eventType"] == "DeadLetterRecorded.v1" for e in r["events"])
                and r
            ),
            "independent terminal-fault replay evidence",
        )
        original = next(e for e in replay["events"] if e["eventType"] == "AssistanceRequested.v1")
        diagnostics = [
            e
            for e in replay["events"]
            if e["eventType"] in ["MessageProcessingFailed.v1", "DeadLetterRecorded.v1"]
        ]
        assert len(diagnostics) == 2 and len({e["eventId"] for e in replay["events"]}) == len(
            replay["events"]
        )
        assert all(e["eventPayload"]["consumerService"] == "notifications" for e in diagnostics)
        assert any(
            a["status"] == "DeadLettered"
            and a["consumerService"] == "notifications"
            and a["attempt"] is None
            for a in original["attempts"]
        )
        assert all(e["integrityVerified"] for e in replay["events"])
        # Management's get endpoint requeues inspected messages. Never delete evidence.
        queued = call(
            "POST",
            "/api/queues/%2F/fieldops-notifications-events_error/get",
            body={
                "count": 100,
                "ackmode": "ack_requeue_true",
                "encoding": "auto",
                "truncate": 50000,
            },
            broker=True,
        )
        assert any(
            json.loads(row["payload"]).get("message", {}).get("eventId") == original["eventId"]
            for row in queued
        ), "Original event missing from independently inspected error queue"
        report = {
            "synthetic": True,
            "verifiedAtUtc": datetime.now(timezone.utc).isoformat(),
            "workOrderId": order["id"],
            "originalEventId": original["eventId"],
            "consumerService": "notifications",
            "diagnosticTypes": [e["eventType"] for e in diagnostics],
            "independentErrorQueueVerified": True,
            "inspectedMessagesRequeued": True,
            "retryCountKnown": False,
            "integrityVerified": True,
        }
        (ROOT / "artifacts").mkdir(exist_ok=True)
        (ROOT / "artifacts/demo-terminal-fault.json").write_text(
            json.dumps(report, indent=2) + "\n", encoding="utf-8"
        )
        print(
            "Verified terminal fault, original error-queue message and immutable diagnostics.",
            flush=True,
        )
    finally:
        subprocess.run(
            ["docker", "compose", "up", "-d", "--no-deps", "notifications"],
            cwd=ROOT,
            check=True,
            timeout=90,
            stdout=subprocess.DEVNULL,
        )


if __name__ == "__main__":
    main()
