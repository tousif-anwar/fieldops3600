# Local deployment and operational runbooks

## Prerequisites and first startup

Use Docker Compose v2 with Linux containers and Python 3.11+. Source development uses .NET 10 LTS, Node 24 and Python 3.14. The Dockerfiles supply their build/runtime toolchains. Android additionally requires Java 17, Android SDK/NDK and an emulator/device; iOS requires macOS/Xcode. Never substitute a preview .NET runtime for the targeted LTS SDK.

From the repository root:

```powershell
python scripts/init-local.py
docker compose up -d --build
python scripts/wait-local.py
python scripts/verify-database-permissions.py
```

The bootstrap generates ignored `.env`, `infrastructure/keycloak/realm.generated.json` and `infrastructure/postgres/init.generated.sql`. Existing values are preserved byte-for-byte; missing runtime credentials are added. PostgreSQL initialization runs only on a new volume. Migration jobs apply versioned SQL before dependent services start; they are expected to exit zero. An exited migration job is not an unhealthy runtime service.

Do not print `docker compose config` or container environments into tickets: interpolation contains credentials. `docker compose ps` and scoped logs are safer status views. Do not run `down -v` on an existing environment; that destroys retained business/audit data.

## Existing volumes and upgrades

Back up the database volume and root `.env` together using an approved secure location. Restoring only one can leave role passwords inconsistent. Keep backup material outside Git.

```powershell
python scripts/init-local.py
# PostgreSQL must be running for reconciliation.
docker compose up -d postgres
python scripts/reconcile-database-runtime.py
# Keycloak must be ready for identity scope reconciliation.
docker compose up -d keycloak
python scripts/reconcile-local-identity.py
docker compose up -d --build
python scripts/wait-local.py
```

Database reconciliation creates missing app identities and grants without deleting data, changing existing owner passwords or rewriting migration history. Services have one restricted `_app` identity each. The warehouse has a writer and separate read-only reporting identity. Schema owners are supplied only to migration jobs. `scripts/verify-database-permissions.py` checks actual container DSNs and live prohibited operations, including immutable replay tables.

Migration files are append-only after use. Make a new migration instead of editing a ledger-applied file. Do not reuse the same image tag for unrelated code; application images use explicit `fieldops360-<component>:local` tags. For a bad application revision, rebuild the previous known source revision in an isolated checkout. A schema downgrade/restore is a separate operation requiring a tested backup; changing an image does not reverse SQL.

## Local endpoints and identities

| Endpoint | Purpose |
|---|---|
| `http://localhost:8088` | Served React app; same-origin API/hub proxy |
| `http://localhost:5100` | Authenticated YARP gateway |
| `http://localhost:8080` | Keycloak realm and administrator console |
| `http://localhost:15672` | RabbitMQ management |
| `http://localhost:16686` | Jaeger, monitoring profile |
| `http://localhost:9090` | Prometheus, monitoring profile |
| `http://localhost:3000` | Grafana, monitoring profile |

Demo users share the locally generated `DEMO_PASSWORD`; the administrator console instead uses `local-admin` and `KEYCLOAK_ADMIN_PASSWORD`. Grafana uses `admin` and `GRAFANA_PASSWORD`; RabbitMQ uses `fieldops` and `RABBITMQ_PASSWORD`. These are development identities only. Production needs TLS, managed secrets, rotation, MFA/device policy and distinct least-privilege administrative identities.

Keep `localhost` consistent across browser origin, issuer and redirect URLs. Vite development uses port 5173; Compose uses 8088. Keycloak public clients require code flow/S256 PKCE; password grant is disabled. Existing realms may need `reconcile-local-identity.py` to restore the built-in `basic` scope so subject claims are issued.

## Readiness and observability

`/health/live` indicates a responding process; `/health/ready` checks owned dependencies. The gateway readiness aggregates six upstream service checks. These endpoints do not grant business access. Internal services and databases are not published to the host.

```powershell
docker compose --profile monitoring up -d
python scripts/verify-observability.py
docker compose ps --all
docker compose logs --tail 80 workflows reporting analytics-worker
```

Prometheus scrapes the six service targets. Grafana provisioning is under `infrastructure/monitoring/`. Jaeger stores at most 10,000 traces in memory: restarting it loses spans. Replay metadata remains retained. The authorized replay trace-availability endpoint verifies order/team membership before checking Jaeger; a missing span is explicitly unavailable. Direct Jaeger access is a separate local engineering surface, not an application permission boundary.

## Broker outage, poison messages and replay recovery

Business writes commit state and outbox together. During broker outage, report/notification/warehouse views can lag. Restore RabbitMQ, observe outbox recovery and inspect persisted history before retrying a user action. Reuse an operation's idempotency key when retrying its identical submission.

MassTransit uses bounded retries and `<endpoint>_error` queues. Preserve failing message IDs, original envelopes and headers. Reporting's fault monitor records sanitized terminal-fault diagnostics independently of the business event. A separate successful reporting delivery does not mean a failed Notifications consumer recovered. Do not purge error queues to make dashboards appear healthy. Fix the cause, remove development failure flags, and review any replay/republication of an original ID; downstream consumers must deduplicate it.

`scripts/demo-resilience.py` safely automates the local restart/retry/broker scenario after applying `compose.demo.yml` and restores ordinary workflow/reporting configuration in `finally`. It leaves labeled synthetic records and writes ignored JSON evidence. [Detailed procedure](../../services/OPERATIONS_DEMONSTRATION.md).

Administrator replay projection rebuild reconstructs read state from immutable stored originals. It does not resend operational commands or edit original evidence. Investigate integrity failures before rebuilding. Warehouse archive recovery is separate; follow [backfill and reconciliation](../../analytics/README.md).

## Troubleshooting

| Symptom | Check / resolution |
|---|---|
| Sign-in loops or missing subject | Consistent localhost issuer/callback; Keycloak `basic` scope; run identity reconciliation for old realm |
| Migration exits nonzero | Scoped migration logs, PostgreSQL readiness, owner credential match and migration ledger; preserve data |
| Permission denied after upgrade | Run non-destructive runtime reconciliation before restarting jobs |
| 409 on submit | Refresh authoritative workflow; inspect stage/version and queued conflicts; do not silently rebase |
| 409 on booking | Confirm overlap, qualifications, time off, hours and duplicate-order constraint |
| Scheduled order cannot cancel | Cancel its booking, wait for Created projection, then cancel order |
| Dashboard behind command result | Eventual consistency; check broker/outbox/inbox/warehouse freshness |
| Predict/optimize 404 | Inspect service image tag/command; rebuild `intelligence`, preserve explicit local tag |
| Trace unavailable | Monitoring profile running; trace retention; use replay correlation metadata independently |
| Mobile cannot reach APIs | Development cleartext flag, matching issuer and emulator `adb reverse` ports |

No production backup restore drill, disaster recovery objective, automated dead-letter repair or external deployment has been validated. Keep those acceptance items explicit when choosing a real hosting target.
