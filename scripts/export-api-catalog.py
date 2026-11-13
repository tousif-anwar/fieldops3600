"""Export compiled ASP.NET route metadata without starting hosts or migration jobs.

Requires current local images and an initialized Compose environment. Only the
eight fixed business services below are invoked; no user-provided shell commands
or secret-bearing Compose configuration are written into the catalog.
"""
# Markdown paragraphs and table rows are emitted as single lines for the generated document.
# ruff: noqa: E501

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVICES = (
    "customers",
    "assets",
    "work-orders",
    "technicians",
    "scheduling",
    "workflows",
    "notifications",
    "reporting",
)
ROUTE_SOURCES = (
    "building-blocks/FieldOps.ServiceHost/Bootstrap.cs",
    "building-blocks/FieldOps.ServiceHost/OperationsApi.cs",
    "building-blocks/FieldOps.ServiceHost/CustomerApi.cs",
    "building-blocks/FieldOps.ServiceHost/AssetApi.cs",
    "building-blocks/FieldOps.ServiceHost/ReportingApi.cs",
)


def invoke(arguments: list[str], *, timeout: int = 90) -> str:
    result = subprocess.run(arguments, cwd=ROOT, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        # A startup diagnostic can contain configuration values. Do not echo it.
        operation = " ".join(arguments[:3])
        raise RuntimeError(f"Command failed with exit code {result.returncode}: {operation}")
    return result.stdout.strip()


def describe(service: str) -> dict:
    image = f"fieldops360-{service}:local"
    image_id = invoke(["docker", "image", "inspect", "--format", "{{.Id}}", image])
    raw = invoke(
        [
            "docker",
            "compose",
            "run",
            "--rm",
            "--no-deps",
            "-T",
            "--pull",
            "never",
            service,
            "--describe-endpoints",
        ]
    )
    # Some images emit harmless framework diagnostics before the JSON line.
    # Keep only the strictly validated endpoint array; never publish raw output.
    candidates = []
    for line in raw.splitlines():
        try:
            candidate = json.loads(line)
        except json.JSONDecodeError:
            continue
        if (
            isinstance(candidate, list)
            and candidate
            and all(
                isinstance(route, dict) and route.get("service") == service for route in candidate
            )
        ):
            candidates.append(candidate)
    if len(candidates) != 1:
        raise RuntimeError(
            f"The {service} image did not return one endpoint array; rebuild its current source."
        )
    routes = candidates[0]
    if not isinstance(routes, list) or not routes:
        raise RuntimeError(f"No compiled endpoints were returned by {service}.")
    for route in routes:
        if route.get("service") != service or not isinstance(route.get("path"), str):
            raise RuntimeError(f"Unexpected route metadata from {service}.")
        if not isinstance(route.get("methods"), list) or not isinstance(
            route.get("policies"), list
        ):
            raise RuntimeError(f"Incomplete route metadata from {service}.")
    return {"service": service, "image": image, "image_id": image_id, "routes": routes}


def markdown(catalog: dict) -> str:
    route_count = sum(len(service["routes"]) for service in catalog["services"])
    business_count = sum(
        route["path"].startswith(("/api/", "/hubs/"))
        for service in catalog["services"]
        for route in service["routes"]
    )
    lines = [
        "# Compiled business-service endpoint catalog",
        "",
        f"Generated {catalog['generated_at_utc']} by [export-api-catalog.py](../../scripts/export-api-catalog.py). "
        f"The eight locally built business-service images returned {route_count} route entries, including "
        f"{business_count} business/SignalR entries. Git base: `{catalog['git_base']}`; "
        "the working tree may contain newer uncommitted changes. Image IDs below identify the inspected binaries.",
        "",
        "This inventory reads ASP.NET's actual `RouteEndpoint`, HTTP-method and authorization metadata. "
        "Each `docker compose run --rm --no-deps -T --pull never SERVICE --describe-endpoints` invocation exits "
        "before database initialization, broker consumers or an HTTP host start. It does not rebuild images, "
        "restart running services, apply migrations, or execute the business routes.",
        "",
        "The list is a route and authorization inventory, not an OpenAPI schema or proof of successful calls. "
        "See [REFERENCE.md](REFERENCE.md) for DTOs, object-scope rules, gateway/intelligence routes and error semantics. "
        "See the feature completion matrix for executed end-to-end evidence.",
        "",
        "## Reading the metadata",
        "",
        "Policies joined by `+` all apply, including inherited route-group policies. Their role definitions "
        "are in [Bootstrap.cs](../../building-blocks/FieldOps.ServiceHost/Bootstrap.cs). Object/team/assigned-technician "
        "checks also run inside handlers and are not represented by route metadata alone. `ANY` means no HTTP-method "
        "restriction appears in the endpoint metadata; SignalR additionally negotiates its own transport protocol.",
        "",
        "`No endpoint policy` means the service has no authorization requirement on that route; these are private "
        "deployment health/metrics surfaces. Compose does not publish the business-service ports. Public business "
        "requests go through the authenticated gateway; gateway paths are documented separately in REFERENCE.md.",
        "",
    ]
    for service in catalog["services"]:
        lines.extend(
            [
                f"## {service['service']}",
                "",
                f"Image: `{service['image']}`  ",
                f"Inspected image ID: `{service['image_id']}`",
                "",
                "| Method | Exact route pattern | Endpoint policies | Surface |",
                "|---|---|---|---|",
            ]
        )
        for route in service["routes"]:
            auth = (
                "Anonymous override"
                if route["anonymous"]
                else " + ".join(route["policies"]) or "No endpoint policy"
            )
            surface = (
                "Business"
                if route["path"].startswith("/api/")
                else "SignalR transport"
                if route["path"].startswith("/hubs/")
                else "Private health/metrics"
            )
            lines.append(
                f"| {', '.join(route['methods'])} | `{route['path']}` | {auth} | {surface} |"
            )
        lines.append("")
    lines.extend(
        [
            "## Reproduction and limits",
            "",
            "Run `python scripts/export-api-catalog.py` from the initialized repository after building current "
            "service images. The ignored machine-readable evidence is `artifacts/api/endpoint-catalog.json`; "
            "it records compiled route metadata, immutable local image IDs and source SHA-256 digests without secrets.",
            "",
            "The gateway, Keycloak and Python intelligence API are outside this eight-owner export. Gateway forwarding "
            "patterns and its authorization policies remain documented in REFERENCE.md. Request/response bodies, "
            "database constraints, integration events and handler-level object authorization require their linked "
            "source contracts and tests; this metadata does not substitute for those checks.",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "docs/api/ENDPOINTS.md")
    parser.add_argument(
        "--evidence", type=Path, default=ROOT / "artifacts/api/endpoint-catalog.json"
    )
    options = parser.parse_args()
    catalog = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "git_base": invoke(["git", "rev-parse", "HEAD"]),
        "source_sha256": {
            path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for path in ROUTE_SOURCES
        },
        "services": [describe(service) for service in SERVICES],
    }
    for path, content in (
        (options.output, markdown(catalog)),
        (options.evidence, json.dumps(catalog, indent=2) + "\n"),
    ):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    print(f"Exported compiled endpoint metadata for {len(catalog['services'])} business services.")


if __name__ == "__main__":
    main()
