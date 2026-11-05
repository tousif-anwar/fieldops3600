# Installation and local operations

This is the authoritative setup guide for a new engineer. It covers a fresh Docker Compose environment, source development, verification, upgrades, and the safe boundaries around local data. The deeper production-boundary and recovery notes remain in [LOCAL_DEPLOYMENT.md](operations/LOCAL_DEPLOYMENT.md).

## 1. Prerequisites

| Tool | Version | Needed for |
|---|---|---|
| Docker Desktop or Docker Engine + Compose v2 | Linux containers; current stable | The complete local stack |
| Python | 3.11 or newer | Bootstrap, readiness, reconciliation, integration checks |
| .NET SDK | **10.0 LTS** (not an 11 preview) | Backend source builds and tests |
| Node.js | 24 LTS | Web and Expo source builds |
| Java + Android SDK | Current compatible toolchain | Native Android build only |
| Git | Current | Repository checkout |

Give Docker at least 8 GB of memory. The first image build compiles six .NET services, the gateway, the web app, and the Python images. Docker supplies the .NET, Node, and Python build toolchains inside the images; local SDKs are only needed for source-level checks.

> The local stack publishes only loopback interfaces. It is an HTTP development environment, not a production deployment. Do not expose these ports to an untrusted network.

## 2. Fresh installation

From the repository root:

```bash
python scripts/init-local.py
docker compose up -d --build
python scripts/wait-local.py
python scripts/verify-database-permissions.py
```

`init-local.py` creates ignored local state:

- `.env` with generated development credentials.
- `infrastructure/keycloak/realm.generated.json` with the six demo identities and role/team claims.
- `infrastructure/postgres/init.generated.sql` with service owners, restricted runtime identities, and grants.

It preserves existing values and never prints secret values. Do not commit, paste, or screenshot these generated files.

`wait-local.py` polls Keycloak discovery, gateway readiness, and the web entry point for up to 180 seconds. An exited migration job is expected after it applies its migration; the runtime service should remain up. Inspect with:

```bash
docker compose ps --all
```

Open **http://localhost:8088**. Select **Continue to secure sign-in** and use one of the generated accounts:

| Username | Application role |
|---|---|
| `technician` | Technician |
| `dispatcher` | Dispatcher |
| `supervisor` | Supervisor |
| `manager` | Operations Manager |
| `analyst` | Analyst |
| `administrator` | Administrator |

The shared local password is `DEMO_PASSWORD` in the ignored root `.env`. Never reproduce it in documentation, logs, tickets, or browser fixtures.

## 3. Endpoints

| Endpoint | Purpose |
|---|---|
| `http://localhost:8088` | Production-like web container with same-origin API and hub proxy |
| `http://localhost:5173` | Vite development server when started separately |
| `http://localhost:5100` | Authenticated YARP gateway |
| `http://localhost:8080` | Keycloak realm and administration console |
| `http://localhost:15672` | RabbitMQ management |
| `http://localhost:16686` | Jaeger, monitoring profile |
| `http://localhost:9090` | Prometheus, monitoring profile |
| `http://localhost:3000` | Grafana, monitoring profile |

Business services and PostgreSQL are not published to the host. The browser talks to the gateway through the web container's `/api` and `/hubs` proxy.

## 4. Source development

### Web portal

```bash
cd apps/web
npm ci
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` and `/hubs` to `http://localhost:5100` by default; override `API_PROXY_TARGET` only when the gateway is elsewhere. The browser configuration is public, so never put a client secret in it.

The application uses in-memory access tokens. A full page reload requires a new authorization-code round trip, but a deep link is preserved through login.

### .NET services and gateway

```bash
dotnet restore services/FieldOps.Backend.slnx
dotnet build services/FieldOps.Backend.slnx -c Release
dotnet test tests/backend/FieldOps.Tests.csproj -c Release
dotnet build gateway/FieldOps.Gateway.csproj -c Release
```

Use .NET 10 LTS. The repository-level [global.json](../global.json) selects the 10.0 SDK with feature-band roll-forward. Do not build the solution with a preview SDK that fails static-web-asset validation.

### Technician app

```bash
cd apps/technician-mobile
cp .env.example .env
npm ci
npm run check
npm run android
```

`npm run android` requires Java, Android SDK/NDK, and an emulator or device. For host-local services on an Android emulator:

```bash
adb reverse tcp:5100 tcp:5100
adb reverse tcp:8080 tcp:8080
adb reverse tcp:8081 tcp:8081
```

