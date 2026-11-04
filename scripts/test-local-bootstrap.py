"""Credential preservation and SQL policy regressions; does not access Docker."""

import contextlib
import importlib.util
import io
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from local_databases import (
    OPERATIONAL_SERVICES,
    SERVICES,
    identifier,
    literal,
    operational_grants_sql,
    read_environment,
    reconciliation_sql,
    runtime_roles_sql,
)

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("init_local", ROOT / "scripts/init-local.py")
BOOTSTRAP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BOOTSTRAP)


class BootstrapTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.policy = self.root / "infrastructure/postgres/grants-warehouse-runtime.sql"
        self.policy.parent.mkdir(parents=True)
        shutil.copyfile(ROOT / "infrastructure/postgres/grants-warehouse-runtime.sql", self.policy)
        self.previous = BOOTSTRAP.ROOT
        BOOTSTRAP.ROOT = self.root

    def tearDown(self):
        BOOTSTRAP.ROOT = self.previous
        self.directory.cleanup()

    def initialize(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            BOOTSTRAP.main()
        return output.getvalue()

    def test_fresh_bootstrap_creates_distinct_owner_writer_and_reader_credentials(self):
        output = self.initialize()
        values = read_environment(self.root / ".env")
        for name in SERVICES:
            self.assertNotEqual(
                values[f"{name.upper()}_DB_PASSWORD"], values[f"{name.upper()}_APP_DB_PASSWORD"]
            )
        self.assertNotEqual(
            values["WAREHOUSE_APP_DB_PASSWORD"], values["WAREHOUSE_READ_DB_PASSWORD"]
        )
        for password in values.values():
            self.assertNotIn(password, output)
        sql = (self.root / "infrastructure/postgres/init.generated.sql").read_text()
        self.assertIn('CREATE DATABASE "fieldops_reporting" OWNER "fieldops_reporting"', sql)
        self.assertIn('CREATE ROLE "fieldops_reporting_app"', sql)
        self.assertIn("fieldops_warehouse_reader", sql)

    def test_legacy_upgrade_preserves_exact_existing_environment_prefix_and_realm(self):
        self.initialize()
        env = self.root / ".env"
        values = read_environment(env)
        runtime = {f"{name.upper()}_APP_DB_PASSWORD" for name in SERVICES} | {
            "WAREHOUSE_READ_DB_PASSWORD"
        }
        legacy = "# User-maintained local prefix\r\n" + "\r\n".join(
            f"{key}={value}" for key, value in values.items() if key not in runtime
        )
        env.write_bytes(legacy.encode())
        realm = self.root / "infrastructure/keycloak/realm.generated.json"
        realm.write_bytes(
            json.dumps(
                {
                    "users": [
                        {
                            "username": "preserve-custom-user",
                            "credentials": [{"value": "preserve-existing-password"}],
                        }
                    ]
                }
            ).encode()
        )
        before_realm = realm.read_bytes()
        self.initialize()
        self.assertTrue(env.read_bytes().startswith(legacy.encode()))
        self.assertEqual(before_realm, realm.read_bytes())
        updated = read_environment(env)
        for key, value in values.items():
            if key not in runtime:
                self.assertEqual(value, updated[key])
        self.assertTrue(all(updated.get(key) for key in runtime))

    def test_repeated_upgrade_never_rotates_generated_secrets_or_rewrites_realm(self):
        self.initialize()
        env = (self.root / ".env").read_bytes()
        realm = (self.root / "infrastructure/keycloak/realm.generated.json").read_bytes()
        self.initialize()
        self.assertEqual(env, (self.root / ".env").read_bytes())
        self.assertEqual(
            realm, (self.root / "infrastructure/keycloak/realm.generated.json").read_bytes()
        )

    def test_reconciliation_never_creates_or_drops_databases_or_changes_owner_passwords(self):
        self.initialize()
        values = read_environment(self.root / ".env")
        sql = reconciliation_sql(self.root, values)
        self.assertNotIn("CREATE DATABASE", sql)
        self.assertNotIn("DROP ", sql)
        for name in SERVICES:
            self.assertNotIn(values[f"{name.upper()}_DB_PASSWORD"], sql)
        for name in OPERATIONAL_SERVICES:
            policy = operational_grants_sql(name)
            self.assertIn("REVOKE CREATE ON SCHEMA public FROM PUBLIC", policy)
            self.assertIn("GRANT USAGE ON SCHEMA public", policy)
            self.assertNotIn("GRANT ALL", policy)
        policy = operational_grants_sql("reporting")
        self.assertIn('GRANT SELECT, INSERT ON TABLE public."audit_events"', policy)
        self.assertIn('GRANT SELECT ON TABLE public."fieldops_schema_migrations"', policy)

    def test_sql_names_are_safelisted_and_password_literals_are_escaped(self):
        with self.assertRaises(ValueError):
            operational_grants_sql("reporting;DROP DATABASE postgres")
        with self.assertRaises(ValueError):
            identifier('role";RESET ROLE;')
        self.assertEqual("E'one''two\\\\three'", literal("one'two\\three"))
        values = {f"{name.upper()}_APP_DB_PASSWORD": "quote'and\\slash$tag$" for name in SERVICES}
        values["WAREHOUSE_READ_DB_PASSWORD"] = "safe-reader"
        sql = runtime_roles_sql(values)
        self.assertIn("quote''and\\\\slash$tag$", sql)
        self.assertIn("NOINHERIT", sql)
        self.assertIn("NOCREATEROLE", sql)


if __name__ == "__main__":
    unittest.main()
