# Security boundaries, RBAC and threat model

The local deployment is a development environment with synthetic data, loopback-only published ports and HTTP identity endpoints. These controls do not constitute an ASVS certification or a production security assessment.

| Role | Operational read | Dispatch | Execute | Supervisor actions | Analytics | Replay | Rebuild projection |
|---|---|---|---|---|---|---|---|
| Technician | Assigned work in own team | No | Assigned workflow | Assistance only | No | No | No |
| Dispatcher | Own team | Own team | No | No | No | No | No |
| Supervisor | Own team | Own team | Own team | Own team with reason | Own team | Own team | No |
| OperationsManager | Own team | Own team | Own team | Own team with reason | Own team | No | No |
| Analyst | No customer details | No | No | No | Masked own-team warehouse | No | No |
| Administrator | All | All | All | Audited | All | All | Yes |

Keycloak owns identity administration. Its separate administrator console is available locally; the web administration experience documents this boundary instead of exposing an application user-role editor. Engineering-only permissions distinct from Administrator are not yet modeled.

## Threats and implemented controls

- **Forged identity:** gateway and services validate signed issuer/audience/expiry; unsigned tokens, role headers and ordinary query tokens are rejected. Realm roles and `team_id` come from signed claims.
- **Object access:** `Caller.Demand` applies team and assigned-subject predicates and returns 404 for hidden objects. Reporting queries parameterize the team boundary. Replay has an explicit supervisor/administrator policy.
- **Lost changes or replayed commands:** PostgreSQL version checks, unique idempotency receipts and exclusion constraints control workflow and booking races. Retried event IDs cannot become new business actions.
- **Client time manipulation:** user-supplied timestamps are labeled evidence. Persisted UTC stage timestamps and server clock thresholds govern SLA; drafts and offline time do not pause it.
- **Operational tampering:** replay business event and delivery-attempt tables reject ordinary UPDATE/DELETE through SQL triggers; immutable original text has a SHA256 integrity hash. A database owner can bypass triggers, so a deployment must separate migration ownership from least-privilege runtime grants and keep independent backups. A hash in the same database is not protection against a database administrator.
- **Injection:** EF and Npgsql parameter binding, fixed table identifiers, server dropdown allowlists, escaped CSV formulas/quotes and escaped PDF strings. React renders text; no untrusted HTML insertion.
- **Token disclosure:** web access tokens remain in memory; native tokens use SecureStore. Session credentials and generated bootstrap files remain ignored. HTTP framework information logs are suppressed so SignalR query tokens do not enter access logs. Avoid production query logging at the reverse proxy.
- **Browser script compromise:** web CSP restricts scripts, connections, framing and base URI. Form labels, semantic controls and focus states support accessible error recovery. CSP currently permits inline styles required by Fluent UI.
- **Warehouse privacy:** staging strips customer names, addresses and answers. Aggregates use pseudonymous staff IDs; customer dimension remains an explicitly unresolved synthetic reference. Replay events omit customer contact information.
- **Misleading prediction:** synthetic training and calibrated probabilities are labeled. Inputs that are assumptions are editable and visible. Accept/dismiss actions require a reason and record model provenance. Models never automatically change bookings or penalize employees.

## Remaining deployment work

Production TLS, reverse-proxy trust configuration, secret rotation, user MFA/device policy, runtime-only SQL grants, backup restore exercises, incident retention policy approval, and a complete authenticated ASVS/security review require a target deployment. Mobile customer caches use OS-protected AsyncStorage rather than application database encryption; see the mobile README. The generated integration client is local-only and must be removed from non-local realms.

Source lifecycle references: [Keycloak 26.8.1 security fixes](https://github.com/keycloak/keycloak/releases/tag/26.8.1), [.NET support policy](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core), [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/).
