# Privacy and threat model

The operator owns the Worker and D1 database. There is no telemetry, analytics script or third-party frontend asset. This is a single-account-per-provider tool, not a hosted multi-tenant service.

| Flow                              | Data                                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| Worker → configured provider      | That provider's admin credential, report window and grouping; only its fixed HTTPS origin      |
| Provider → D1                     | Selected entity IDs/names/status, aggregate token/request counts, costs and timestamps         |
| Worker → Frankfurter              | Currency quotes and date range only; no provider keys or entity IDs                            |
| Worker → configured alert channel | Budget/status summary, basis, freshness, truncated enforcement target; no provider credentials |
| Browser → Worker                  | Auth cookie/JWT and read queries; credentials never stored in localStorage                     |
| Worker → D1 audit                 | Administrative transitions and a daily hashed client address for failed logins                 |

No prompts, completions or end-user emails are collected from provider usage APIs. Viewer identity comes from Access only when used; do not enable public logging of headers or responses. Secrets are not stored in D1, shown by status/config, or attached to channel/FX requests. Provider key hints and OpenAI redacted key values are discarded.

Considered threats include internet scanners, stolen sessions, provider-supplied XSS, compromised/oversized responses, configuration mistakes, credential exposure and dependency compromise. Controls include fail-closed auth, verified Access JWTs, signed/expiring cookies, CSRF checks, strict CSP, escaped UI/HTML, bounded bodies/timeouts, schemas, fixed provider origins/no redirects, read-only configuration, explicit reversible enforcement and repository secret scanning. The operator controls channel URLs in secrets; treat that capability as privileged.

Default retention: hourly 14 days; events/delivery/action/audit 400 days; daily facts forever. Applied/unresolved restore actions are retained. Set daily retention intentionally. To wipe everything, delete the D1 database in your Cloudflare account (and account backups/exports under your control); remove Worker secrets and provider authorisations too. Alternatively delete rows from the documented application tables in dependency order, deliveries before events, leaving schema_migrations intact if keeping the schema. There is no remote collection service to contact for deletion.

Cloudflare platform/account logs, Time Travel retention and alert recipients are controlled by your account and destination policies. Removing rows cannot retract already-delivered notifications. See [SECURITY](../SECURITY.md) for private incident reporting.
