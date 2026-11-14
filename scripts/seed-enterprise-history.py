"""Create a larger, historical synthetic FieldOps enterprise dataset.

The operational records are created through authenticated APIs so the normal
validation, outbox, broker and warehouse paths stay authoritative. Technician
master rows are inserted directly because the technicians service intentionally
has no create endpoint; each row is then published through its real update API.
A final, explicitly synthetic backdating pass aligns the operational and
warehouse timelines so the web app and analytics show enterprise history rather
than a single import day.

Usage:
    python scripts/seed-enterprise-history.py
    python scripts/seed-enterprise-history.py --finalize-only

Existing records are preserved. Progress is resumable through
.local/enterprise-history.json. No passwords or database secrets are printed.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("enterprise_auth", ROOT / "scripts/local-auth.py")
AUTH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUTH)
BASE = "http://localhost:5100"
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
UTC = timezone.utc
TEAMS = ("north", "south", "west", "east")


def zone(name: str):
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError:
        # The local demo runs in UTC-equivalent working windows if Windows lacks tzdata.
        return timezone(timedelta(hours=-5), name)


TECH_SPECS = [
    {"username": "technician4", "preferred_id": "tech-04", "name": "Luis Ortega", "team": "south", "skills": ["HVAC", "Refrigeration"], "certifications": ["HVAC Safety", "EPA 608"], "timeZone": "America/New_York"},
    {"username": "technician5", "preferred_id": "tech-05", "name": "Naomi Park", "team": "south", "skills": ["HVAC", "Electrical", "Controls"], "certifications": ["HVAC Safety", "EPA 608"], "timeZone": "America/New_York"},
    {"username": "technician6", "preferred_id": "tech-06", "name": "Ethan Cole", "team": "west", "skills": ["HVAC", "Controls"], "certifications": ["HVAC Safety"], "timeZone": "America/Los_Angeles"},
    {"username": "technician7", "preferred_id": "tech-07", "name": "Maya Singh", "team": "west", "skills": ["HVAC", "Mechanical", "Refrigeration", "Electrical"], "certifications": ["HVAC Safety", "EPA 608"], "timeZone": "America/Los_Angeles"},
    {"username": "technician8", "preferred_id": "tech-08", "name": "Owen Bennett", "team": "east", "skills": ["HVAC", "Heating", "Ventilation"], "certifications": ["HVAC Safety"], "timeZone": "America/New_York"},
    {"username": "technician9", "preferred_id": "tech-09", "name": "Sofia Almeida", "team": "east", "skills": ["HVAC", "Electrical", "Refrigeration", "Controls"], "certifications": ["HVAC Safety", "EPA 608"], "timeZone": "America/New_York"},
]

ACCOUNT_SPECS = [
    *[{"username": x["username"], "preferred_id": x["preferred_id"], "first": x["name"].split()[0], "last": x["name"].split()[-1], "role": "Technician", "team": x["team"]} for x in TECH_SPECS],
    {"username": "dispatcher2", "preferred_id": "dispatcher-02", "first": "Riley", "last": "Morgan", "role": "Dispatcher", "team": "south"},
    {"username": "dispatcher3", "preferred_id": "dispatcher-03", "first": "Cameron", "last": "Ellis", "role": "Dispatcher", "team": "west"},
    {"username": "analyst2", "preferred_id": "analyst-02", "first": "Jordan", "last": "Kim", "role": "Analyst", "team": "south"},
    {"username": "analyst3", "preferred_id": "analyst-03", "first": "Priya", "last": "Shah", "role": "Analyst", "team": "west"},
    {"username": "admin2", "preferred_id": "admin-02", "first": "Morgan", "last": "Diaz", "role": "Administrator", "team": "north"},
    {"username": "admin3", "preferred_id": "admin-03", "first": "Rowan", "last": "Foster", "role": "Administrator", "team": "east"},
]

CUSTOMER_ROWS = [
    # key, display name, type, team, city, region, postal, street, contact
    ("northwind-property", "Northwind Property Group", "Commercial", "north", "Boston", "MA", "02110", "120 Atlantic Avenue", "Alicia Grant"),
    ("merrimack-medical", "Merrimack Medical Center", "Commercial", "north", "Cambridge", "MA", "02139", "55 Binney Street", "Daniel Wu"),
    ("harborview-residences", "Harborview Residences", "Residential", "north", "Portland", "ME", "04101", "18 Commercial Street", "Erin Walsh"),
    ("greenline-grocers", "Greenline Grocers", "Commercial", "north", "Providence", "RI", "02903", "240 Eddy Street", "Marcus Bell"),
    ("summit-ridge-apartments", "Summit Ridge Apartments", "Residential", "north", "Burlington", "VT", "05401", "77 Pine Street", "Nora Hayes"),
    ("charles-river-labs", "Charles River Labs", "Commercial", "north", "Waltham", "MA", "02451", "9 Winter Street", "Ibrahim Khan"),
    ("beacon-street-dental", "Beacon Street Dental", "Commercial", "north", "Boston", "MA", "02116", "311 Beacon Street", "Grace Lin"),
    ("granite-state-storage", "Granite State Storage", "Commercial", "north", "Manchester", "NH", "03101", "82 Elm Street", "Theo Martin"),
    ("piedmont-hospitality", "Piedmont Hospitality Group", "Commercial", "south", "Atlanta", "GA", "30303", "201 Peachtree Street", "Renee Carter"),
    ("magnolia-assisted-living", "Magnolia Assisted Living", "Commercial", "south", "Savannah", "GA", "31401", "44 Abercorn Street", "Derek Young"),
    ("gulf-coast-cold-storage", "Gulf Coast Cold Storage", "Commercial", "south", "Mobile", "AL", "36602", "150 Commerce Street", "Lena Brooks"),
    ("triangle-medical-plaza", "Triangle Medical Plaza", "Commercial", "south", "Raleigh", "NC", "27601", "320 Fayetteville Street", "Owen Price"),
    ("palmetto-retail", "Palmetto Retail Partners", "Commercial", "south", "Charleston", "SC", "29401", "88 Meeting Street", "Simone Reed"),
    ("blue-ridge-apartments", "Blue Ridge Apartments", "Residential", "south", "Asheville", "NC", "28801", "19 Patton Avenue", "Kyle Foster"),
    ("bayou-fresh-markets", "Bayou Fresh Markets", "Commercial", "south", "New Orleans", "LA", "70112", "410 Canal Street", "Amara Lewis"),
    ("queen-city-offices", "Queen City Offices", "Commercial", "south", "Charlotte", "NC", "28202", "120 Tryon Street", "Julian Hart"),
    ("cascadia-health", "Cascadia Health Network", "Commercial", "west", "Seattle", "WA", "98101", "700 Fifth Avenue", "Mina Patel"),
    ("golden-gate-property", "Golden Gate Property Trust", "Commercial", "west", "San Francisco", "CA", "94105", "45 Market Street", "Caleb Nguyen"),
    ("sierra-nevada-resorts", "Sierra Nevada Resorts", "Commercial", "west", "Reno", "NV", "89501", "100 Sierra Street", "Tessa Romero"),
    ("portland-craft-brewing", "Portland Craft Brewing", "Commercial", "west", "Portland", "OR", "97209", "212 NW Everett Street", "Hugo Larsen"),
    ("mojave-logistics", "Mojave Logistics Park", "Commercial", "west", "Phoenix", "AZ", "85004", "55 Van Buren Street", "Anika Rao"),
    ("pacific-ridge-apartments", "Pacific Ridge Apartments", "Residential", "west", "San Diego", "CA", "92101", "301 Harbor Drive", "Miles Cooper"),
    ("rockies-medical", "Rockies Medical Group", "Commercial", "west", "Denver", "CO", "80202", "1600 Broadway", "Sasha Bennett"),
    ("willamette-farms", "Willamette Valley Farms", "Commercial", "west", "Salem", "OR", "97301", "485 State Street", "Noah Fields"),
    ("hudson-valley-schools", "Hudson Valley Schools", "Commercial", "east", "Poughkeepsie", "NY", "12601", "30 Market Street", "Leah Cohen"),
    ("empire-state-retail", "Empire State Retail", "Commercial", "east", "New York", "NY", "10001", "250 West 34th Street", "Andre Washington"),
    ("garden-state-clinics", "Garden State Clinics", "Commercial", "east", "Newark", "NJ", "07102", "80 Broad Street", "Maya Fernandez"),
    ("delaware-river-foods", "Delaware River Foods", "Commercial", "east", "Wilmington", "DE", "19801", "12 Market Street", "Peter Okafor"),
    ("chesapeake-property", "Chesapeake Property Group", "Commercial", "east", "Baltimore", "MD", "21202", "100 Pratt Street", "Claire Morgan"),
    ("liberty-bell-offices", "Liberty Bell Offices", "Commercial", "east", "Philadelphia", "PA", "19106", "6 Chestnut Street", "Samir Haddad"),
    ("adirondack-lodges", "Adirondack Lodges", "Commercial", "east", "Lake Placid", "NY", "12946", "21 Main Street", "Elena Petrova"),
    ("capital-district-apartments", "Capital District Apartments", "Residential", "east", "Albany", "NY", "12207", "40 State Street", "Wes Turner"),
]

ASSET_TYPES = {
    "north": ["HVAC", "Refrigeration", "Electrical", "HVAC", "Controls", "HVAC", "Refrigeration", "Electrical"],
    "south": ["HVAC", "Refrigeration", "HVAC", "Electrical", "Controls", "HVAC", "Refrigeration", "Electrical"],
    "west": ["HVAC", "Controls", "Refrigeration", "HVAC", "Electrical", "HVAC", "Controls", "Refrigeration"],
    "east": ["HVAC", "Electrical", "HVAC", "Refrigeration", "Controls", "HVAC", "Electrical", "Controls"],
}
MANUFACTURERS = {
    "HVAC": [("Carrier", "48TC-06"), ("Trane", "Precedent YSC"), ("Lennox", "Model L"), ("Daikin", "Rebel RPS")],
    "Refrigeration": [("Hussmann", "Protocol Rack"), ("Hillphoenix", "CO2 Advansor"), ("True", "TS-49")],
    "Electrical": [("Schneider Electric", "PowerLogic ION"), ("Eaton", "Pow-R-Line C")],
    "Controls": [("Johnson Controls", "Metasys NAE"), ("Honeywell", "WEBs-AX")],
}
TITLES = {
    "HVAC": ["Quarterly rooftop unit maintenance", "Cooling loss diagnosis", "Preventive HVAC service", "Airflow and filter inspection"],
    "Refrigeration": ["Walk-in cooler temperature alarm", "Refrigeration rack preventive service", "Defrost cycle diagnosis", "Cold-room door and seal service"],
    "Electrical": ["Panel thermal inspection", "Emergency power test", "Electrical distribution service", "Breaker and load verification"],
    "Controls": ["Building controls calibration", "Thermostat and sensor verification", "Controls network diagnosis", "Sequence-of-operation check"],
}


def q(value) -> str:
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def qd(value: datetime | None) -> str:
    return "NULL" if value is None else q(value.astimezone(UTC).isoformat())


def psql(database: str, sql: str) -> str:
    process = subprocess.run(
        ["docker", "compose", "exec", "-T", "postgres", "psql", "-X", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1", "-A", "-t"],
        input=sql,
        text=True,
        capture_output=True,
        cwd=ROOT,
        timeout=90,
    )
    if process.returncode != 0:
        raise RuntimeError(f"PostgreSQL command failed for {database}: {process.stderr.strip()[:500]}")
    return process.stdout


def http_json(method: str, url: str, body=None, headers=None):
    request = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                     headers={"Accept": "application/json", **(headers or {})})
    if body is not None:
        request.add_header("Content-Type", "application/json")
    try:
        with OPENER.open(request, timeout=30) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        raw = error.read().decode(errors="replace")
        try:
            parsed = json.loads(raw)
        except ValueError:
            parsed = raw
        return error.code, parsed


class Api:
    def __init__(self):
        self.token = None

    def login(self):
        self.token = AUTH.login(ROOT, "administrator")

    def request(self, method: str, path: str, body=None, key=None, allowed=(200, 201)):
        if self.token is None:
            self.login()
        for attempt in range(2):
            headers = {"Authorization": "Bearer " + self.token}
            if key:
                headers["Idempotency-Key"] = key
            status, data = http_json(method, BASE + path, body, headers)
            if status == 401 and attempt == 0:
                self.login()
                continue
            if status not in allowed:
                detail = data.get("detail", data.get("title", "")) if isinstance(data, dict) else str(data)[:200]
                raise RuntimeError(f"{method} {path}: HTTP {status}; {detail}")
            return data
        raise RuntimeError("API authentication refresh failed")


def admin_token() -> str:
    values = AUTH.local_environment(ROOT)
    body = urllib.parse.urlencode({
        "grant_type": "password", "client_id": "admin-cli", "username": "local-admin",
        "password": values["KEYCLOAK_ADMIN_PASSWORD"],
    }).encode()
    with OPENER.open(urllib.request.Request(
        "http://localhost:8080/realms/master/protocol/openid-connect/token", data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"}), timeout=20) as response:
        return json.load(response)["access_token"]


class Keycloak:
    def __init__(self):
        self.token = admin_token()

    def refresh(self):
        self.token = admin_token()

    def call(self, method, path, body=None, allowed=(200, 201, 204)):
        for attempt in range(2):
            status, data = http_json(method, "http://localhost:8080/admin/realms/fieldops" + path, body,
                                     {"Authorization": "Bearer " + self.token})
            if status == 401 and attempt == 0:
                self.refresh()
                continue
            if status not in allowed:
                raise RuntimeError(f"Keycloak {method} {path}: HTTP {status}; {str(data)[:240]}")
            return data
        raise RuntimeError("Keycloak administrator authentication refresh failed")

    def ensure_user_profile(self):
        """Allow the local administrator to write the team claim used by every service."""
        profile = self.call("GET", "/users/profile")
        if profile.get("unmanagedAttributePolicy") != "ADMIN_EDIT":
            profile["unmanagedAttributePolicy"] = "ADMIN_EDIT"
            self.call("PUT", "/users/profile", profile)

    def ensure_accounts(self, state: dict):
        values = AUTH.local_environment(ROOT)
        password = values["DEMO_PASSWORD"]
        accounts = state.setdefault("accounts", [])
        self.ensure_user_profile()
        for spec in ACCOUNT_SPECS:
            existing = next((x for x in accounts if x["username"] == spec["username"]), None)
            if existing:
                user = self.call("GET", "/users/" + existing["id"])
            else:
                found = self.call("GET", "/users?username=" + urllib.parse.quote(spec["username"]) + "&exact=true")
                if found:
                    user = found[0]
                else:
                    body = {
                        "id": spec["preferred_id"], "username": spec["username"],
                        "firstName": spec["first"], "lastName": spec["last"],
                        "email": f"{spec['username']}@example.invalid", "emailVerified": True, "enabled": True,
                        "attributes": {"team_id": [spec["team"]]},
                        "credentials": [{"type": "password", "value": password, "temporary": False}],
                    }
                    try:
                        self.call("POST", "/users", body)
                    except RuntimeError:
                        # Some Keycloak versions reject a caller-supplied id; create normally and use its id.
                        body.pop("id", None)
                        self.call("POST", "/users", body)
                    found = self.call("GET", "/users?username=" + urllib.parse.quote(spec["username"]) + "&exact=true")
                    if not found:
                        raise RuntimeError("Keycloak did not return the created user " + spec["username"])
                    user = found[0]
            # The declarative user profile silently drops unmanaged attributes unless
            # the policy above is set. Re-apply the team claim every run so migrated
            # accounts and accounts created by an older version converge.
            full = self.call("GET", "/users/" + user["id"])
            attributes = dict(full.get("attributes") or {})
            if attributes.get("team_id") != [spec["team"]]:
                attributes["team_id"] = [spec["team"]]
                full["attributes"] = attributes
                self.call("PUT", "/users/" + user["id"], full)
            role = self.call("GET", "/roles/" + urllib.parse.quote(spec["role"]))
            mappings = self.call("GET", f"/users/{user['id']}/role-mappings/realm")
            if spec["role"] not in {item["name"] for item in mappings}:
                self.call("POST", f"/users/{user['id']}/role-mappings/realm", [role])
            record = {
                "username": spec["username"], "id": user["id"], "role": spec["role"],
                "team": spec["team"], "name": spec["first"] + " " + spec["last"],
            }
            if existing:
                existing.update(record)
            else:
                accounts.append(record)
            save(state)
            print(f"Identity ready: {spec['username']} ({spec['role']}, {spec['team']})", flush=True)
        return accounts


def save(state: dict):
    path = Path(state["manifest"])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")


def wait_for(probe, label: str, seconds=60):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = probe()
        if value:
            return value
        time.sleep(0.5)
    raise RuntimeError("Timed out waiting for " + label)


def ensure_technicians(api: Api, state: dict, accounts: list[dict]):
    db_team = {x["username"]: x for x in accounts if x["role"] == "Technician"}
    for spec in TECH_SPECS:
        account = db_team.get(spec["username"])
        if not account:
            raise RuntimeError("Missing technician account " + spec["username"])
        tech_id = account["id"]
        row = {
            "id": tech_id, "name": spec["name"], "teamId": spec["team"], "supervisorId": f"supervisor-{spec['team']}",
            "skills": spec["skills"], "certifications": spec["certifications"],
            "workingStartHour": 8, "workingEndHour": 18, "timeZone": spec["timeZone"], "available": True,
        }
        psql("fieldops_technicians", (
            'INSERT INTO technicians ("Id","Name","TeamId","SupervisorId","SkillsJson","CertificationsJson",'
            '"WorkingStartHour","WorkingEndHour","TimeZone","Available","Version") VALUES ('
            f"{q(row['id'])},{q(row['name'])},{q(row['teamId'])},{q(row['supervisorId'])},"
            f"{q(json.dumps(row['skills']))},{q(json.dumps(row['certifications']))},8,18,{q(row['timeZone'])},true,1)"
            ' ON CONFLICT ("Id") DO NOTHING;'
        ))
        current = api.request("GET", "/api/technicians/" + urllib.parse.quote(tech_id))
        body = {**row, "version": current["version"]}
        api.request("PUT", "/api/technicians/" + urllib.parse.quote(tech_id), body)
        # Publishing every profile also creates warehouse technician-dimension evidence
        # for the profiles that were previously present only in the bootstrap database.
        if not any(x["id"] == tech_id for x in state.setdefault("techProfiles", [])):
            state["techProfiles"].append({"id": tech_id, "username": spec["username"], "team": spec["team"], "name": spec["name"]})
        save(state)
        print(f"Technician ready: {spec['name']} ({tech_id}, {spec['team']})", flush=True)
    # Publish existing bootstrap profiles so their historical working-hours version is warehouse-backed.
    existing = api.request("GET", "/api/technicians")
    for tech in existing:
        if tech["id"] in {x["id"] for x in state.get("techProfiles", [])}:
            continue
        if not tech.get("timeZone"):
            tech["timeZone"] = "America/New_York"
        body = {key: tech[key] for key in ("name", "teamId", "supervisorId", "skills", "certifications", "workingStartHour", "workingEndHour", "timeZone", "available", "version")}
        api.request("PUT", "/api/technicians/" + urllib.parse.quote(tech["id"]), body)
        if not any(x["id"] == tech["id"] for x in state.setdefault("techProfiles", [])):
            state["techProfiles"].append({"id": tech["id"], "username": None, "team": tech["teamId"], "name": tech["name"]})
        save(state)


def customer_specs():
    for index, row in enumerate(CUSTOMER_ROWS):
        key, name, kind, team, city, region, postal, street, contact = row
        first, last = contact.split(" ", 1)
        yield {
            "key": key, "name": name, "type": kind, "team": team, "city": city, "region": region,
            "postal": postal, "street": street, "contact": contact,
            "email": f"{first.lower()}.{last.lower().replace(' ', '')}@example.com",
            "phone": f"+1 555 01{index:02d}",
            "assetType": ASSET_TYPES[team][index % 8],
        }


def ensure_customers_assets(api: Api, state: dict):
    customers = state.setdefault("customers", [])
    assets = state.setdefault("assets", [])
    batch = state["batchId"]
    for index, spec in enumerate(customer_specs()):
        existing = next((x for x in customers if x["key"] == spec["key"]), None)
        if existing:
            continue
        preferred = "Email" if index % 3 else "Phone"
        body = {
            "displayName": spec["name"], "customerType": spec["type"], "teamId": spec["team"],
            "status": "Active", "preferredChannel": preferred,
            "contacts": [{"fullName": spec["contact"], "email": spec["email"], "phone": spec["phone"],
                          "isPrimary": True, "emailConsent": True, "phoneConsent": preferred == "Phone"}],
            "locations": [{"name": spec["name"] + " service site", "addressLine1": spec["street"],
                           "addressLine2": "Synthetic enterprise history site", "city": spec["city"],
                           "region": spec["region"], "postalCode": spec["postal"], "countryCode": "US",
                           "accessNotes": "Synthetic local demonstration record; no real customer visit.", "status": "Active"}],
        }
        customer = api.request("POST", "/api/customers", body, key=f"enterprise-{batch}-customer-{index:02d}")
        record = {"key": spec["key"], "id": customer["id"], "name": spec["name"], "team": spec["team"],
                  "type": spec["type"], "locationId": customer["locations"][0]["id"], "version": customer["version"],
                  "createdAtUtc": customer["createdAtUtc"]}
        customers.append(record)
        save(state)
        print(f"Customer ready: {spec['name']}", flush=True)
        manufacturer, model = MANUFACTURERS[spec["assetType"]][index % len(MANUFACTURERS[spec["assetType"]])]
        installed = datetime.now(UTC) - timedelta(days=600 + index * 43)
        warranty = installed + timedelta(days=365 * 6) if index % 4 else installed + timedelta(days=365)
        asset_body = {
            "name": f"{spec['assetType']} {manufacturer} unit", "assetType": spec["assetType"],
            "manufacturer": manufacturer, "model": model, "serialNumber": f"ENT-{batch}-{index:03d}",
            "qrCode": f"FIELDOPS-ENT-{batch}-{index:03d}", "criticality": ["Low", "Medium", "High", "Critical"][index % 4],
            "customerId": customer["id"], "serviceLocationId": customer["locations"][0]["id"],
            "customerVersion": customer["version"], "parentAssetId": None,
            "installedAtUtc": installed.isoformat(), "warrantyEndUtc": warranty.isoformat(),
        }
        asset = api.request("POST", "/api/assets", asset_body, key=f"enterprise-{batch}-asset-{index:02d}")
        assets.append({"key": spec["key"], "id": asset["id"], "customerId": customer["id"],
                       "name": asset["name"], "assetType": asset["assetType"], "team": spec["team"]})
        save(state)


def local_start(day_offset: int, time_zone: str, hour=9):
    tz = zone(time_zone)
    day = (datetime.now(UTC).astimezone(tz) - timedelta(days=day_offset)).date()
    while day.weekday() > 4:
        day -= timedelta(days=1)
    return datetime(day.year, day.month, day.day, hour, 0, tzinfo=tz).astimezone(UTC)


def ensure_orders(api: Api, state: dict, accounts: list[dict]):
    customers = state["customers"]
    assets = state["assets"]
    asset_by_key = {x["key"]: x for x in assets}
    team_profiles = state.get("techProfiles", [])
    # Refresh technician profiles so bootstrap rows and newly published rows are both available.
    all_techs = api.request("GET", "/api/technicians")
    tech_by_id = {t["id"]: t for t in all_techs}
    orders = state.setdefault("orders", [])
    existing_ids = {x["id"] for x in orders}
    batch = state["batchId"]
    now = datetime.now(UTC)

    planned = []
    for team_index, team in enumerate(TEAMS):
        team_customers = [x for x in customers if x["team"] == team]
        team_customers.sort(key=lambda x: x["key"])
        if len(team_customers) < 8:
            raise RuntimeError("Not enough customers for team " + team)
        for index in range(6):
            planned.append((team, team_customers[index], "Completed", index))
        planned.append((team, team_customers[6], "Active", 6))
        special = "Unassigned" if team in ("north", "west") else "Cancelled"
        planned.append((team, team_customers[7], special, 7))

    for plan_index, (team, customer, kind, position) in enumerate(planned):
        asset = asset_by_key[customer["key"]]
        category = asset["assetType"]
        if category not in TITLES:
            category = "HVAC"
        techs = [tech_by_id[x["id"]] for x in team_profiles if x["team"] == team and x["id"] in tech_by_id]
        qualified = [t for t in techs if category in t.get("skills", []) and "HVAC Safety" in t.get("certifications", [])]
        if not qualified:
            qualified = [t for t in techs if "HVAC Safety" in t.get("certifications", [])]
        if not qualified:
            raise RuntimeError("No qualified technician for " + team + "/" + category)
        tech = qualified[position % len(qualified)]
        title = TITLES[category][position % len(TITLES[category])]
        priority = ["Normal", "High", "Critical", "Low", "High", "Normal"][position % 6]
        existing = next((x for x in orders if x.get("planIndex") == plan_index), None)
        if existing:
            continue
        body = {
            "title": title, "customerId": customer["id"], "serviceLocationId": customer["locationId"],
            "assetId": asset["id"], "teamId": team, "serviceCategory": category, "priority": priority,
        }
        order = api.request("POST", "/api/work-orders", body)
        suffix = secrets.token_hex(3).upper()
        record = {
            "planIndex": plan_index, "id": order["id"], "originalNumber": order["number"],
            "kind": kind, "team": team, "techId": tech["id"], "techName": tech["name"],
            "serviceCategory": category, "priority": priority, "suffix": suffix,
            "bookingStartUtc": None, "bookingEndUtc": None, "bookingId": None,
            "workflowId": None, "workflowTarget": 8 if kind == "Completed" else 3 if kind == "Active" else 0,
            "workflowStages": None, "customerKey": customer["key"], "assetId": asset["id"],
        }
        if kind in ("Completed", "Active"):
            tz = tech.get("timeZone", "America/New_York")
            if kind == "Completed":
                start = local_start(55 + plan_index * 17, tz, 9)
            else:
                start = local_start(0, tz, 8)
            end = start + timedelta(hours=4)
            booking = None
            for shift in range(8):
                candidate = start + timedelta(days=shift)
                if candidate.weekday() > 4:
                    continue
                try:
                    booking = api.request("POST", "/api/bookings", {
                        "workOrderId": order["id"], "technicianId": tech["id"],
                        "startUtc": candidate.isoformat(), "endUtc": (candidate + timedelta(hours=4)).isoformat(),
                        "overrideReason": None,
                    })
                    start = candidate
                    break
                except RuntimeError as error:
                    if "HTTP 409" not in str(error) and "HTTP 400" not in str(error):
                        raise
            if booking is None:
                raise RuntimeError("Could not book a historical slot for " + order["id"])
            record.update(bookingId=booking["id"], bookingStartUtc=start.isoformat(), bookingEndUtc=(start + timedelta(hours=4)).isoformat())
            wait_for(lambda: api.request("GET", "/api/work-orders/" + order["id"]).get("technicianId") == tech["id"],
                     "booking assignment " + order["id"])
            workflow = api.request("POST", "/api/workflows", {"workOrderId": order["id"]})
            record["workflowId"] = workflow["id"]
            target = record["workflowTarget"]
            template = api.request("GET", "/api/workflows/templates/default")
            current = workflow
            while current["status"] == "Active" and current["currentStageIndex"] < target:
                index = current["currentStageIndex"]
                fields = template["stages"][index]["fields"]
                answers = {}
                for field in fields:
                    if field.get("conditionField") and answers.get(field["conditionField"]) != field.get("conditionValue"):
                        continue
                    if field.get("inputType") in ("number", "text"):
                        answers[field["key"]] = "45" if field["inputType"] == "number" else "Synthetic history service evidence. No real customer data."
                        continue
                    choices = field["options"]
                    answers[field["key"]] = next((choice for choice in ["Accept", "Ready", "Arrived", "Accessible", "Good", "None", "Passed", "Confirmed", "Completed"] if choice in choices), choices[0])
                current = api.request("POST", f"/api/workflows/{current['id']}/submit", {
                    "expectedVersion": current["version"],
                    "idempotencyKey": f"enterprise-{batch}-{order['id']}-{index}",
                    "answers": answers, "offline": False,
                })
            record["workflowStages"] = current["stages"]
            orders.append(record)
            save(state)
            print(f"Order ready: {kind} {category} {customer['name']} ({tech['name']})", flush=True)
        elif kind == "Cancelled":
            current_order = api.request("GET", "/api/work-orders/" + order["id"])
            api.request("PUT", "/api/work-orders/" + order["id"], {
                "expectedVersion": current_order["version"], "title": title, "priority": priority, "status": "Cancelled",
            })
            orders.append(record)
            save(state)
            print(f"Order ready: Cancelled {category} {customer['name']}", flush=True)
        else:
            orders.append(record)
            save(state)
            print(f"Order ready: Unassigned {category} {customer['name']}", flush=True)

    # Wait for the broker and warehouse to catch up before applying the synthetic timeline.
    ids = [x["id"] for x in orders]
    if ids:
        id_literals = ",".join(q(x) for x in ids)
        wait_for(lambda: int(psql("fieldops_warehouse", f"SELECT count(*) FROM warehouse.fact_work_order WHERE work_order_id IN ({id_literals});").strip() or 0) >= len(ids),
                 "warehouse work-order projection", 90)
    return orders


def shifted_stages(record: dict):
    base = datetime.fromisoformat(record["bookingStartUtc"].replace("Z", "+00:00"))
    stages = record.get("workflowStages") or []
    kind = record["kind"]
    result = []
    durations = [15, 20, 18, 22, 25, 16, 14, 10]
    if kind == "Completed":
        # Every sixth job has one realistic breach; the others remain compliant.
        breach_index = 4 if record["planIndex"] % 6 == 0 else None
        cursor = base
        for stage in stages:
            index = stage["index"]
            duration = durations[index]
            if index == breach_index:
                duration = 38
            started = cursor
            deadline = started + timedelta(minutes=30)
            completed = started + timedelta(minutes=duration)
            item = dict(stage)
            item.update(startedAtUtc=started.isoformat(), deadlineUtc=deadline.isoformat(),
                        completedAtUtc=completed.isoformat(), pausedAtUtc=None, pausedSeconds=0,
                        status="Completed", warningLevel=3 if duration >= 30 else 0,
                        slaStatus="Breached" if duration >= 30 else "OnTime")
            result.append(item)
            cursor = completed
        return result
    if kind == "Active":
        cursor = base
        for stage in stages:
            index = stage["index"]
            item = dict(stage)
            if index < record["workflowTarget"]:
                duration = durations[index]
                started = cursor
                completed = started + timedelta(minutes=duration)
                item.update(startedAtUtc=started.isoformat(), deadlineUtc=(started + timedelta(minutes=30)).isoformat(),
                            completedAtUtc=completed.isoformat(), pausedAtUtc=None, pausedSeconds=0,
                            status="Completed", warningLevel=0, slaStatus="OnTime")
                cursor = completed
            elif index == record["workflowTarget"]:
                started = cursor
                item.update(startedAtUtc=started.isoformat(), deadlineUtc=(started + timedelta(minutes=30)).isoformat(),
                            completedAtUtc=None, pausedAtUtc=None, pausedSeconds=0,
                            status="Active", warningLevel=3, slaStatus="Breached")
            else:
                item.update(startedAtUtc=None, deadlineUtc=None, completedAtUtc=None, pausedAtUtc=None,
                            pausedSeconds=0, status="Pending", warningLevel=0, slaStatus="OnTime")
            result.append(item)
        return result
    return []


def finalize(api: Api, state: dict):
    orders = state.get("orders", [])
    if not orders:
        raise RuntimeError("No seeded orders are available to finalize")
    # Customers and assets are older than their service histories.
    companies = "\n".join(
        f'UPDATE customers SET "CreatedAtUtc"={qd(datetime.now(UTC) - timedelta(days=950 + i * 3))}, '
        f'"UpdatedAtUtc"={qd(datetime.now(UTC) - timedelta(days=950 + i * 3))} WHERE "Id"={q(x["id"])};'
        for i, x in enumerate(state["customers"])
    )
    psql("fieldops_customers", companies)
    asset_sql = "\n".join(
        f'UPDATE assets SET "CreatedAtUtc"={qd(datetime.now(UTC) - timedelta(days=980 + i * 3))}, '
        f'"UpdatedAtUtc"={qd(datetime.now(UTC) - timedelta(days=980 + i * 3))} WHERE "Id"={q(x["id"])};'
        for i, x in enumerate(state["assets"])
    )
    psql("fieldops_assets", asset_sql)

    now = datetime.now(UTC)
    for index, order in enumerate(orders):
        kind = order["kind"]
        if kind in ("Completed", "Active"):
            stages = shifted_stages(order)
            if not stages:
                raise RuntimeError("Missing workflow stages for " + order["id"])
            base = datetime.fromisoformat(order["bookingStartUtc"].replace("Z", "+00:00"))
            created = base - timedelta(days=2)
            completed = base + timedelta(minutes=sum([15, 20, 18, 22, 25, 16, 14, 10])) if kind == "Completed" else None
            # Use the actual last stage timestamp for completion, including breach padding.
            if kind == "Completed":
                completed = datetime.fromisoformat(stages[-1]["completedAtUtc"].replace("Z", "+00:00"))
            number = f"WO-{created:%Y%m%d}-{order['suffix']}"
            order.update(createdAtUtc=created.isoformat(), completedAtUtc=completed.isoformat() if completed else None,
                         finalNumber=number, stages=stages)
            status = "Completed" if kind == "Completed" else "InProgress"
            workflow_completed = completed.isoformat() if completed else None
            notification_date = completed if completed else base
            psql("fieldops_work_orders",
                 f'UPDATE work_orders SET "Number"={q(number)}, "CreatedAtUtc"={qd(created)}, '
                 f'"CompletedAtUtc"={qd(completed)}, "Status"={q(status)} WHERE "Id"={q(order["id"])};')
            psql("fieldops_workflows",
                 f'UPDATE workflows SET "StartedAtUtc"={qd(base)}, "CompletedAtUtc"={qd(datetime.fromisoformat(workflow_completed) if workflow_completed else None)}, '
                 f'"StagesJson"={q(json.dumps(stages))}::jsonb WHERE "Id"={q(order["workflowId"])};')
            psql("fieldops_notifications",
                 f'UPDATE notifications SET "CreatedAtUtc"={qd(notification_date)} WHERE "WorkOrderId"={q(order["id"])};')
        else:
            created = now - timedelta(days=28 + index * 3)
            number = f"WO-{created:%Y%m%d}-{order['suffix']}"
            order.update(createdAtUtc=created.isoformat(), completedAtUtc=None, finalNumber=number, stages=[])
            status = "Cancelled" if kind == "Cancelled" else "Created"
            psql("fieldops_work_orders",
                 f'UPDATE work_orders SET "Number"={q(number)}, "CreatedAtUtc"={qd(created)}, '
                 f'"CompletedAtUtc"=NULL, "Status"={q(status)} WHERE "Id"={q(order["id"])};')
        save(state)

    # Synchronize the warehouse facts after all API events have projected.
    # This is the explicitly synthetic timeline correction; audit/replay evidence
    # remains append-only and retains the real import timestamps.
    for order in orders:
        created = datetime.fromisoformat(order["createdAtUtc"])
        completed = datetime.fromisoformat(order["completedAtUtc"]) if order.get("completedAtUtc") else None
        status = "Completed" if order["kind"] == "Completed" else "InProgress" if order["kind"] == "Active" else "Cancelled" if order["kind"] == "Cancelled" else "Created"
        key = int(created.strftime("%Y%m%d"))
        local_day = created.date()
        psql("fieldops_warehouse", (
            "INSERT INTO warehouse.dim_date(date_key,calendar_date,calendar_year,calendar_month,day_of_week) VALUES ("
            f"{key},{q(local_day.isoformat())},{local_day.year},{local_day.month},{local_day.isoweekday()}) ON CONFLICT DO NOTHING;"
            f"UPDATE warehouse.fact_work_order SET number={q(order['finalNumber'])}, "
            f"status_key=(SELECT status_key FROM warehouse.dim_work_order_status WHERE status={q(status)}), "
            f"created_date_key={key}, created_at_utc={qd(created)}, completed_at_utc={qd(completed)}, "
            f"last_occurrence_utc={qd(completed or created)}, order_source_occurred_at_utc={qd(completed or created)}, "
            f"source_status={q(status)}, workflow_started_at_utc={qd(datetime.fromisoformat(order['bookingStartUtc'])) if order.get('bookingStartUtc') else 'NULL'}, "
            f"last_ingested_at_utc=now() WHERE work_order_id={q(order['id'])};"
        ))
        for stage in order.get("stages", []):
            started = stage.get("startedAtUtc")
            deadline = stage.get("deadlineUtc")
            finished = stage.get("completedAtUtc")
            stage_status = stage.get("status", "Completed")
            breached = stage.get("slaStatus") == "Breached"
            psql("fieldops_warehouse", (
                "UPDATE warehouse.fact_workflow_stage SET "
                f"started_at_utc={qd(datetime.fromisoformat(started)) if started else 'NULL'}, "
                f"deadline_utc={qd(datetime.fromisoformat(deadline)) if deadline else 'NULL'}, "
                f"completed_at_utc={qd(datetime.fromisoformat(finished)) if finished else 'NULL'}, "
                f"paused_seconds=0, breached={str(breached).lower()}, status={q(stage_status)}, "
                f"sla_status={q(stage.get('slaStatus', 'OnTime'))} "
                f"WHERE stage_instance_id={q(stage['id'])};"
            ))
        save(state)
    state["finalizedAtUtc"] = now.isoformat()
    save(state)
    print("Historical timeline synchronized to operational databases and warehouse facts.", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=ROOT / ".local/enterprise-history.json")
    parser.add_argument("--finalize-only", action="store_true")
    args = parser.parse_args()
    state = json.loads(args.manifest.read_text()) if args.manifest.exists() else {
        "synthetic": True, "batchId": secrets.token_hex(5), "manifest": str(args.manifest),
        "startedAtUtc": datetime.now(UTC).isoformat(), "customers": [], "assets": [], "orders": [],
        "accounts": [], "techProfiles": [],
    }
    state["manifest"] = str(args.manifest)
    save(state)
    api = Api()
    api.login()
    if args.finalize_only:
        finalize(api, state)
        return
    kc = Keycloak()
    accounts = kc.ensure_accounts(state)
    ensure_technicians(api, state, accounts)
    ensure_customers_assets(api, state)
    ensure_orders(api, state, accounts)
    finalize(api, state)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Seeding stopped: {type(error).__name__}: {error}", file=sys.stderr)
        raise
