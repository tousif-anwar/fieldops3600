"""Non-destructively add local runtime identities without printing credentials."""

import subprocess
import sys
from pathlib import Path

from local_databases import SERVICES, read_environment, reconciliation_sql

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    values = read_environment(ROOT / ".env")
    expected = [f"{name.upper()}_APP_DB_PASSWORD" for name in SERVICES] + [
        "WAREHOUSE_READ_DB_PASSWORD"
    ]
    if any(not values.get(name) for name in expected):
        raise SystemExit(
            "Run python scripts/init-local.py first to add missing local runtime secrets."
        )
    # The local container's Unix-socket administrator authenticates inside the
    # container. Secret-bearing SQL is provided over stdin, never CLI arguments.
    result = subprocess.run(
        [
            "docker",
            "compose",
            "exec",
            "-T",
            "postgres",
            "psql",
            "-X",
            "-q",
            "-U",
            "postgres",
            "-d",
            "postgres",
            "-v",
            "ON_ERROR_STOP=1",
        ],
        cwd=ROOT,
        input=reconciliation_sql(ROOT, values),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode:
        # PostgreSQL diagnostics can include the SQL statement and password;
        # preserve the failure code but do not echo raw process output.
        print(
            "Runtime-role reconciliation failed. Database ownership/data were not dropped; "
            "inspect local PostgreSQL diagnostics privately.",
            file=sys.stderr,
        )
        raise SystemExit(result.returncode)
    print(
        "Runtime roles and least-privilege grants reconciled. Existing owner passwords, "
        "business data, users, and realm credentials were preserved."
    )


if __name__ == "__main__":
    main()
