"""Local database role policy shared by bootstrap and non-destructive upgrade.

Only the fixed FieldOps service/role names below are accepted. SQL sent to psql
contains credentials and must never be printed or committed as generated output.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
import re

OPERATIONAL_SERVICES = (
    "work_orders", "technicians", "scheduling", "workflows", "notifications", "reporting",
)
SERVICES = (*OPERATIONAL_SERVICES, "warehouse")


def identifier(value: str) -> str:
    if not re.fullmatch(r"[a-z_][a-z0-9_]*", value):
        raise ValueError("Invalid database identifier")
    return '"' + value + '"'


def literal(value: str) -> str:
    if "\x00" in value:
        raise ValueError("Database secret contains an unsupported null character")
    return "E'" + value.replace("\\", "\\\\").replace("'", "''") + "'"


def block(body: str) -> str:
    tag = "$fieldops_" + hashlib.sha256(body.encode()).hexdigest()[:16] + "$"
    while tag in body:
        tag = tag[:-1] + "_$"
    return f"DO {tag}\n{body}\n{tag};"


def service_names(service: str) -> tuple[str, str]:
    if service not in SERVICES:
        raise ValueError("Unknown FieldOps service")
    return f"fieldops_{service}", f"fieldops_{service}_app"


def read_environment(path: Path) -> dict[str, str]:
    values = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:]
        key, separator, value = line.partition("=")
        if not separator:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key.strip()] = value
    return values


def runtime_roles_sql(values: dict[str, str]) -> str:
    roles = [(service_names(service)[1], values[f"{service.upper()}_APP_DB_PASSWORD"])
             for service in SERVICES]
    roles.append(("fieldops_warehouse_reader", values["WAREHOUSE_READ_DB_PASSWORD"]))
    statements = []
    for role, password in roles:
        name = identifier(role)
        settings = "LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS"
        statements.append(block(f"""BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname={literal(role)}) THEN
  CREATE ROLE {name} {settings} PASSWORD {literal(password)};
 ELSE
  ALTER ROLE {name} {settings} PASSWORD {literal(password)};
 END IF;
END;"""))
        # Dedicated application identities must not inherit or SET ROLE into owners.
        statements.append(block(f"""DECLARE membership record;
BEGIN
 FOR membership IN SELECT parent.rolname FROM pg_auth_members m
  JOIN pg_roles parent ON parent.oid=m.roleid JOIN pg_roles child ON child.oid=m.member
  WHERE child.rolname={literal(role)}
 LOOP EXECUTE format('REVOKE %I FROM %I',membership.rolname,{literal(role)}); END LOOP;
END;"""))
    return "\n".join(statements)


def operational_grants_sql(service: str) -> str:
    if service not in OPERATIONAL_SERVICES:
        raise ValueError("Operational grant policy requires a business service")
    owner, runtime = service_names(service)
    owner_id, app = identifier(owner), identifier(runtime)
    protected = ["fieldops_schema_migrations"]
    if service == "reporting":
        protected.extend(["audit_events", "delivery_attempts"])
    protection = []
    for table in protected:
        rights = "SELECT, INSERT" if table in {"audit_events", "delivery_attempts"} else "SELECT"
        protection.append(block(f"""BEGIN
 IF to_regclass('public.{table}') IS NOT NULL THEN
  REVOKE ALL ON TABLE public.{identifier(table)} FROM {app};
  GRANT {rights} ON TABLE public.{identifier(table)} TO {app};
 END IF;
END;"""))
    return f"""REVOKE ALL ON DATABASE {owner_id} FROM PUBLIC;
REVOKE ALL ON DATABASE {owner_id} FROM {app};
GRANT CONNECT ON DATABASE {owner_id} TO {app};
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM {app};
GRANT USAGE ON SCHEMA public TO {app};
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM {app};
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO {app};
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM {app};
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO {app};
ALTER DEFAULT PRIVILEGES FOR ROLE {owner_id} IN SCHEMA public REVOKE ALL ON TABLES FROM {app};
ALTER DEFAULT PRIVILEGES FOR ROLE {owner_id} IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO {app};
ALTER DEFAULT PRIVILEGES FOR ROLE {owner_id} IN SCHEMA public REVOKE ALL ON SEQUENCES FROM {app};
ALTER DEFAULT PRIVILEGES FOR ROLE {owner_id} IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO {app};
{chr(10).join(protection)}
"""


def warehouse_grants_sql(root: Path) -> str:
    return (root / "infrastructure/postgres/grants-warehouse-runtime.sql").read_text("utf-8")


def init_sql(root: Path, values: dict[str, str]) -> str:
    statements = ["-- Generated local bootstrap; contains secrets. Never commit.", "\\set ON_ERROR_STOP on"]
    for service in (*SERVICES, "keycloak"):
        owner = f"fieldops_{service}"
        database = "keycloak" if service == "keycloak" else owner
        password = values["KEYCLOAK_DB_PASSWORD" if service == "keycloak" else f"{service.upper()}_DB_PASSWORD"]
        statements.extend([
            f"CREATE ROLE {identifier(owner)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD {literal(password)};",
            f"CREATE DATABASE {identifier(database)} OWNER {identifier(owner)};",
            f"REVOKE ALL ON DATABASE {identifier(database)} FROM PUBLIC;",
            f"GRANT CONNECT ON DATABASE {identifier(database)} TO {identifier(owner)};",
        ])
    statements.append(runtime_roles_sql(values))
    for service in OPERATIONAL_SERVICES:
        owner, _ = service_names(service)
        statements.extend([f"\\connect {owner}", operational_grants_sql(service)])
        if service == "scheduling":
            statements.append("CREATE EXTENSION IF NOT EXISTS btree_gist;")
    statements.extend(["\\connect fieldops_warehouse", warehouse_grants_sql(root)])
    return "\n".join(statements) + "\n"


def reconciliation_sql(root: Path, values: dict[str, str]) -> str:
    statements = ["\\set ON_ERROR_STOP on", "-- Add application roles/permissions; never drop data or change owner passwords.", runtime_roles_sql(values)]
    for service in OPERATIONAL_SERVICES:
        owner, _ = service_names(service)
        statements.extend([f"\\connect {owner}", operational_grants_sql(service)])
    statements.extend(["\\connect fieldops_warehouse", warehouse_grants_sql(root)])
    return "\n".join(statements) + "\n"
