"""Verify deployed runtime ACLs and container secret separation without exposing passwords."""
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SERVICES = {"work-orders": "work_orders", "technicians": "technicians", "scheduling": "scheduling", "workflows": "workflows", "notifications": "notifications", "reporting": "reporting"}


def sql(database, role, expression):
    result = subprocess.run(["docker", "compose", "exec", "-T", "postgres", "psql", "-X", "-tAc", expression,
                             "-U", role, "-d", database, "-v", "ON_ERROR_STOP=1"], cwd=ROOT, capture_output=True, text=True, check=True)
    if result.stdout.strip() != "t":
        raise RuntimeError("Runtime permission invariant failed for " + role)


def main():
    for service, suffix in SERVICES.items():
        owner = "fieldops_" + suffix
        role = owner + "_app"
        sql(owner, role, f"""SELECT current_user='{role}'
            AND NOT pg_has_role(current_user,'{owner}','MEMBER')
            AND NOT has_schema_privilege(current_user,'public','CREATE')
            AND NOT has_database_privilege(current_user,current_database(),'CREATE')
            AND NOT has_table_privilege(current_user,'fieldops_schema_migrations','UPDATE')
            AND has_table_privilege(current_user,'outbox_messages','INSERT')
            AND NOT has_database_privilege(current_user,'keycloak','CONNECT')""")
        container = json.loads(subprocess.check_output(["docker", "inspect", "fieldops360-" + service + "-1"], cwd=ROOT, text=True))[0]
        environment = dict(value.split("=", 1) for value in container["Config"]["Env"] if "=" in value)
        if "Username=" + role + ";" not in environment.get("ConnectionStrings__Database", "") or environment.get("Database__Initialize") != "false":
            raise RuntimeError("Runtime database identity/migration mode is incorrect for " + service)
        for value in environment.values():
            if "Username=" + owner + ";" in value:
                raise RuntimeError("Migration-owner connection leaked into runtime " + service)
    sql("fieldops_reporting", "fieldops_reporting_app", """SELECT
        has_table_privilege(current_user,'audit_events','SELECT') AND has_table_privilege(current_user,'audit_events','INSERT')
        AND NOT has_table_privilege(current_user,'audit_events','UPDATE') AND NOT has_table_privilege(current_user,'audit_events','DELETE')
        AND NOT has_table_privilege(current_user,'audit_events','TRUNCATE') AND NOT has_table_privilege(current_user,'audit_events','TRIGGER')
        AND NOT has_table_privilege(current_user,'delivery_attempts','UPDATE')""")
    sql("fieldops_warehouse", "fieldops_warehouse_app", """SELECT
        has_table_privilege(current_user,'warehouse.fact_work_order','UPDATE')
        AND has_table_privilege(current_user,'warehouse.ingestion_ledger','INSERT')
        AND NOT has_table_privilege(current_user,'warehouse.ingestion_ledger','UPDATE')
        AND NOT has_table_privilege(current_user,'warehouse.staging_event','DELETE')
        AND NOT has_table_privilege(current_user,'warehouse.schema_migration','INSERT')
        AND NOT has_schema_privilege(current_user,'warehouse','CREATE')""")
    sql("fieldops_warehouse", "fieldops_warehouse_reader", """SELECT
        has_table_privilege(current_user,'warehouse.fact_work_order','SELECT')
        AND NOT has_table_privilege(current_user,'warehouse.fact_work_order','INSERT')
        AND NOT has_table_privilege(current_user,'warehouse.fact_work_order','UPDATE')
        AND NOT has_schema_privilege(current_user,'warehouse','CREATE')""")
    print("Verified six isolated runtime identities, append-only audit grants, warehouse writer/reader boundaries, and absence of owner DSNs in business containers.")


if __name__ == "__main__":
    main()
