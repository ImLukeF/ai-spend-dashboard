# Authentication

Static assets contain no spend data and are publicly served. Every API endpoint except `GET /api/v1/health` fails closed if auth is misconfigured. Health returns only `{ok:true}`. The public token-login endpoint is enabled only in token mode and still requires the JSON/CSRF request shape.

## Cloudflare Access (recommended)

Set `auth.mode:'access'`, `ACCESS_TEAM_DOMAIN` (an HTTPS `*.cloudflareaccess.com` origin) and `ACCESS_AUD`. The Worker fetches the team's JWKS through its injected fetch, caches for one hour, refreshes once for an unknown kid and verifies RS256 signatures, issuer, audience and expiration. It reads `Cf-Access-Jwt-Assertion`, falling back to `CF_Authorization` only when the header is absent. It does not rely on `ctx.access`.

`ALLOWED_EMAILS` restricts viewers if present. `ADMIN_EMAILS` restricts admin posts if present; otherwise an allowed human viewer is an admin. Access-issued service JWTs without email may GET data only when `ALLOWED_EMAILS` is unset; they can never use admin actions. Protect the application at the Access front door as well as in the Worker.

## Token sessions

Set a random `DASHBOARD_TOKEN` of at least 32 characters. The login form sends it over HTTPS; it is not kept in localStorage. SHA-256 digest comparison is constant-time. A signed cookie lasts 12 hours and is `HttpOnly; Secure; SameSite=Strict; Path=/`. The HMAC key derives with HKDF-SHA256 using salt `ai-spend-dashboard`, info `session-v1`. Rotating the token invalidates every session. Sign-out clears the cookie.

There is no user/account table or login lockout. Long random tokens resist guessing without allowing an attacker to lock out the administrator. Failed logins store only a daily hashed client address. Never log request headers or tokens.

## Script read token

An optional independent `READ_API_TOKEN` of at least 32 characters is a Bearer credential for **GET summary, spend and budgets (including budget detail) only**. Other routes return 403, including entities, events, exports, status, config and all mutations. It does not bypass misconfigured primary auth. Keep it in a local environment variable; see [API example](api.md).

POST and DELETE calls require `Content-Type: application/json`, `x-asd-csrf: 1`, and either no Origin or an Origin exactly matching the request origin. Bodies are limited to 16 KB. Token sessions are administrators; Access service identities and read tokens cannot mutate state.
