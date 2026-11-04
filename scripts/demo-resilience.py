"""Reproduce accelerated SLA/retry/restart/broker recovery using real local services.

Run after applying infrastructure/docker/compose.demo.yml. Restores normal settings on exit.
Creates labeled synthetic records and preserves their audit evidence.
"""
from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.request
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("local_auth", ROOT / "scripts/local-auth.py")
AUTH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUTH)
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
BASE = "http://localhost:5100"
COMPOSE = ["docker", "compose", "-f", str(ROOT / "docker-compose.yml"), "-f", str(ROOT / "infrastructure/docker/compose.demo.yml")]


class TemporarilyUnavailable(Exception):
    pass


def compose(*args, demo=True):
    command = COMPOSE if demo else ["docker", "compose", "-f", str(ROOT / "docker-compose.yml")]
    subprocess.run(command + list(args), cwd=ROOT, check=True, timeout=90, stdout=subprocess.DEVNULL)


def main():
    tokens = {role: AUTH.login(ROOT, role) for role in ["dispatcher", "technician", "supervisor"]}

    def request(method, path, role="dispatcher", body=None, allowed=(200,)):
        headers = {"Authorization": "Bearer " + tokens[role]}
        if body is not None:
            headers["Content-Type"] = "application/json"
        message = urllib.request.Request(BASE + path, method=method, headers=headers,
                                         data=json.dumps(body).encode() if body is not None else None)
        try:
            response = OPENER.open(message, timeout=15)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            data = response.read()
            status = response.code
            if status in (502, 503, 504) and status not in allowed:
                raise TemporarilyUnavailable(f"{method} {path}: HTTP {status}")
            if status not in allowed:
                raise RuntimeError(f"{method} {path}: unexpected HTTP {status}")
            return json.loads(data) if data else None

    def wait(probe, description, timeout=45):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                result = probe()
            except (OSError, TemporarilyUnavailable):
                result = None
            if result:
                return result
            time.sleep(0.3)
        raise RuntimeError("Timed out waiting for " + description)

    def new_order(title):
        return request("POST", "/api/work-orders", body={"title": title, "customerName": "Synthetic Demo Customer",
                       "siteAddress": "100 Demonstration Avenue", "serviceCategory": "HVAC", "priority": "High", "teamId": "north"}, allowed=(201,))

    evidence = {"synthetic": True, "startedAtUtc": datetime.now(timezone.utc).isoformat()}
    broker_stopped = False
    try:
        order = new_order("Synthetic SLA incident and controlled retry")
        start = (datetime.now(timezone.utc) + timedelta(days=2 + int(uuid4().hex[:4], 16) % 500)).replace(hour=15, minute=0, second=0, microsecond=0)
        request("POST", "/api/bookings", body={"workOrderId": order["id"], "technicianId": "tech-01",
                "startUtc": start.isoformat(), "endUtc": (start + timedelta(hours=1)).isoformat()}, allowed=(201,))
        wait(lambda: request("GET", "/api/work-orders/" + order["id"])["technicianId"] == "tech-01", "assignment")
        workflow = request("POST", "/api/workflows", "technician", {"workOrderId": order["id"]}, allowed=(200, 201))
        path = "/api/workflows/" + workflow["id"]
        template = request("GET", "/api/workflows/templates/default", "technician")
        duration = (datetime.fromisoformat(workflow["stages"][0]["deadlineUtc"]) - datetime.fromisoformat(workflow["stages"][0]["startedAtUtc"])).total_seconds()
        if duration != 30:
            raise RuntimeError("Apply the explicit local demonstration override first; expected a 30-second persisted stage deadline.")
        workflow = request("POST", path + "/submit", "technician", {"expectedVersion": workflow["version"], "idempotencyKey": str(uuid4()), "answers": {"assignment": "Accept", "readiness": "Ready"}})
        print("Created a synthetic assigned workflow; restarting its service to verify persisted deadline recovery.", flush=True)
        compose("restart", "workflows")
        wait(lambda: request("GET", path, "technician")["stages"][1]["slaStatus"] == "Breached", "server warning/critical/breach thresholds after restart", 50)
        workflow = request("GET", path, "technician")
        print("The server recorded an overdue stage after restart; checking supervisor delivery and intervention.", flush=True)
        alerts = wait(lambda: [alert for alert in request("GET", "/api/notifications", "supervisor") if alert["workOrderId"] == order["id"]], "persisted supervisor escalation")
        request("POST", "/api/notifications/" + alerts[0]["id"] + "/acknowledge", "supervisor")
        workflow = request("POST", path + "/pause", "supervisor", {"expectedVersion": workflow["version"], "reason": "Synthetic supervisor safety intervention"})
        workflow = request("POST", path + "/resume", "supervisor", {"expectedVersion": workflow["version"], "reason": "Synthetic safety review complete"})
        assert workflow["stages"][1]["slaStatus"] == "Breached", "Approved pause must preserve earlier breach evidence"
        stage_start = datetime.fromisoformat(workflow["stages"][1]["startedAtUtc"])
        features = {"serviceCategory": "HVAC", "stageIndex": 1, "technicianWorkload": 1,
                    "historicalStageDurationMinutes": 30, "elapsedMinutes": (datetime.now(timezone.utc) - stage_start).total_seconds() / 60,
                    "progress": 0.5, "priority": "High", "previousDelays": 1, "equipmentCategory": "Residential"}
        prediction = request("POST", "/api/intelligence/predict", "supervisor", features)
        workflow = request("POST", path + "/interventions", "supervisor", {"expectedVersion": workflow["version"], "modelVersion": prediction["modelVersion"],
                           "breachRisk": prediction["breachRisk"], "decision": "Accepted", "reason": "Synthetic advisory review; contact technician",
                           "predictedAtUtc": prediction["predictedAtUtc"], "features": {key: str(value) for key, value in features.items()}})
        for index in range(1, 8):
            workflow = request("GET", path, "technician")
            answers = {}
            choices = {"travelStatus": "Arrived", "partsRequired": "No", "partsStatus": "Not Required", "followUpRequired": "No"}
            for field in template["stages"][index]["fields"]:
                if not field.get("conditionField") or answers.get(field["conditionField"]) == field.get("conditionValue"):
                    answers[field["key"]] = choices.get(field["key"], field["options"][0])
            workflow = request("POST", path + "/submit", "technician", {"expectedVersion": workflow["version"], "idempotencyKey": str(uuid4()), "answers": answers,
                               "offline": index == 2, "clientOccurredAtUtc": datetime.now(timezone.utc).isoformat()})
        replay_path = "/api/replay/" + order["id"]
        replay = wait(lambda: (result := request("GET", replay_path, "supervisor")) and result["state"]["status"] == "Completed" and result, "completed replay projection")
        events = replay["events"]
        warning = next(event for event in events if event["eventType"] == "StageWarningRaised.v1")
        assert any(attempt["status"] == "Failed" for attempt in warning["attempts"]), "Expected a controlled failed delivery attempt"
        assert any(attempt["status"] == "Processed" for attempt in warning["attempts"]), "Expected successful retry"
        assert len(events) == len({event["eventId"] for event in events}), "Duplicate logical business events"
        assert replay["summary"]["breachCount"] >= 1
        assert all(event["integrityVerified"] for event in events)
        evidence.update({"workOrderId": order["id"], "workflowId": workflow["id"], "stageDeadlineRecovered": True,
                         "controlledRetryVerified": True, "breachCount": replay["summary"]["breachCount"],
                         "incidentSummary": replay["summary"], "distinctBusinessEvents": len(events),
                         "prediction": {key: prediction[key] for key in ["modelVersion", "syntheticTraining", "advisory"]}})
        print("Verified warning retry, breach, supervisor actions, advisory decision and completed immutable replay. Testing broker recovery.", flush=True)
        compose("stop", "rabbitmq")
        broker_stopped = True
        outage = new_order("Synthetic work order committed during broker outage")
        missing = request("GET", "/api/replay/" + outage["id"], "supervisor", allowed=(404,))
        compose("start", "rabbitmq")
        broker_stopped = False
        recovered = wait(lambda: (result := request("GET", "/api/replay/" + outage["id"], "supervisor", allowed=(200, 404))) and
                         result.get("events") and result, "outbox recovery after broker restart", 60)
        assert sum(event["eventType"] == "WorkOrderCreated.v1" for event in recovered["events"]) == 1
        evidence.update({"outageWorkOrderId": outage["id"], "outboxRecoveryVerified": True, "finishedAtUtc": datetime.now(timezone.utc).isoformat()})
        (ROOT / "artifacts").mkdir(exist_ok=True)
        (ROOT / "artifacts/demo-resilience.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
        (ROOT / ".local/demo.json").write_text(json.dumps({"workOrderId": order["id"], "workflowId": workflow["id"]}) + "\n", encoding="utf-8")
        print("Local resilience demonstration passed. Evidence saved in artifacts/demo-resilience.json.", flush=True)
    finally:
        if broker_stopped:
            compose("start", "rabbitmq")
        compose("up", "-d", "--no-deps", "workflows", "reporting", demo=False)


if __name__ == "__main__":
    main()
