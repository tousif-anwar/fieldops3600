# Security

## Scope

This document describes the security controls implemented in the FieldOps 360 local engineering deployment. It is not a production certification, penetration-test report, or compliance attestation. The local stack uses development credentials and HTTP on loopback.

## Identity

- Keycloak provides OIDC discovery, Authorization Code + PKCE, signed realm roles, and team claims.
- The web client uses `oidc-client-ts`; the mobile client uses Expo AuthSession and SecureStore.
- Access tokens are short-lived. The browser client does not persist access tokens in local storage.
- The gateway validates issuer, audience, lifetime, and signing key. It maps signed realm roles to role claims and removes spoofed identity headers.
- Each business service validates the token again. Gateway authentication is not treated as authorization.
- The SignalR query-token exception applies only to `/hubs/notifications`; ordinary APIs reject query-token authentication.
- Role claims come from signed realm roles, not from caller-supplied headers or query parameters.

## Authorization

The authorization model is deny-by-default with explicit policies:

| Policy | Roles |
|---|---|
| `operational` | Technician, Dispatcher, Supervisor, Operations Manager, Administrator |
| `execute` | Technician, Supervisor, Operations Manager, Administrator |
| `dispatch` | Dispatcher, Supervisor, Operations Manager, Administrator |
| `supervise` | Supervisor, Operations Manager, Administrator |
| `report` | Analyst, Supervisor, Operations Manager, Administrator |
| `replay` | Supervisor, Operations Manager, Administrator |
| `admin` | Administrator |

Resource checks are layered on top:

- Work orders, workflows, bookings, and replay evidence are scoped to the caller's team.
- Technicians can read and act on their own assigned work only.
- Technicians can read only their own profile and time off.
- Customer and asset office endpoints require dispatch roles; assigned-job context endpoints require an authorized work-order relationship.
- Analysts receive aggregate warehouse data without customer names or addresses and cannot mutate operational state.
- A valid role cannot bypass a foreign-team check; hidden resources return `404` where appropriate to avoid confirming their existence.
- Replay projection rebuild is Administrator-only.

## Data protection

- Each service owns a separate PostgreSQL database.
- Runtime database identities are distinct from schema owners and have least-privilege grants.
- The database permission verifier checks runtime identities, append-only history grants, warehouse reader/writer boundaries, and absence of owner DSNs in business containers.
- Database and optimizer ports are not published to the host in Compose.
- API responses set `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer`.
- The gateway strips `X-User-Id`, `X-User-Role`, `X-Team-Id`, and `X-Internal-Auth`.
- CORS allows only configured web origins.
- Replay CSV exports neutralize formula-leading values; exports remain privileged.
- Audit evidence is append-only in the operational store. Replay projections are rebuildable read models.

## Secrets

- `server/.env` is generated locally and ignored by Git.
- Generated Keycloak realms, PostgreSQL initialization SQL, RabbitMQ definitions, and Grafana datasource files are ignored.
- The release archive excludes `.env`, generated realm/init files, private keys, tokens, database volumes, and local evidence media.
- The bootstrap never prints the shared demo password.
- Example configuration contains placeholders such as `GENERATED_LOCALLY`, not usable secrets.
- Do not paste real secrets into documentation, screenshots, issue trackers, or chat.

## Input and lifecycle safety

- Request DTOs use bounded fields and explicit enums where practical.
- Customer and asset updates require an expected version.
- Workflow submissions require an idempotency key and expected version.
- Booking creation revalidates qualifications, hours, time off, and overlaps; a partial unique index prevents duplicate confirmed bookings.
- Cancellation is rejected while a confirmed booking exists; the booking must be released first.
- Stage override advances exactly one stage and requires a reason; the terminal stage still requires its form.
- Replay evidence integrity is verified with a SHA-256 hash of the stored body.
- Trace IDs are validated before a trace probe is attempted.

## Observability and failure behavior

- Structured logs avoid tokens and password values.
- OpenTelemetry traces are exported to Jaeger when configured; trace retention is local and in-memory.
- Outbox retries and inbox deduplication make message delivery recoverable.
- The readiness endpoint fails when a required business service is unavailable.
- Rate limiting is applied at the gateway (240 requests per minute per authenticated subject or remote address in the local configuration).
- Error responses do not expose stack traces to clients.

## Threats considered

- **Forged identity headers:** stripped at the gateway and ignored by services.
- **Role escalation:** signed realm roles and service-side policies.
- **Cross-team data access:** resource-level team/technician checks in every relevant service.
- **Duplicate booking:** transaction validation plus partial unique index.
- **Replayed workflow submission:** idempotency receipts and expected versions.
- **Tampered replay evidence:** append-only storage and integrity hashes.
- **Spreadsheet formula injection:** CSV neutralization for exports.
- **Secret leakage:** generated ignored files, archive exclusions, and secret scanning guidance.
- **Broker outage:** transactional outbox and retry behavior.

## Known limitations

- The local deployment uses HTTP and generated demo credentials. It is not safe for public exposure.
- There is no production WAF, DDoS protection, managed secret store, MFA/device policy, or backup/restore exercise in this repository.
- Customer self-service authentication and customer data isolation are not implemented.
- The local PostgreSQL instance is shared physically even though databases and roles are isolated.
- Jaeger trace storage is ephemeral.
- Role policy changes require rebuilding the affected service images; the release documents the current policy rather than claiming dynamic administration.
- Security tests and scans run locally; no remote CI run is claimed for this release.

## Production requirements

Before any non-local deployment:

1. Use TLS with a managed certificate and secure ingress.
2. Move secrets to a managed secret store and rotate generated credentials.
3. Use managed PostgreSQL and RabbitMQ with backups, network policies, and least privilege.
4. Enable MFA/device policy and restrict Keycloak administration.
5. Review CORS, rate limits, retention, audit export, and incident response.
6. Perform a deployment-specific threat model and penetration test.
7. Add customer identity and explicit customer-scoped authorization before enabling self-service.
8. Validate restore, failover, and key rotation procedures.

Passing the local security checks is evidence of implemented controls, not production readiness.
