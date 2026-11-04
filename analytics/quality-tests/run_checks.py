"""Run warehouse invariants without exposing connection strings or event payloads."""

import json
import os
from pathlib import Path

import psycopg


def main() -> None:
    defects = []
    with psycopg.connect(os.environ["WAREHOUSE_DSN"]) as connection:
        cursor = connection.execute(Path(__file__).with_name("checks.sql").read_text("utf-8"))
        while True:
            if cursor.description:
                defects.extend(cursor.fetchall())
            if not cursor.nextset():
                break
    print(json.dumps({"defectCount": len(defects), "defects": defects}))
    if defects:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
