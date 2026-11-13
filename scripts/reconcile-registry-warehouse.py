"""Reconcile local registry analytics using retained original outbox events."""
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def main():
    events = []
    for service in ("customers", "assets"):
        query = '''SELECT coalesce(json_agg("Body"::jsonb ORDER BY "CreatedAtUtc"), '[]'::json) FROM outbox_messages WHERE "Body"::jsonb->>'eventType' IN ('CustomerRegistered.v1','CustomerUpdated.v1','AssetRegistered.v1','AssetUpdated.v1');'''
        result = subprocess.run(["docker", "compose", "exec", "-T", "postgres", "psql", "-X", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "fieldops_" + service], input="BEGIN READ ONLY;\n" + query + "\nROLLBACK;\n", cwd=ROOT, text=True, capture_output=True, check=True)
        lines = [line for line in result.stdout.splitlines() if line.startswith("[")]
        if len(lines) != 1:
            raise RuntimeError("Original outbox archive was not returned")
        events.extend(json.loads(lines[0]))
    result = subprocess.run(["docker", "compose", "run", "--rm", "-T", "--no-deps", "analytics-worker", "python", "ingestion-worker/reconcile_registry.py"], input=json.dumps(events), cwd=ROOT, text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError("Registry reconciliation failed; inspect local diagnostics without publishing credentials or event payloads")
    report = json.loads(next(line for line in result.stdout.splitlines() if line.startswith("{")))
    output = ROOT / "artifacts/data/registry-reconciliation.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
