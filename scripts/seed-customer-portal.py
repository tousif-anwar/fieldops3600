"""Provision two isolated synthetic portal accounts through local APIs and real Keycloak.

Runs only against fixed loopback services. Existing passwords and identities are preserved.
No generated customer ID or credential is printed. Re-running reuses the labeled accounts.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("local_auth", ROOT / "scripts/local-auth.py")
AUTH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUTH)


def main():
    values = AUTH.local_environment(ROOT)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def request(url, method="GET", data=None, token=None):
        headers = {"Authorization": "Bearer " + token} if token else {}
        if data is not None:
            headers["Content-Type"] = "application/json"
        with opener.open(urllib.request.Request(url, method=method, headers=headers,
                data=json.dumps(data).encode() if data is not None else None), timeout=25) as response:
            body = response.read()
            return json.loads(body) if body else None

    body = urllib.parse.urlencode({"grant_type": "password", "client_id": "admin-cli", "username": "local-admin", "password": values["KEYCLOAK_ADMIN_PASSWORD"]}).encode()
    with opener.open(urllib.request.Request("http://localhost:8080/realms/master/protocol/openid-connect/token", data=body), timeout=15) as response:
        admin_token = json.load(response)["access_token"]

    def admin(path, method="GET", data=None):
        return request("http://localhost:8080/admin/realms/fieldops" + path, method, data, admin_token)

    try:
        role = admin("/roles/Customer")
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        admin("/roles", "POST", {"name": "Customer"})
        role = admin("/roles/Customer")

    mapper = {"name": "customer-membership", "protocol": "openid-connect", "protocolMapper": "oidc-usermodel-attribute-mapper", "consentRequired": False,
        "config": {"user.attribute": "customer_id", "claim.name": "customer_id", "jsonType.label": "String", "id.token.claim": "true", "access.token.claim": "true", "userinfo.token.claim": "true"}}
    for name in ["fieldops-web", "fieldops-mobile"]:
        client = admin("/clients?clientId=" + name)[0]
        mappers = admin(f"/clients/{client['id']}/protocol-mappers/models")
        existing = next((item for item in mappers if item["name"] == mapper["name"]), None)
        if existing:
            admin(f"/clients/{client['id']}/protocol-mappers/models/{existing['id']}", "PUT", mapper | {"id": existing["id"]})
        else:
            admin(f"/clients/{client['id']}/protocol-mappers/models", "POST", mapper)

    dispatcher = AUTH.login(ROOT, "dispatcher")

    def api(path, method="GET", data=None):
        return request("http://localhost:5100" + path, method, data, dispatcher)

    for username, label in [("customer", "Synthetic Portal Customer"), ("customer-other", "Synthetic Isolated Customer")]:
        matches = api("/api/customers?search=" + urllib.parse.quote(label) + "&pageSize=100")["items"]
        customer = next((item for item in matches if item["displayName"] == label), None)
        if not customer:
            customer = api("/api/customers", "POST", {"displayName": label, "customerType": "Commercial", "teamId": "north", "preferredChannel": "None",
                "contacts": [], "locations": [{"name": "Demonstration Service Site", "addressLine1": "100 Synthetic Avenue", "addressLine2": None,
                    "city": "New York", "region": "NY", "postalCode": "10001", "countryCode": "US", "accessNotes": "Synthetic testing location only."}]})
        users = admin("/users?username=" + username + "&exact=true")
        if not users:
            admin("/users", "POST", {"username": username, "enabled": True, "email": username + "@example.invalid", "emailVerified": True,
                "firstName": "Synthetic", "lastName": "Customer", "credentials": [{"type": "password", "value": values["DEMO_PASSWORD"], "temporary": False}]})
            users = admin("/users?username=" + username + "&exact=true")
        user = users[0]
        # This script manages only the labeled local demonstration users.
        user.setdefault("attributes", {}).update({"team_id": ["north"], "customer_id": [customer["id"]]})
        admin("/users/" + user["id"], "PUT", user)
        admin("/users/" + user["id"] + "/role-mappings/realm", "POST", [role])

    # Keep bootstrap metadata in sync, without writing generated secrets to source control.
    realm_path = ROOT / "infrastructure/keycloak/realm.generated.json"
    if realm_path.exists():
        realm = json.loads(realm_path.read_text(encoding="utf-8"))
        if not any(item["name"] == "Customer" for item in realm["roles"]["realm"]):
            realm["roles"]["realm"].append({"name": "Customer"})
        for client in realm["clients"]:
            if client["clientId"] in ["fieldops-web", "fieldops-mobile"] and not any(item["name"] == mapper["name"] for item in client.get("protocolMappers", [])):
                client.setdefault("protocolMappers", []).append(mapper)
        realm_path.write_text(json.dumps(realm, indent=2) + "\n", encoding="utf-8")
    print("Provisioned isolated synthetic portal accounts: customer and customer-other. Existing credentials preserved.")


if __name__ == "__main__":
    main()
