# API gateway

YARP routes `/api/*` to the owning service and proxies the SignalR hub. Every API requires a signed Keycloak token for audience `fieldops-api`; each service repeats validation and resource authorization. Header identity spoofing is removed. Rate limits partition by authenticated subject. Only `/health/live` is anonymous. Logs omit query strings and token payloads.

Use `Auth__Authority` for the public issuer and `Auth__MetadataAddress` for reachable internal discovery. HTTP discovery is restricted to ASP.NET `Development`. The gateway does not mint tokens or offer a password grant. Browser and mobile clients use Authorization Code + S256 PKCE through Keycloak.

Intelligence endpoints require dispatcher, supervisor, manager or administrator roles and proxy to an internal Python worker. Predictions use supplied non-identifying features and remain advisory.
