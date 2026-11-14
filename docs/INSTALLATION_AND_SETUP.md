# Installation and Setup

## Prerequisites

- Docker Desktop or Docker Engine with Compose v2 and Linux containers.
- At least 8 GB of memory available to Docker for the full stack.
- Python 3.12 or later for local bootstrap and verification scripts.
- Optional source development: .NET SDK 10.0.403, Node.js 24, npm.
- Optional Android build: Android Studio/SDK and an Expo-compatible emulator or device.

The provided Compose deployment does not require .NET or Node on the host; the images build those layers.

## Release archive layout

```text
FieldOps360_Final_Project/
├── docs/
├── client/
├── server/
└── data/
```

Run all server and Compose commands from `server/`. The web and mobile source trees are under `client/`; the data reference material is under `data/`.

## First local start

```bash
cd server
python scripts/init-local.py
docker compose up -d --build
python scripts/wait-local.py
```

What the bootstrap does:

1. Generates a root `server/.env` with local-only passwords.
2. Generates the ignored PostgreSQL initialization SQL and Keycloak realm import.
3. Creates six demo users with one shared generated password.
4. Preserves existing generated values when re-run; it does not rotate deployed credentials silently.
5. Prints the usernames but never prints the password.

The first image build can take several minutes. The Compose stack starts PostgreSQL, RabbitMQ, Keycloak, the eight business services, the optimizer, the analytics worker, the gateway, and the web application. Migration jobs run before the service containers.

Open <http://localhost:8088>. Choose **Continue to secure sign-in** and use one of:

| Username | Role |
|---|---|
| `technician` | Technician |
| `dispatcher` | Dispatcher |
| `supervisor` | Supervisor |
| `manager` | Operations Manager |
| `analyst` | Analyst |
| `administrator` | Administrator |

The shared password is the `DEMO_PASSWORD` value in `server/.env`. Read it locally; do not paste it into documentation, chat, or commits.

## Service URLs

| Service | URL |
|---|---|
| Web application | <http://localhost:8088> |
| Gateway health | <http://localhost:5100/health/ready> |
| Keycloak | <http://localhost:8080> |
| RabbitMQ management | <http://localhost:15672> |
| PostgreSQL | `127.0.0.1:5432` |
| Prometheus (monitoring profile) | <http://localhost:9090> |
| Grafana (monitoring profile) | <http://localhost:3000> |
| Jaeger (monitoring profile) | <http://localhost:16686> |

The optimizer and individual business services have no published host ports. Access them through the gateway or from inside the Compose network.

## Monitoring profile

```bash
cd server
docker compose --profile monitoring up -d
```

The monitoring profile adds Prometheus, Grafana, and Jaeger. Grafana's local admin password is generated in `server/.env`. Jaeger retention is in-memory.

## Demo data

The repository includes API-driven synthetic seeding scripts:

```bash
cd server
python scripts/seed-demo-data.py
python scripts/seed-enterprise-history.py
```

The scripts sign in with real local accounts and create labeled synthetic records through the public APIs. They do not insert fabricated rows directly into service databases. The default manifest path is `server/.local/presentation-demo-data.json`; it is ignored by Git and is not part of the release archive.

Expected outcomes vary with the current database state. The scripts print the numbers they create and preserve their own labeled records. Do not reuse production data or manually edit the database to make a demo appear functional.

## Source development

### Backend

```bash
cd server
dotnet restore services/FieldOps.Backend.slnx
dotnet build services/FieldOps.Backend.slnx -c Release
dotnet test tests/backend/FieldOps.Tests.csproj -c Release
dotnet build gateway/FieldOps.Gateway.csproj -c Release
```

The repository pins .NET 10.0.403 in `global.json`. If the SDK is not installed, use the repository's local tool runtime when present or install the pinned SDK; do not change the target framework to match an unrelated SDK.

### Web

```bash
cd client/apps/web
npm ci
npm run typecheck
npm test
npm run build
```

For local Vite development with the Compose backend:

```bash
cd client/apps/web
npm run dev
```

Vite proxies `/api` and `/hubs` to `http://localhost:5100`. Set `API_PROXY_TARGET` only when using a different gateway.

### Mobile

```bash
cd client/apps/technician-mobile
npm ci
npm run check
npx expo start
```

The native app requires a configured Keycloak redirect and an Android emulator or device. The web app does not replace the native application for mobile verification.

### Optimizer

```bash
cd server
python -m venv optimizer/.venv
optimizer/.venv/Scripts/python -m pip install -r optimizer/requirements-dev.txt   # Windows
# optimizer/.venv/bin/python -m pip install -r optimizer/requirements-dev.txt    # macOS/Linux
PYTHONPATH=optimizer optimizer/.venv/Scripts/python -m pytest -c optimizer/pyproject.toml tests/optimizer -q
optimizer/.venv/Scripts/python -m ruff check --config optimizer/pyproject.toml optimizer/fieldops_optimizer tests/optimizer
```

On macOS/Linux, use `optimizer/.venv/bin/python`. The optimizer has no generative-AI dependency; OR-Tools CP-SAT is the only optimization engine.

## Docker Compose commands

```bash
cd server
docker compose config
docker compose build
docker compose up -d
docker compose ps
docker compose logs --tail=100
```

To rebuild only changed services:

```bash
docker compose build reporting web
docker compose up -d --no-deps reporting web
```

Do not remove named data volumes during normal cleanup. `docker compose down` stops containers but retains the PostgreSQL and RabbitMQ volumes. A deliberate full reset would require `docker compose down -v`; that is destructive and should only be done for a disposable local environment.

## Verification after startup

```bash
cd server
python scripts/wait-local.py
python scripts/verify-database-permissions.py
```

Then sign in as each role and check that the navigation and API-backed pages load. The full commands and current results are in [Testing and validation](TESTING_AND_VALIDATION.md).

## Troubleshooting

### The stack is not ready

```bash
cd server
docker compose ps
docker compose logs --tail=100 gateway keycloak postgres rabbitmq
python scripts/wait-local.py
```

Keycloak can take longer than the business services on a cold start. Wait for its health check before assuming authentication is broken.

### Login redirects but returns an error

- Confirm the web is opened at `http://localhost:8088`, not an arbitrary host.
- Confirm Keycloak imported the generated realm.
- Do not edit the generated realm by hand; rerun `python scripts/init-local.py` to refresh it.
- If the browser has a stale session, sign out and retry. Do not expose tokens in a URL.

### A booking is rejected with 409

This is expected when the technician is already booked, is outside working hours, lacks a qualification, or another request won the race. Choose another candidate or explicitly use the audited override path. Do not bypass the database constraint.

### Analytics is empty or stale

Analytics is warehouse-backed and eventually consistent. Confirm RabbitMQ and the analytics worker are healthy, then refresh. Empty cohorts intentionally return null rates until events arrive.

### Schema migration job exited

Compilation or migration errors appear in the migration job logs:

```bash
cd server
docker compose logs --tail=100 migrate-work-orders migrate-warehouse
```

Do not delete the PostgreSQL volume to hide a migration failure. Fix the migration or restore a disposable environment.

### Port already in use

The Compose file binds published ports to loopback. Stop the conflicting local process or change the host port mapping deliberately; do not expose the database or optimizer publicly.

## Security notes

The generated `.env`, realm import, database initialization SQL, and credentials are ignored by Git and excluded from the release archive. Local HTTP and demo credentials are not production settings. See [Security](SECURITY.md) before exposing any service beyond the local machine.
