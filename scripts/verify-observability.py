"""Verify actual local Prometheus targets and a retained business-event trace."""
import importlib.util
import json
from datetime import datetime, timezone
from pathlib import Path
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("local_auth", ROOT / "scripts/local-auth.py")
AUTH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUTH)
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def read(url, token=None):
    headers = {"Authorization": "Bearer " + token} if token else {}
    with OPENER.open(urllib.request.Request(url, headers=headers), timeout=15) as response:
        return json.load(response)


def main():
    targets = read("http://localhost:9090/api/v1/targets")["data"]["activeTargets"]
    service_targets = [target for target in targets if target["labels"].get("job") == "fieldops-services"]
    healthy = [target for target in service_targets if target["health"] == "up"]
    if len(healthy) != 6:
        raise RuntimeError(f"Expected six healthy scrape targets, observed {len(healthy)} of {len(service_targets)}")
    token = AUTH.login(ROOT, "supervisor")
    orders = read("http://localhost:5100/api/work-orders", token)
    for order in orders:
        try:
            replay = read("http://localhost:5100/api/replay/" + order["id"], token)
        except urllib.error.HTTPError as error:
            if error.code == 404:
                error.close()
                continue
            raise
        for event in replay["events"]:
            trace_id = event.get("traceId")
            if not trace_id:
                continue
            try:
                traces = read("http://localhost:16686/api/traces/" + trace_id)
            except urllib.error.HTTPError as error:
                error.close()
                continue
            spans = [span for trace in traces.get("data", []) for span in trace.get("spans", [])]
            if spans:
                result = {"healthyScrapeTargets": len(healthy), "businessEventType": event["eventType"],
                          "traceId": trace_id, "retainedSpans": len(spans), "businessRecordedAtUtc": event["recordedAtUtc"],
                          "verifiedAtUtc": datetime.now(timezone.utc).isoformat()}
                (ROOT / "artifacts").mkdir(exist_ok=True)
                (ROOT / "artifacts/observability.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
                print(f"Verified {len(healthy)} healthy service scrape targets and {len(spans)} retained spans for a recorded business event.")
                return
    raise RuntimeError("No retained business-event trace was found. Generate a new authenticated work order and retry after trace export.")


if __name__ == "__main__":
    main()
