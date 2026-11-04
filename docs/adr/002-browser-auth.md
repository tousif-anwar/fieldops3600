# ADR 002: Public PKCE clients and short-lived access tokens

Status: accepted, 2026-11-04.

Web and mobile use Keycloak Authorization Code Flow with S256 PKCE. Direct password and implicit grants are disabled. Web access tokens live in memory; mobile uses platform secure storage. All APIs verify signature, issuer, audience, expiry and role. Team and assignment checks happen in each service.

A full BFF would protect tokens behind an HttpOnly cookie but requires CSRF protection, a server session store and mobile-specific token paths. For this local portfolio deployment, a public PKCE client avoids introducing those session components. Tradeoff: browser script compromise can access in-memory tokens, so the web server applies a restrictive CSP and avoids unsafe HTML rendering. Production requirements may justify replacing the web path with a BFF.

The integration client uses confidential client credentials only for explicit local demonstrations, and its generated secret stays in ignored files. It is not a user login mechanism.
