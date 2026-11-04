"""Generate local-only secrets and identity bootstrap. Never prints secret values."""

from __future__ import annotations

import json
import secrets
from pathlib import Path

from local_databases import SERVICES, init_sql, read_environment

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    env_path = ROOT / ".env"
    if env_path.exists():
        values = read_environment(env_path)
        required = [f"{name.upper()}_DB_PASSWORD" for name in SERVICES] + ["KEYCLOAK_DB_PASSWORD"]
        missing = [name for name in required if not values.get(name)]
        if missing:
            raise SystemExit(
                "Existing owner configuration is incomplete; restore these keys "
                "without resetting identities: " + ", ".join(missing)
            )
        runtime_keys = [f"{name.upper()}_APP_DB_PASSWORD" for name in SERVICES] + [
            "WAREHOUSE_READ_DB_PASSWORD"
        ]
        empty = [name for name in runtime_keys if name in values and not values[name]]
        if empty:
            raise SystemExit("Runtime secret keys must not be empty: " + ", ".join(empty))
        additions = {name: secrets.token_hex(24) for name in runtime_keys if name not in values}
        if additions:
            original = env_path.read_bytes()
            prefix = b"" if original.endswith(b"\n") else b"\n"
            with env_path.open("ab") as stream:
                stream.write(prefix + b"\n# Added local least-privilege runtime identities.\n")
                stream.write(
                    "".join(f"{name}={value}\n" for name, value in additions.items()).encode()
                )
            values.update(additions)
        write("infrastructure/postgres/init.generated.sql", init_sql(ROOT, values))
        print(
            "Existing .env values and generated Keycloak identities preserved. "
            "Missing runtime secrets were added; database bootstrap policy refreshed."
        )
        print(
            "For an existing PostgreSQL volume, run python "
            "scripts/reconcile-database-runtime.py before starting the new migration jobs."
        )
        return
    values = {
        "POSTGRES_ADMIN_PASSWORD": secrets.token_hex(24),
        "KEYCLOAK_DB_PASSWORD": secrets.token_hex(24),
        "KEYCLOAK_ADMIN_PASSWORD": secrets.token_hex(24),
        "RABBITMQ_PASSWORD": secrets.token_hex(24),
        "GRAFANA_PASSWORD": secrets.token_hex(24),
        "DEMO_PASSWORD": secrets.token_hex(12),
    }
    values.update({f"{name.upper()}_DB_PASSWORD": secrets.token_hex(24) for name in SERVICES})
    values.update({f"{name.upper()}_APP_DB_PASSWORD": secrets.token_hex(24) for name in SERVICES})
    values["WAREHOUSE_READ_DB_PASSWORD"] = secrets.token_hex(24)
    write("infrastructure/postgres/init.generated.sql", init_sql(ROOT, values))
    roles = [
        "Technician",
        "Dispatcher",
        "Supervisor",
        "OperationsManager",
        "Analyst",
        "Administrator",
    ]
    users = [
        ("tech-01", "technician", "Technician", "Jordan", "Rivera"),
        ("dispatcher-01", "dispatcher", "Dispatcher", "Alex", "Morgan"),
        ("supervisor-01", "supervisor", "Supervisor", "Sam", "Chen"),
        ("manager-01", "manager", "OperationsManager", "Casey", "Patel"),
        ("analyst-01", "analyst", "Analyst", "Taylor", "Reed"),
        ("admin-01", "administrator", "Administrator", "Avery", "Brooks"),
    ]
    audience_mapper = {
        "name": "fieldops-audience",
        "protocol": "openid-connect",
        "protocolMapper": "oidc-audience-mapper",
        "consentRequired": False,
        "config": {
            "included.custom.audience": "fieldops-api",
            "id.token.claim": "false",
            "access.token.claim": "true",
        },
    }
    team_mapper = {
        "name": "team",
        "protocol": "openid-connect",
        "protocolMapper": "oidc-usermodel-attribute-mapper",
        "consentRequired": False,
        "config": {
            "user.attribute": "team_id",
            "claim.name": "team_id",
            "jsonType.label": "String",
            "id.token.claim": "true",
            "access.token.claim": "true",
            "userinfo.token.claim": "true",
        },
    }
    role_mapper = {
        "name": "roles",
        "protocol": "openid-connect",
        "protocolMapper": "oidc-usermodel-realm-role-mapper",
        "consentRequired": False,
        "config": {
            "multivalued": "true",
            "claim.name": "role",
            "jsonType.label": "String",
            "id.token.claim": "false",
            "access.token.claim": "true",
            "userinfo.token.claim": "true",
        },
    }
    clients = []
    for client_id, redirects, origins in [
        (
            "fieldops-web",
            ["http://localhost:5173/*", "http://localhost:8088/*"],
            ["http://localhost:5173", "http://localhost:8088"],
        ),
        (
            "fieldops-mobile",
            ["fieldops360://*", "exp://127.0.0.1:8081/*", "http://localhost:8081/*"],
            ["http://localhost:8081"],
        ),
    ]:
        clients.append(
            {
                "clientId": client_id,
                "enabled": True,
                "publicClient": True,
                "standardFlowEnabled": True,
                "directAccessGrantsEnabled": False,
                "implicitFlowEnabled": False,
                "redirectUris": redirects,
                "webOrigins": origins,
                "attributes": {
                    "pkce.code.challenge.method": "S256",
                    "post.logout.redirect.uris": "+",
                },
                "protocolMappers": [audience_mapper, team_mapper, role_mapper],
                "defaultClientScopes": ["basic", "web-origins", "profile", "email", "roles"],
            }
        )
    # This distinct confidential client exists only in the generated local demonstration realm.
    values["INTEGRATION_CLIENT_SECRET"] = secrets.token_hex(32)
    clients.append(
        {
            "clientId": "fieldops-integration",
            "enabled": True,
            "publicClient": False,
            "secret": values["INTEGRATION_CLIENT_SECRET"],
            "serviceAccountsEnabled": True,
            "standardFlowEnabled": False,
            "directAccessGrantsEnabled": False,
            "protocolMappers": [audience_mapper, team_mapper, role_mapper],
        }
    )
    realm = {
        "realm": "fieldops",
        "enabled": True,
        "displayName": "FieldOps 360",
        "sslRequired": "external",
        "registrationAllowed": False,
        "resetPasswordAllowed": False,
        "bruteForceProtected": True,
        "accessTokenLifespan": 300,
        "ssoSessionIdleTimeout": 1800,
        "ssoSessionMaxLifespan": 28800,
        "roles": {"realm": [{"name": role} for role in roles]},
        "clients": clients,
        "users": [
            {
                "id": uid,
                "username": username,
                "firstName": first,
                "lastName": last,
                "enabled": True,
                "email": f"{username}@example.invalid",
                "emailVerified": True,
                "attributes": {"team_id": ["north"]},
                "realmRoles": [role],
                "credentials": [
                    {"type": "password", "value": values["DEMO_PASSWORD"], "temporary": False}
                ],
            }
            for uid, username, role, first, last in users
        ],
    }
    realm["users"].append(
        {
            "username": "service-account-fieldops-integration",
            "enabled": True,
            "serviceAccountClientId": "fieldops-integration",
            "attributes": {"team_id": ["north"]},
            "realmRoles": ["Administrator"],
        }
    )
    write("infrastructure/keycloak/realm.generated.json", json.dumps(realm, indent=2) + "\n")
    write(
        "infrastructure/monitoring/grafana/provisioning/datasources/datasources.generated.yml",
        "apiVersion: 1\ndatasources:\n  - name: Prometheus\n    type: prometheus\n"
        "    access: proxy\n    url: http://prometheus:9090\n    isDefault: true\n"
        "  - name: Jaeger\n    type: jaeger\n    access: proxy\n    url: http://jaeger:16686\n",
    )
    env_path.write_text(
        "# Generated local development secrets. Never commit this file.\n"
        + "\n".join(f"{key}={value}" for key, value in values.items())
        + "\n",
        encoding="utf-8",
    )
    print(
        "Generated ignored .env, database initialization and Keycloak realm. "
        "Local demo usernames: technician, dispatcher, supervisor, manager, analyst, administrator."
    )
    print("Read DEMO_PASSWORD from .env locally when signing in. No credentials were printed.")


def write(relative_path: str, text: str) -> None:
    path = ROOT / relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
