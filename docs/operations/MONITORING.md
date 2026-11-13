# Local monitoring access and demonstration

Start the local stack with monitoring:

```powershell
docker compose --profile monitoring up -d
python scripts/verify-observability.py
```

These management interfaces bind to `127.0.0.1` in Compose. Their local credentials are generated in the ignored root `.env`; an existing persistent Grafana or RabbitMQ installation retains its original credentials.

| Tool | Address | Username | Password source |
|---|---|---|---|
| Prometheus | http://localhost:9090 | No login | Not configured on this loopback-only listener |
| Grafana | http://localhost:3000 | `local-admin` | `GRAFANA_PASSWORD` in `.env` |
| RabbitMQ | http://localhost:15672 | `fieldops` | `RABBITMQ_PASSWORD` in `.env` |
| Jaeger | http://localhost:16686 | No login | Not configured on this loopback-only listener |

The local `.local/LOCAL_ACCESS.md` sheet, when generated, contains the actual values. It must remain ignored. A remote deployment needs separate protected management access; these bindings are not a public hosting configuration.

## Prometheus

Open **Status → Targets** and inspect the eight configured service targets. Each should show **UP**. Then run:

```promql
up{job="fieldops-services"}
sum by (instance) (rate(http_requests_received_total[5m]))
sum by (instance) (rate(http_requests_received_total{code=~"5.."}[5m]))
dotnet_total_memory_bytes
```

Create or read an actual work order, wait for the 15-second scrape interval, and refresh the query. Explain that `up=1` proves the scrape succeeded at that observation; it does not certify every business workflow. A five-minute rate needs multiple samples.

## Grafana

Open **Dashboards → FieldOps 360 · Service health**. Choose **Last 15 minutes** and a 15-second refresh. Show scrape availability, request throughput, server errors, managed memory and process CPU. Generate activity through the application, then observe the new samples. Retain real failures in the explanation instead of hiding them with a time filter.

## RabbitMQ

Open **Queues and Streams**. Inspect `fieldops-work-orders-events`, `fieldops-notifications-events`, `fieldops-reporting-events` and `fieldops-warehouse`. Show their consumers, publish/deliver/acknowledgment rates and ready/unacknowledged counts.

Create a synthetic work order and submit a stage. Show that the command persists an outbox record, the broker delivers the event, and reporting/warehouse consumers create independent records. A healthy idle queue often has **0 Ready** because its consumer has acknowledged all messages; zero backlog is not proof that no events flowed.

Retry and error queues retain failure evidence. `scripts/reconcile-registry-warehouse.py` repairs registry projections from exact retained originals and uses broker confirmation before acknowledging eligible error-queue deliveries. It preserves original event IDs and verifies hashes already in the warehouse ledger.

## Suggested short technical demonstration

1. Show the application command and its persisted order ID.
2. Show the matching outbox event and its publication timestamp using a read-only database query.
3. Show RabbitMQ consumers and message rates.
4. Show the order's projected report/Replay and warehouse records.
5. Show the related Prometheus samples and Grafana panels.
6. Use Jaeger for the technical trace while explaining that its in-memory retention is separate from immutable business evidence.

Use the actual feature and verification records. Metrics, queue activity and a successful health check each establish a different boundary.
