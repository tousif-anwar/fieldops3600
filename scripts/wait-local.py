"""Bounded local readiness check without printing credentials or configuration."""
import time
import urllib.error
import urllib.request

targets = ["http://localhost:8080/realms/fieldops/.well-known/openid-configuration", "http://localhost:5100/health/live", "http://localhost:8088/"]
deadline = time.monotonic() + 180
pending = set(targets)
while pending and time.monotonic() < deadline:
    for target in list(pending):
        try:
            with urllib.request.urlopen(target, timeout=3) as response:
                if response.status == 200:
                    pending.remove(target)
        except (OSError, urllib.error.URLError):
            pass
    if pending:
        time.sleep(1)
if pending:
    raise SystemExit("Local services did not become ready: " + ", ".join(sorted(pending)))
print("Local identity, gateway and web endpoints are ready.")
