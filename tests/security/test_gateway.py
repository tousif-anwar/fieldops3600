"""Black-box gateway tests against a real process, with no authentication bypass."""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import socket
import subprocess
import time
from threading import Thread
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
        cls.assembly = ROOT / "gateway/bin" / os.environ.get("GATEWAY_BUILD_CONFIGURATION", "Debug") / "net10.0/FieldOps.Gateway.dll"
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
        for path in ["/api/session", "/api/work-orders", "/api/replay/00000000-0000-0000-0000-000000000000", "/api/optimizer/optimize", "/api/inventory/parts", "/api/inventory/consumptions"]:
            with self.subTest(path=path):
                self.assertEqual(401, self.request(path)[0])

    def test_spoofed_identity_headers_do_not_authenticate(self):
        for path in ["/api/session", "/api/inventory/parts"]:
            with self.subTest(path=path):
                code, _, _ = self.request(path, {"X-User-Id": "admin-01", "X-User-Role": "Administrator", "X-Team-Id": "north"})
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


class GatewayInventoryReadinessTests(unittest.TestCase):
    """A real gateway must probe Inventory along with every routed business host."""

    @classmethod
    def setUpClass(cls):
        cls.readiness = {name: True for name in ["customers", "assets", "work-orders", "technicians", "scheduling", "workflows", "notifications", "reporting", "inventory"]}
        readiness = cls.readiness

        class Upstream(BaseHTTPRequestHandler):
            def do_GET(self):
                pieces = self.path.strip("/").split("/")
                ready = len(pieces) == 3 and pieces[1:] == ["health", "ready"] and readiness.get(pieces[0], False)
                self.send_response(200 if ready else 503)
                self.end_headers()

            def log_message(self, *_args):
                pass

        cls.upstream = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
        cls.thread = Thread(target=cls.upstream.serve_forever, daemon=True)
        cls.thread.start()
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        cls.base = f"http://127.0.0.1:{port}"
        runtime = ROOT / ".tools/dotnet/dotnet.exe"
        if not runtime.exists():
            runtime = Path("dotnet")
        assembly = ROOT / "gateway/bin" / os.environ.get("GATEWAY_BUILD_CONFIGURATION", "Debug") / "net10.0/FieldOps.Gateway.dll"
        env = os.environ | {"ASPNETCORE_URLS": cls.base, "ASPNETCORE_ENVIRONMENT": "Development", "OTEL_TRACES_EXPORTER": "none"}
        env.update({"Services__" + name: f"http://127.0.0.1:{cls.upstream.server_port}/{name}" for name in cls.readiness})
        (ROOT / ".local").mkdir(exist_ok=True)
        cls.log = (ROOT / ".local/gateway-inventory-readiness.log").open("w", encoding="utf-8")
        cls.process = subprocess.Popen([str(runtime), str(assembly)], cwd=ROOT, env=env, stdout=cls.log, stderr=subprocess.STDOUT,
                                       creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            try:
                if cls.status("/health/live") == 200:
                    return
            except OSError:
                pass
            if cls.process.poll() is not None:
                break
            time.sleep(0.2)
        cls.tearDownClass()
        raise RuntimeError("Gateway inventory readiness test host did not start.")

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        cls.process.wait(timeout=10)
        cls.log.close()
        cls.upstream.shutdown()
        cls.upstream.server_close()
        cls.thread.join(timeout=5)

    @classmethod
    def status(cls, path):
        try:
            with urllib.request.urlopen(cls.base + path, timeout=6) as response:
                return response.status
        except urllib.error.HTTPError as error:
            with error:
                return error.code

    def setUp(self):
        for name in self.readiness:
            self.readiness[name] = True

    def test_all_nine_business_services_must_be_ready(self):
        self.assertEqual(200, self.status("/health/ready"))

    def test_inventory_failure_is_not_hidden_by_eight_healthy_services(self):
        self.readiness["inventory"] = False
        self.assertEqual(503, self.status("/health/ready"))
        self.assertEqual(200, self.status("/health/live"))

    def test_existing_business_failure_remains_a_readiness_failure(self):
        self.readiness["scheduling"] = False
        self.assertEqual(503, self.status("/health/ready"))


if __name__ == "__main__":
    unittest.main()
