"""Read-only row counts and catalog integrity for all local FieldOps databases.

Exports counts, never business records or credentials. Empty inbox/receipt/error
tables are valid; their rows must come from the real runtime, not fake inserts.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("catalog", ROOT / "scripts/audit-data-catalog.py")
CATALOG = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CATALOG)


def quoted(value):
    return '"' + value.replace('"', '""') + '"'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--container", default="fieldops360-postgres-1")
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts/data/database-counts.json")
    args = parser.parse_args()
    databases = CATALOG.query(args.container, "postgres", CATALOG.array(
        "SELECT datname FROM pg_database WHERE datname LIKE 'fieldops\\_%' ESCAPE '\\' ORDER BY datname"))
    result = {"capturedAtUtc": datetime.now(timezone.utc).isoformat(), "readOnly": True,
              "businessRowsExported": False, "databases": []}
    invalid = 0
    for database in databases:
        name = database["datname"]
        tables = CATALOG.query(args.container, name, CATALOG.array(
            "SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('public','warehouse') ORDER BY schemaname,tablename"))
        counts = []
        for table in tables:
            count = CATALOG.query(args.container, name,
                "SELECT to_json(count(*)) FROM " + quoted(table["schemaname"]) + "." + quoted(table["tablename"]))
            counts.append({"table": table["schemaname"] + "." + table["tablename"], "rows": count})
        defects = CATALOG.query(args.container, name, CATALOG.array(
            "SELECT conname FROM pg_constraint k JOIN pg_namespace n ON n.oid=k.connamespace "
            "WHERE n.nspname IN ('public','warehouse') AND NOT convalidated"))
        invalid += len(defects)
        result["databases"].append({"database": name, "tables": counts, "unvalidatedConstraints": defects})
    result["unvalidatedConstraintCount"] = invalid
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"databases": len(databases), "tables": sum(len(d["tables"]) for d in result["databases"]),
                      "unvalidatedConstraints": invalid, "output": str(args.output)}))
    if invalid:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