The native callback is `fieldops360://oauth/callback`; the public Keycloak client is `fieldops-mobile`. Expo Go is not the supported OAuth environment. Release builds must use HTTPS and must not enable cleartext traffic. See the [mobile guide](../apps/technician-mobile/README.md) for offline synchronization and conflict behavior.

## 5. Verification commands

Run only the checks relevant to the component you changed, then run the full set before a delivery.

```bash
# Backend
dotnet test tests/backend/FieldOps.Tests.csproj -c Release

# Web
cd apps/web
npm run typecheck
npm test
npm run build
npm run format:check

# Mobile
cd apps/technician-mobile
npm run check
npx expo install --check

# Intelligence
PYTHONPATH=intelligence python -m pytest -c intelligence/pyproject.toml tests/intelligence -q
python -m ruff check --config intelligence/pyproject.toml intelligence/fieldops_intelligence tests/intelligence

# Documentation navigation
python scripts/check-docs.py
```

The live browser suite is opt-in because it creates synthetic orders and bookings:

```bash
cd apps/web
FIELDOPS_LIVE_E2E=1 WEB_BASE_URL=http://localhost:8088 npm run test:e2e -- --workers=1
```

On PowerShell, set `$env:FIELDOPS_LIVE_E2E='1'` and `$env:WEB_BASE_URL='http://localhost:8088'` first. The suite reads `DEMO_PASSWORD` from the environment or root `.env`; it never writes the password into fixtures.

### Monitoring profile

```bash
docker compose --profile monitoring up -d
python scripts/verify-observability.py
```

Prometheus scrapes six service targets. Jaeger retains at most 10,000 traces in memory. Restarting Jaeger loses spans; replay metadata is retained independently.

## 6. Upgrades and data safety

For an existing volume from an earlier revision:

```bash
python scripts/init-local.py
docker compose up -d postgres
python scripts/reconcile-database-runtime.py
docker compose up -d keycloak
python scripts/reconcile-local-identity.py
docker compose up -d --build
python scripts/wait-local.py
```

Reconciliation adds missing runtime identities and grants without deleting data or rewriting applied migrations. Migration files are append-only after use; create a new migration instead of editing one that has run.

Back up the database volume and root `.env` together. A volume without the matching credentials cannot be restored cleanly. Keep backups outside Git.

### Stopping and resetting

```bash
# Stop containers, retain all data
docker compose down

# Destructive: permanently removes local databases and volumes
# docker compose down -v
```

Do not run `down -v` on an environment whose data you need. For a clean demonstration environment only, stop the stack, confirm the data is disposable, and then remove the volumes.

## 7. Troubleshooting

| Symptom | Resolution |
|---|---|
| 8088 still shows an older UI | The web container has no bind mount. Run `docker compose build web && docker compose up -d --no-deps web`, then hard-refresh the tab. |
| Sign-in loop or missing subject claim | Keep the origin, issuer, and redirect URLs on the same `localhost` host. Run `python scripts/reconcile-local-identity.py` for an older realm. |
| Migration container exits nonzero | Inspect the scoped migration logs, PostgreSQL readiness, and owner credentials. Do not delete the volume to hide the failure. |
| Permission denied after an upgrade | Run the non-destructive runtime reconciliation before restarting the affected service. |
| Booking returns 409 | Check overlap, qualifications, time off, working hours, and whether the order already has a confirmed booking. |
| Workflow submit returns 409 | Refresh the authoritative workflow and inspect the stage/version. Do not rebase a queued submission automatically. |
| Analytics lags commands | Reporting is eventually consistent. Check RabbitMQ, the outbox, and warehouse freshness before retrying a write. |
| Trace unavailable | Check the monitoring profile and trace retention. Replay metadata is still valid when the trace has expired. |
| Mobile cannot reach APIs | Confirm `adb reverse`, the localhost issuer, and the cleartext-development flag. Rebuild the native client after changing native config. |
| Docker runs out of memory | Allocate at least 8 GB, stop the monitoring profile, and rebuild one service at a time. |

## 8. Security boundaries

- Local credentials are generated and ignored. Rotation is required before any shared or hosted environment.
- Browser tokens are memory-only; mobile tokens use SecureStore. Do not add localStorage token persistence.
- The API gateway validates tokens, but every service also enforces authorization and resource scope.
- Use synthetic customer data only.
- For a non-local deployment, add TLS, managed secrets, MFA/device policy, retention/backup exercises, and a deployment-specific threat assessment. Passing local checks is not production certification.
