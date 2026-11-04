"""Black-box gateway tests against a real process, with no authentication bypass."""
import json
import os
from pathlib import Path
import socket
import subprocess
import time
import unittest
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]


class GatewaySecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.runtime = ROOT / ".tools/dotnet/dotnet.exe"
        if not cls.runtime.exists():
            cls.runtime = Path("dotnet")
        cls.assembly = ROOT / "gateway/bin/Debug/net10.0/FieldOps.Gateway.dll"
        if not cls.assembly.exists():
            raise RuntimeError("Build gateway/FieldOps.Gateway.csproj first.")
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        cls.base = f"http://127.0.0.1:{port}"
        env = os.environ | {"ASPNETCORE_URLS": cls.base, "ASPNETCORE_ENVIRONMENT": "Development",
                            "OTEL_TRACES_EXPORTER": "none", "DOTNET_CLI_TELEMETRY_OPTOUT": "1"}
        (ROOT / ".local").mkdir(exist_ok=True)
        cls.log = (ROOT / ".local/gateway-security.log").open("w", encoding="utf-8")
        cls.process = subprocess.Popen([str(cls.runtime), str(cls.assembly)], cwd=ROOT, env=env,
                                       stdout=cls.log, stderr=subprocess.STDOUT,
                                       creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            try:
                if cls.request("/health/live")[0] == 200:
                    return
            except OSError:
                pass
            if cls.process.poll() is not None:
                break
            time.sleep(0.2)
        cls.tearDownClass()
        raise RuntimeError("Gateway did not become healthy; inspect .local/gateway-security.log")

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        cls.process.wait(timeout=10)
        cls.log.close()

    @classmethod
    def request(cls, path, headers=None):
        request = urllib.request.Request(cls.base + path, headers=headers or {})
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status, response.read(), dict(response.headers)
        except urllib.error.HTTPError as error:
            with error:
                return error.code, error.read(), dict(error.headers)

    def test_only_health_is_anonymous(self):
        self.assertEqual(200, self.request("/health/live")[0])
        for path in ["/api/session", "/api/work-orders", "/api/replay/00000000-0000-0000-0000-000000000000", "/api/intelligence/predict"]:
            with self.subTest(path=path):
                self.assertEqual(401, self.request(path)[0])

    def test_spoofed_identity_headers_do_not_authenticate(self):
        code, _, _ = self.request("/api/session", {"X-User-Id": "admin-01", "X-User-Role": "Administrator", "X-Team-Id": "north"})
        self.assertEqual(401, code)

    def test_query_token_cannot_authenticate_ordinary_api(self):
        self.assertEqual(401, self.request("/api/session?access_token=untrusted")[0])

    def test_invalid_bearer_is_rejected(self):
        self.assertEqual(401, self.request("/api/session", {"Authorization": "Bearer unsigned.invalid.token"})[0])

    def test_sensitive_responses_are_not_cached(self):
        code, _, headers = self.request("/api/session")
        self.assertEqual(401, code)
        self.assertEqual("no-store", headers.get("Cache-Control"))
        self.assertEqual("nosniff", headers.get("X-Content-Type-Options"))

    def test_unapproved_origin_gets_no_cors_allowance(self):
        _, _, headers = self.request("/api/session", {"Origin": "https://attacker.invalid"})
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_readiness_rejects_missing_business_services_while_process_is_live(self):
        self.assertEqual(200, self.request("/health/live")[0])
        self.assertEqual(503, self.request("/health/ready")[0])


if __name__ == "__main__":
    unittest.main()
