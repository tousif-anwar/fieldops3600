"""Read-only proof of recent owner outbox delivery through RabbitMQ to reporting.

Run after the synthetic inventory/contract workflows. No messages are injected,
records replayed, or credentials printed. This is local broker evidence only.
"""
import json
from pathlib import Path
import subprocess
import time
from uuid import UUID

ROOT = Path(__file__).resolve().parents[1]


def query(owner, expression):
    result = subprocess.run(
        ["docker", "compose", "exec", "-T", "postgres", "psql", "-X", "-tAc", expression,
         "-U", f"fieldops_{owner}_app", "-d", f"fieldops_{owner}", "-v", "ON_ERROR_STOP=1"],
        cwd=ROOT, capture_output=True, text=True, check=True,
    )
    return json.loads(result.stdout.strip())


def main():
    evidence = {}
    for owner in ("inventory", "customers"):
        rows = query(owner, """SELECT coalesce(json_agg(e), '[]'::json) FROM (
            SELECT "Id" AS id, "Body"->>'eventType' AS type,
                   "PublishedAtUtc" IS NOT NULL AS published
            FROM outbox_messages WHERE "CreatedAtUtc">now()-interval '24 hours'
            ORDER BY "CreatedAtUtc" DESC LIMIT 20) e""")
        if not rows:
            raise RuntimeError(f"Run the live synthetic {owner} workflow first; no recent owner events exist.")
        identifiers = [str(UUID(row["id"])) for row in rows]
        sql_ids = ",".join(f"'{value}'::uuid" for value in identifiers)
        deadline = time.monotonic() + 30
        while True:
            published = query(owner, f"""SELECT count(*) FROM outbox_messages
                WHERE "Id" IN ({sql_ids}) AND "PublishedAtUtc" IS NOT NULL""")
            retained = query("reporting", f"""SELECT count(*) FROM audit_events
                WHERE "EventId" IN ({sql_ids}) AND "SourceService"='{owner}'""")
            inbox = query("reporting", f"""SELECT count(*) FROM inbox_messages
                WHERE "Id" IN (SELECT 'reporting:'||"EventId"::text FROM audit_events WHERE "EventId" IN ({sql_ids}))""")
            if published == retained == inbox == len(identifiers):
                break
            if time.monotonic() >= deadline:
                raise RuntimeError(f"{owner} delivery incomplete: {published} published, {retained} audited, {inbox} inbox, {len(identifiers)} expected.")
            time.sleep(0.5)
        evidence[owner] = {"published": published, "audited": retained, "inbox": inbox,
                           "eventTypes": sorted({row["type"] for row in rows})}
    print(json.dumps(evidence, indent=2))
    print("Verified recent owner outbox publication and one reporting audit/inbox row per event through the running local broker.")


if __name__ == "__main__":
    main()
