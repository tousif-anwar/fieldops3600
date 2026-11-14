# FieldOps 360 — Documentation

FieldOps 360 is a field-service operations platform for dispatching qualified technicians, guiding HVAC service work through a server-controlled workflow, supervising SLA performance, and investigating operational incidents from immutable event evidence. The implementation is an engineering demonstration built around a real local deployment: PostgreSQL, RabbitMQ, Keycloak, eight ASP.NET Core service hosts, a YARP gateway, a React operations portal, an Expo technician app, a deterministic OR-Tools optimizer, and a warehouse-backed analytics path.

The application is designed for six authenticated operational roles: Technician, Dispatcher, Supervisor, Operations Manager, Analyst, and Administrator. Customers and service locations are managed as operational records; a separate customer sign-in portal is **not implemented** in this release. See [Known limitations](#known-limitations) before demonstrating customer self-service.

## Documentation set

| Document | Purpose |
|---|---|
| [Project overview](PROJECT_OVERVIEW.md) | Business problem, scope, roles, and delivery boundaries. |
| [System architecture](SYSTEM_ARCHITECTURE.md) | Service boundaries, data flow, messaging, security, and deployment topology. |
| [Features](FEATURES.md) | Implemented behavior by role and business workflow. |
| [Database design](DATABASE_DESIGN.md) | Operational schemas, warehouse model, migrations, and consistency rules. |
| [API reference](API_REFERENCE.md) | Gateway routes, request/response conventions, authorization, and event contracts. |
| [Installation and setup](INSTALLATION_AND_SETUP.md) | Prerequisites, local bootstrap, startup, demo accounts, and troubleshooting. |
| [User guide](USER_GUIDE.md) | Role-specific navigation and operating procedures. |
| [Testing and validation](TESTING_AND_VALIDATION.md) | Commands, results, evidence boundaries, and verification limitations. |
| [Security](SECURITY.md) | Identity, authorization, data isolation, secret handling, and threat boundaries. |
| [Presentation guide](PRESENTATION_GUIDE.md) | Suggested demonstration sequence and reliable talking points. |
| [Release verification](RELEASE_VERIFICATION.md) | Final archive checks, checksum, and release status. |

## Quick start

From the extracted archive:

```bash
cd server
python scripts/init-local.py
docker compose up -d --build
python scripts/wait-local.py
```

Open <http://localhost:8088>. The generated local accounts are `technician`, `dispatcher`, `supervisor`, `manager`, `analyst`, and `administrator`. Their shared password is the `DEMO_PASSWORD` value in `server/.env`; it is generated locally and never committed.

The complete procedure, including source-development commands and troubleshooting, is in [Installation and setup](INSTALLATION_AND_SETUP.md).

## Release layout

```text
FieldOps360_Final_Project/
├── docs/
├── client/
├── server/
└── data/
```

- `client/` contains the React web application, the Expo technician application, browser tests, and mobile tests.
- `server/` contains the ASP.NET Core services, shared libraries, gateway, optimizer, analytics worker, replay service code, Docker configuration, and reproducibility scripts.
- `data/` contains reference copies of the operational and warehouse migrations, schema diagrams, data dictionary, and reproducible seed instructions.

## Verified release status

The final release was built and exercised on 13 November 2026 with the local Docker Compose stack. The principal results were:

- .NET backend tests: **75 passed**.
- Web unit/component tests: **55 passed**; TypeScript and production build passed.
- Mobile typecheck and tests: **34 passed**.
- Optimizer tests: **10 passed**; Ruff lint and format checks passed.
- Warehouse PostgreSQL tests: **32 passed**.
- Gateway security tests: **7 passed**.
- Live integration tests: **5 passed**, including Keycloak PKCE, booking conflict protection, eight-stage workflow completion, replay, and warehouse projection.
- Scoped authorization checks: **3 passed**.
- Live optimizer HTTP contract: **1 passed**.
- Browser end-to-end suite: **27 passed, 11 intentionally skipped** across desktop and mobile projects.
- Resilience demonstration: accelerated SLA breach, service restart, warning retry, supervisor pause/resume, completed replay, broker outage, and outbox recovery all passed.

The exact commands, timestamps, and evidence boundaries are recorded in [Testing and validation](TESTING_AND_VALIDATION.md) and [Release verification](RELEASE_VERIFICATION.md). Passing local checks is not a production certification.

## Known limitations

- There is no customer-facing login or self-service portal. Customer and location records are maintained by dispatchers, supervisors, and managers.
- No native Android emulator or physical-device run was completed for this release. The Expo application passed typechecking and its 34 deterministic tests.
- Dispatchers do not receive the Analytics navigation item; analytics is limited to Analysts, Supervisors, Operations Managers, and Administrators. The API enforces the same policy.
- The analytics and replay paths are eventually consistent. Warehouse readings depend on RabbitMQ delivery and the ingestion worker.
- SLA timing is server-authoritative. The accelerated 30-second configuration is a local demonstration override, not a production default.
- Jaeger trace retention is in-memory in the local stack.
- Travel in the optimizer is a straight-line depot estimate. It does not model roads, traffic, or between-job routing.
- The local stack uses development credentials and HTTP on loopback. It is not a production deployment.
