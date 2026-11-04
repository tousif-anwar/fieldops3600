"""Local integration-only PKCE login through the real Keycloak login form.

No password grant, auth bypass, token persistence, or credential output.
"""
from __future__ import annotations

import base64
from html.parser import HTMLParser
import http.cookiejar
import json
from pathlib import Path
import secrets
import hashlib
import urllib.error
import urllib.parse
import urllib.request


class LoginForm(HTMLParser):
    action = None

    def handle_starttag(self, tag, attrs):
        fields = dict(attrs)
        if tag == "form" and fields.get("id") == "kc-form-login":
            self.action = fields.get("action")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def local_environment(root: Path) -> dict[str, str]:
    return dict(line.split("=", 1) for line in (root / ".env").read_text(encoding="utf-8").splitlines() if line and not line.startswith("#"))


def login(root: Path, username: str) -> str:
    values = local_environment(root)
    authority = "http://localhost:8080/realms/fieldops/protocol/openid-connect"
    redirect = "http://localhost:5173/auth/callback"
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(24)
    cookie_jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(cookie_jar))
    query = urllib.parse.urlencode({"client_id": "fieldops-web", "redirect_uri": redirect, "response_type": "code", "scope": "openid profile email", "state": state, "nonce": secrets.token_urlsafe(24), "code_challenge": challenge, "code_challenge_method": "S256"})
    with opener.open(authority + "/auth?" + query, timeout=15) as response:
        form = LoginForm(); form.feed(response.read().decode())
    if not form.action or not form.action.startswith("http://localhost:8080/"):
        raise RuntimeError("Expected local Keycloak login form was not returned")
    # Browsers treat localhost as a secure context. urllib does not make that local-only
    # exception for Secure cookies, so mirror browser behavior for this fixed loopback URL.
    for cookie in cookie_jar:
        if cookie.domain in {"localhost", "localhost.local"}:
            cookie.secure = False
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(cookie_jar), NoRedirect())
    body = urllib.parse.urlencode({"username": username, "password": values["DEMO_PASSWORD"], "credentialId": ""}).encode()
    try:
        response = opener.open(urllib.request.Request(form.action, data=body, headers={"Content-Type": "application/x-www-form-urlencoded"}), timeout=15)
        response.close()
        raise RuntimeError("Login did not redirect; verify the local demo credentials")
    except urllib.error.HTTPError as error:
        location = error.headers.get("Location", "")
        error_html = error.read().decode(errors="replace") if error.code not in (302, 303) else ""
        error.close()
        if error.code not in (302, 303) or not location.startswith(redirect + "?"):
            messages = [reason for reason in ["Cookie not found", "Invalid request", "Invalid username or password", "HTTPS required", "expired", "Restart login", "Invalid redirect"] if reason.lower() in error_html.lower()]
            raise RuntimeError(f"Local identity login failed (HTTP {error.code}; redirect path {urllib.parse.urlparse(location).path}; reasons={messages})") from None
    parameters = urllib.parse.parse_qs(urllib.parse.urlparse(location).query)
    if parameters.get("state") != [state] or "code" not in parameters:
        raise RuntimeError("OIDC state/code validation failed")
    body = urllib.parse.urlencode({"grant_type": "authorization_code", "client_id": "fieldops-web", "redirect_uri": redirect, "code": parameters["code"][0], "code_verifier": verifier}).encode()
    with opener.open(urllib.request.Request(authority + "/token", data=body, headers={"Content-Type": "application/x-www-form-urlencoded"}), timeout=15) as response:
        return json.load(response)["access_token"]
