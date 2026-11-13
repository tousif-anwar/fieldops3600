"""Repair derived registry projections from retained original outbox evidence.

Existing ledger hashes must match; neither original events nor ledger rows are
deleted. A new projection version may have been deployed after a ledger entry.
Only customer/asset registry events are eligible. Caller supplies a bounded
JSON array on stdin; normal restricted warehouse credentials are used.
"""
import hashlib
import json
import os
import sys
from uuid import UUID

import pika
import psycopg
import assets
import customers
import worker


def main():
    raw = sys.stdin.buffer.read(10 * 1024 * 1024 + 1)
    if len(raw) > 10 * 1024 * 1024:
        raise ValueError("Registry reconciliation exceeds 10 MiB")
    events = json.loads(raw)
    if not isinstance(events, list) or len(events) > 10000:
        raise ValueError("Registry reconciliation exceeds 10,000 events")
    repaired = inserted = 0
    identities = set()
    with psycopg.connect(os.environ["WAREHOUSE_DSN"]) as connection:
        connection.execute("SELECT pg_advisory_xact_lock(360004)")
        for event in events:
            kind = event["eventType"]
            owner = "customers" if kind in customers.EVENTS else "assets" if kind in assets.EVENTS else None
            if owner is None or event["sourceService"] != owner or UUID(event["workOrderId"]).int != 0:
                raise ValueError("Reconciliation accepts only owning registry events")
            digest = hashlib.sha256(json.dumps(event, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
            previous = connection.execute("SELECT payload_hash FROM warehouse.ingestion_ledger WHERE event_id=%s", (event["eventId"],)).fetchone()
            if previous and previous[0] != digest:
                raise ValueError("Original registry evidence differs from the ingestion ledger")
            if previous:
                (customers if owner == "customers" else assets).project(connection, event, event["eventPayload"])
                repaired += 1
            else:
                inserted += int(worker.project(connection, event))
            identities.add(str(UUID(event["eventId"])))
    # Republish only the exact original identities just reconciled, with broker
    # confirm before acknowledging their prior error-queue delivery.
    rabbit = pika.BlockingConnection(pika.ConnectionParameters(os.environ.get("RABBITMQ_HOST", "rabbitmq"), credentials=pika.PlainCredentials(os.environ.get("RABBITMQ_USER", "fieldops"), os.environ["RABBITMQ_PASSWORD"])))
    republished = 0
    try:
        channel = rabbit.channel()
        channel.confirm_delivery()
        count = channel.queue_declare(worker.QUEUE + ".error", passive=True).method.message_count
        held = []
        for _ in range(min(count, 10000)):
            method, properties, body = channel.basic_get(worker.QUEUE + ".error", auto_ack=False)
            if method is None:
                break
            envelope = json.loads(body)
            event = envelope.get("message", envelope)
            if str(event.get("eventId")) not in identities:
                held.append(method.delivery_tag)
                continue
            channel.basic_publish("", worker.QUEUE, body, properties=properties, mandatory=True)
            channel.basic_ack(method.delivery_tag)
            republished += 1
        for tag in held:
            channel.basic_nack(tag, requeue=True)
    finally:
        rabbit.close()
    print(json.dumps({"originalRegistryEvents": len(events), "existingEvidenceReconciled": repaired, "missingEvidenceProjected": inserted, "confirmedErrorQueueRedeliveries": republished, "originalsDeleted": False}))


if __name__ == "__main__":
    main()
