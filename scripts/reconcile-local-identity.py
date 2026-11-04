"""Apply local generated client configuration using the bootstrap administrator.

Only localhost identity is supported. Existing users and passwords are preserved.
"""
import importlib.util
import json
from pathlib import Path
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("local_auth", ROOT / "scripts/local-auth.py")
AUTH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUTH)


def main():
    values = AUTH.local_environment(ROOT)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    body = urllib.parse.urlencode({"grant_type": "password", "client_id": "admin-cli", "username": "local-admin", "password": values["KEYCLOAK_ADMIN_PASSWORD"]}).encode()
    # Bootstrap administration uses Keycloak's admin-cli; public application clients still disable password grants.
    with opener.open(urllib.request.Request("http://localhost:8080/realms/master/protocol/openid-connect/token", data=body), timeout=15) as response:
        token = json.load(response)["access_token"]

    def call(path, method="GET", data=None):
        headers = {"Authorization": "Bearer " + token}
        encoded = None
        if data is not None:
            headers["Content-Type"] = "application/json"
            encoded = json.dumps(data).encode()
        with opener.open(urllib.request.Request("http://localhost:8080/admin/realms/fieldops" + path, data=encoded, headers=headers, method=method), timeout=15) as response:
            result = response.read()
            return json.loads(result) if result else None

    scopes = {scope["name"]: scope["id"] for scope in call("/client-scopes")}
    desired = json.loads((ROOT / "infrastructure/keycloak/realm.generated.json").read_text(encoding="utf-8"))
    for client in desired["clients"]:
        matches = call("/clients?clientId=" + urllib.parse.quote(client["clientId"]))
        if not matches:
            call("/clients", "POST", client)
            matches = call("/clients?clientId=" + urllib.parse.quote(client["clientId"]))
        for name in client.get("defaultClientScopes", []):
            if name not in scopes:
                raise RuntimeError("Missing built-in OIDC client scope: " + name)
            call(f"/clients/{matches[0]['id']}/default-client-scopes/{scopes[name]}", "PUT")
    print("Local OIDC client scopes reconciled. Existing identities and passwords preserved; application password grants remain disabled.")


if __name__ == "__main__":
    main()
