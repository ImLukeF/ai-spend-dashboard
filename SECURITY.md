# Security policy

The latest release is supported. Scope includes the Worker, authentication, provider credentials, enforcement, outbound requests and persisted spend data.

Report privately using [GitHub Report a vulnerability](https://github.com/ImLukeF/burnrate/security/advisories/new). If private reporting is unavailable, contact the maintainer through GitHub with only a request for a private reporting channel. Do not post exploit details, credentials or account data in public issues. No email reporting address is published.

Provider admin keys may have full organisation privileges. Keep keys only in Worker secrets or ignored local variables. This project never asks for keys in issues, a hosted third-party dashboard or a public repository. Rotate provider admin keys and dashboard tokens immediately if exposed; rotating the dashboard token invalidates sessions. Review Cloudflare account access, audit logs, alert destinations and provider state after an incident.

Cloudflare Access is recommended. Token sessions are signed, expire after 12 hours and use HttpOnly/Secure/SameSite=Strict cookies. API auth fails closed. The read token cannot mutate state. Live enforcement requires explicit config plus the secret master switch; start with dry-run and sandbox targets. See [threat model and data flows](docs/privacy.md).
