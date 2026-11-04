# FieldOps 360

A field service operations platform for dispatch, guided HVAC execution, supervisor intervention and historical investigation. Six .NET 10 services support persisted SLA deadlines, constrained scheduling, advisory risk prediction, warehouse analytics and an immutable incident replay console. See [implementation status](docs/IMPLEMENTATION_STATUS.md) for executed evidence and open acceptance items.

## Run locally

Install Docker Engine/Compose with Linux containers and Python 3.11+. Docker builds the application toolchains; local Node/.NET are optional for source development. Allow several minutes and adequate Docker memory for the first build.

```powershell
python scripts/init-local.py
docker compose up -d --build
python scripts/wait-local.py
```

Open **[FieldOps 360](http://localhost:8088)** and choose Sign in. Demo usernames are `dispatcher`, `technician`, `supervisor`, `manager`, `analyst` and `administrator`; the generated password is `DEMO_PASSWORD` in the ignored root `.env`. Identity is real Keycloak Authorization Code + PKCE, with signed roles and team claims. Never commit generated credentials.

For an existing database volume from an earlier revision, run `python scripts/reconcile-database-runtime.py` after `init-local.py`, then `python scripts/reconcile-local-identity.py`, before starting the stack. These preserve existing credentials/data and add runtime grants and identity scopes. See [deployment and recovery](docs/operations/LOCAL_DEPLOYMENT.md).

```powershell
# Optional local monitoring
docker compose --profile monitoring up -d
python scripts/verify-observability.py
# Stop containers while retaining local data
docker compose down
```

Monitoring: [Jaeger](http://localhost:16686), [Prometheus](http://localhost:9090), [Grafana](http://localhost:3000). Grafana and Keycloak administrator credentials are separately generated in `.env`. Only loopback interfaces are published; this is an HTTP development deployment. No external deployment or remote CI success is claimed.

## Try the business flow

1. Dispatcher creates an HVAC order, reviews baseline or optimized recommendations, and books a qualified available technician.
2. Assigned technician starts the workflow, selects accurate dropdown responses, saves drafts, requests assistance, and completes eight ordered stages.
3. Supervisor reviews warnings/breaches, acknowledges alerts, approves pauses or reasoned overrides, and records decisions about advisory risk predictions.
4. Analyst filters warehouse metrics and downloads CSV/PDF reports. Supervisor opens Replay to inspect historical state, causal ordering, delivery attempts and incident exports.

For a reproducible server-side incident, including restart/retry/broker recovery:

```powershell
docker compose -f docker-compose.yml -f infrastructure/docker/compose.demo.yml up -d --no-deps workflows reporting
python scripts/demo-resilience.py
```

This creates labeled synthetic evidence, uses development-only 20/25/30 **second** thresholds, and restores normal settings on exit. Normal stages use 20/25/30 **minutes**. Existing stage deadlines remain persisted when settings change. [Demonstration details](services/OPERATIONS_DEMONSTRATION.md).

## Develop and verify

| Area | Source | Local verification |
|---|---|---|
| Backend | `services/`, `building-blocks/` | `dotnet test tests/backend/FieldOps.Tests.csproj` (.NET 10; Docker for Testcontainers) |
| Gateway | `gateway/` | Real-process security/readiness checks under `tests/backend/` |
| Operations web | [Web guide](apps/web/README.md) | `npm ci`, `npm test`, `npm run build` in `apps/web` |
| Technician app | [Mobile guide](apps/technician-mobile/README.md) | `npm ci`, `npm run check` in `apps/technician-mobile` |
| Live services | `tests/integration/` | `python -m unittest discover -s tests/integration -v` with Compose running |
| Warehouse | [Warehouse guide](analytics/README.md) | 26 PostgreSQL tests, quality checks and archive reconciliation |
| Intelligence | [Intelligence guide](intelligence/README.md) | 18 tests and [measured synthetic evaluation](intelligence/evaluation/REPORT.md) |

[Testing evidence and commands](docs/testing/VERIFICATION.md) distinguish source tests, real service checks, browser tests, native build checks and security scan scope. GitHub Actions configures these command paths; no remote run was initiated here.

## Repository

- `services/`, `building-blocks/`: six ASP.NET Core service hosts and owned state.
- `gateway/`: YARP ingress with token validation.
- `apps/web/`: React operations, supervisor, analyst and replay interfaces.
- `apps/technician-mobile/`: Expo technician app with durable offline drafts and synchronization.
- `intelligence/`: reproducible synthetic SLA prediction and dispatch optimization.
- `infrastructure/`: identity, database, messaging and monitoring configuration.
- `tests/`: automated validation and reproducible integration scenarios.
- `docs/`: architecture, decisions, security, test evidence and operations instructions.

Start with the [documentation index](docs/INDEX.md), [architecture](docs/architecture/overview.md), [security boundaries](docs/security/threat-model.md), [workflow design](docs/workflows/design.md) and [replay evidence model](replay/event-store/README.md).

## Engineering boundaries

Each business service owns a separate PostgreSQL database. Owner credentials are restricted to one-shot migration jobs; runtime identities have limited data permissions. PostgreSQL prevents confirmed booking overlaps. Workflow changes and outbox events commit atomically. RabbitMQ delivery is at least once; consumers deduplicate stable event IDs. A separate Python worker projects redacted events into a seven-dimension/five-fact warehouse. Reporting reads it through a read-only identity and owns append-only replay evidence with separate delivery observations.

The operational OR-Tools adapter evaluates actual scoped availability for one appointment. Real geocoded travel data is unavailable, so its travel estimate is null. A separate synthetic multi-job evaluation compares it with a greedy baseline. The calibrated SLA model is advisory and trained/evaluated on synthetic data; it is not validated for real personnel or service decisions.

Production TLS, retention/backup operations, mobile device policy, full authenticated ASVS review and a complete accessibility assessment require further work. Historical warehouse dimensions use type-1 corrections; time off/weekends are not included in utilization capacity. Known cross-service races and other limits are tracked in the status document.
