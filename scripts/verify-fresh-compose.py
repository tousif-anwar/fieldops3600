"""Verify first-boot migrations in a new isolated local Compose project.

Uses built :local images, unique empty volumes and free loopback ports. The normal
project is untouched. Removes only this invocation's labeled disposable project.
No generated credentials, container environments or SQL payloads are printed.
"""

import json
import socket
import subprocess
import time
import urllib.request
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def main():
    project = "fieldops360-smoke-" + uuid4().hex[:10]
    ports = []
    for _ in range(4):
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            ports.append(probe.getsockname()[1])
    gateway_port, web_port, identity_port, broker_port = ports
    folder = ROOT / ".local"
    folder.mkdir(exist_ok=True)
    override = folder / (project + ".yml")
    issuer = f"http://localhost:{identity_port}/realms/fieldops"
    services = [
        "work-orders",
        "technicians",
        "scheduling",
        "workflows",
        "notifications",
        "reporting",
    ]
    lines = ["services:"]
    for service, port, target in [
        ("gateway", gateway_port, 8080),
        ("web", web_port, 8080),
        ("keycloak", identity_port, 8080),
        ("rabbitmq", broker_port, 15672),
    ]:
        lines.extend([f"  {service}:", f'    ports: !override ["127.0.0.1:{port}:{target}"]'])
        if service == "keycloak":
            lines.extend(
                ["    environment:", f"      KC_HOSTNAME: http://localhost:{identity_port}"]
            )
        elif service == "gateway":
            lines.extend(["    environment:", f"      Auth__Authority: {issuer}"])
    for service in services:
        lines.extend([f"  {service}:", "    environment:", f"      Auth__Authority: {issuer}"])
    override.write_text("\n".join(lines) + "\n", encoding="utf-8")
    command = [
        "docker",
        "compose",
        "-p",
        project,
        "-f",
        str(ROOT / "docker-compose.yml"),
        "-f",
        str(override),
    ]
    logfile = folder / (project + ".log")
    report = None
    with logfile.open("w", encoding="utf-8") as log:

        def compose(*args, capture=False):
            return subprocess.run(
                command + list(args),
                cwd=ROOT,
                check=True,
                timeout=360,
                stdout=subprocess.PIPE if capture else log,
                stderr=log,
                text=True,
            )

        try:
            print("Starting disposable first-boot Compose verification.", flush=True)
            compose("up", "-d", "--no-build")
            deadline = time.monotonic() + 240
            urls = [
                f"http://localhost:{gateway_port}/health/ready",
                f"http://localhost:{web_port}/",
                issuer + "/.well-known/openid-configuration",
            ]
            while True:
                try:
                    for url in urls:
                        with OPENER.open(url, timeout=5) as response:
                            assert response.status == 200
                    break
                except (OSError, AssertionError):
                    if time.monotonic() >= deadline:
                        raise RuntimeError("Fresh project did not become ready") from None
                    time.sleep(2)
            ids = compose("ps", "-a", "-q", capture=True).stdout.split()
            inspected = json.loads(
                subprocess.check_output(["docker", "inspect", *ids], cwd=ROOT, text=True)
            )
            migrations = [
                c
                for c in inspected
                if c["Config"]["Labels"]["com.docker.compose.service"].startswith("migrate-")
            ]
            assert len(migrations) == 7 and all(
                c["State"]["Status"] == "exited" and c["State"]["ExitCode"] == 0 for c in migrations
            )
            for service in services:
                suffix = service.replace("-", "_")
                role = "fieldops_" + suffix + "_app"
                result = compose(
                    "exec",
                    "-T",
                    "postgres",
                    "psql",
                    "-X",
                    "-U",
                    role,
                    "-d",
                    "fieldops_" + suffix,
                    "-tAc",
                    "SELECT NOT has_schema_privilege(current_user,'public','CREATE')",
                    capture=True,
                )
                assert result.stdout.strip() == "t"
            compose(
                "run",
                "--rm",
                "--no-deps",
                "-v",
                str(ROOT) + ":/repo:ro",
                "analytics-worker",
                "python",
                "/repo/analytics/quality-tests/run_checks.py",
            )
            report = {
                "freshEmptyVolumes": True,
                "migrationJobsExitedZero": 7,
                "sixRuntimeSchemaBoundaries": True,
                "gatewayWebIdentityReady": True,
                "warehouseQualityPassedAsRuntime": True,
                "normalProjectUntouched": True,
            }
            print(
                "PASS: fresh volumes, seven migrations, runtime grants and warehouse quality.",
                flush=True,
            )
        finally:
            # The cryptographically unique name was created only above by this invocation.
            # Inspect all found containers before removing the explicitly scoped project.
            found = compose("ps", "-a", "-q", capture=True).stdout.split()
            if found:
                owned = json.loads(
                    subprocess.check_output(["docker", "inspect", *found], cwd=ROOT, text=True)
                )
                assert all(
                    c["Config"]["Labels"].get("com.docker.compose.project") == project
                    for c in owned
                )
            compose("down", "--volumes", "--remove-orphans")
            print("Removed this invocation's disposable Compose project.", flush=True)
        if report:
            report["disposableProjectRemovedOnExit"] = True
            (ROOT / "artifacts").mkdir(exist_ok=True)
            (ROOT / "artifacts/fresh-compose.json").write_text(
                json.dumps(report, indent=2) + "\n", encoding="utf-8"
            )


if __name__ == "__main__":
    main()
