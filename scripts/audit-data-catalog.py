"""Read-only local PostgreSQL catalog snapshot; never exports business rows or secrets.

Run: python scripts/audit-data-catalog.py --output artifacts/data/live-catalog.json
Requires the existing local Compose PostgreSQL container and its Unix-socket admin
access. Does not create databases, execute migrations, or change grants.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SCHEMAS = "n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'"


def query(container: str, database: str, sql: str):
    result = subprocess.run(
        ["docker", "exec", "-i", container, "psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database],
        input="BEGIN READ ONLY;\n" + sql + ";\nROLLBACK;\n", text=True,
        capture_output=True, check=True, encoding="utf-8",
    )
    return json.loads(result.stdout.strip())


def array(sql: str) -> str:
    return "SELECT coalesce(json_agg(row_to_json(q)), '[]'::json) FROM (" + sql + ") q"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--container", default="fieldops360-postgres-1")
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts/data/live-catalog.json")
    args = parser.parse_args()
    database_list = query(args.container, "postgres", array("SELECT datname,pg_get_userbyid(datdba) AS owner,datistemplate,datallowconn FROM pg_database ORDER BY datname"))
    snapshot = {
        "captured_at_utc": datetime.now(timezone.utc).isoformat(),
        "git_head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "method": "docker exec psql; every query inside BEGIN READ ONLY / ROLLBACK",
        "business_rows_exported": False, "server_databases": database_list, "databases": [],
        "source_migrations": [],
    }
    for path in sorted([*ROOT.glob("services/*/migrations/*.sql"), *ROOT.glob("analytics/migrations/*.sql")]):
        normalized = path.read_text(encoding="utf-8-sig").replace("\r\n", "\n").replace("\r", "\n").rstrip() + "\n"
        snapshot["source_migrations"].append({"path": path.relative_to(ROOT).as_posix(), "normalized_sha256": hashlib.sha256(normalized.encode()).hexdigest().upper()})
    for database in database_list:
        name = database["datname"]
        if not database["datallowconn"] or database["datistemplate"]:
            continue
        item = {"name": name, "owner": database["owner"]}
        item["version"] = query(args.container, name, "SELECT to_json(current_setting('server_version'))")
        item["schemas"] = query(args.container, name, array(f"SELECT n.nspname AS name,pg_get_userbyid(n.nspowner) AS owner FROM pg_namespace n WHERE {SCHEMAS} ORDER BY n.nspname"))
        item["relations"] = query(args.container, name, array(f"SELECT n.nspname AS schema,c.relname AS name,c.relkind AS kind,pg_get_userbyid(c.relowner) AS owner,obj_description(c.oid,'pg_class') AS comment,CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid,true) ELSE NULL END AS view_definition FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE {SCHEMAS} AND c.relkind IN ('r','p','v','m','S') ORDER BY n.nspname,c.relname"))
        item["columns"] = query(args.container, name, array(f"SELECT n.nspname AS schema,c.relname AS relation,a.attnum AS ordinal,a.attname AS name,format_type(a.atttypid,a.atttypmod) AS data_type,NOT a.attnotnull AS nullable,pg_get_expr(d.adbin,d.adrelid) AS default_expression,a.attidentity AS identity,a.attgenerated AS generated,col_description(c.oid,a.attnum) AS comment FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE {SCHEMAS} AND c.relkind IN ('r','p','v','m') AND a.attnum>0 AND NOT a.attisdropped ORDER BY n.nspname,c.relname,a.attnum"))
        item["constraints"] = query(args.container, name, array(f"SELECT n.nspname AS schema,c.relname AS relation,k.conname AS name,k.contype AS type,pg_get_constraintdef(k.oid,true) AS definition,k.convalidated AS validated,k.condeferrable AS deferrable,k.condeferred AS initially_deferred,rn.nspname AS referenced_schema,rc.relname AS referenced_relation,(SELECT json_agg(a.attname ORDER BY x.ordinality) FROM unnest(k.conkey) WITH ORDINALITY x(attnum,ordinality) JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=x.attnum) AS columns,(SELECT json_agg(a.attname ORDER BY x.ordinality) FROM unnest(k.confkey) WITH ORDINALITY x(attnum,ordinality) JOIN pg_attribute a ON a.attrelid=k.confrelid AND a.attnum=x.attnum) AS referenced_columns FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_class rc ON rc.oid=k.confrelid LEFT JOIN pg_namespace rn ON rn.oid=rc.relnamespace WHERE {SCHEMAS} ORDER BY n.nspname,c.relname,k.conname"))
        item["indexes"] = query(args.container, name, array(f"SELECT n.nspname AS schema,c.relname AS relation,ic.relname AS name,i.indisprimary AS primary,i.indisunique AS unique,i.indisvalid AS valid,pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_class ic ON ic.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE {SCHEMAS} ORDER BY n.nspname,c.relname,ic.relname"))
        item["triggers"] = query(args.container, name, array(f"SELECT n.nspname AS schema,c.relname AS relation,t.tgname AS name,pg_get_triggerdef(t.oid,true) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE {SCHEMAS} AND NOT t.tgisinternal ORDER BY n.nspname,c.relname,t.tgname"))
        item["functions"] = query(args.container, name, array(f"SELECT n.nspname AS schema,p.proname AS name,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_function_result(p.oid) AS returns FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE {SCHEMAS} ORDER BY n.nspname,p.proname"))
        ledger = next((r for r in item["relations"] if r["name"] in ("fieldops_schema_migrations", "schema_migration")), None)
        if ledger:
            item["migration_ledger"] = {"relation": ledger["schema"] + "." + ledger["name"], "rows": query(args.container, name, array('SELECT * FROM "' + ledger["schema"] + '"."' + ledger["name"] + '" ORDER BY 1'))}
        snapshot["databases"].append(item)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(snapshot, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "captured_at_utc": snapshot["captured_at_utc"], "databases": [{"name": d["name"], "tables": sum(r["kind"] in ("r","p") for r in d["relations"]), "views": sum(r["kind"] in ("v","m") for r in d["relations"]), "columns": len(d["columns"]), "constraints": len(d["constraints"]), "indexes": len(d["indexes"]), "migrations": len(d.get("migration_ledger", {}).get("rows", []))} for d in snapshot["databases"]]}, indent=2))


if __name__ == "__main__":
    main()
