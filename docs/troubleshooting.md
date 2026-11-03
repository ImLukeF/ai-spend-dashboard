# Troubleshooting

- **503 auth_not_configured:** set a 32+ character random token, or both valid Access team origin and audience. Empty/`-` means unset. Config invalidity also fails closed; review zod paths, channels, thresholds and provider flags.
- **401 dashboard:** sign in again after token rotation/12-hour expiry. Access JWT must have correct RS256 signature, issuer, audience and expiry. A header takes precedence over the cookie. Service identities cannot pass an email allowlist.
- **403 admin:** check ADMIN_EMAILS and service/read-token restrictions. Send JSON and `x-asd-csrf:1` from the same origin. HTTPS cookies are Secure; use the documented loopback development URL.
- **Provider 401/403:** use an organisation admin/management key, not a model request key. Anthropic individual accounts are unsupported. OpenAI needs usage permission. OpenRouter workspace-scoped keys cannot read organisation data. Never paste a raw error or credential in a public issue.
- **429:** Retry-After is honoured. Scheduler backoff and resource deferral preserve pending jobs. An admin 429 is a separate five-minute sync or one-minute test-alert throttle.
- **SchemaDriftError:** compare the official endpoint schema, add a sanitised fixture and mapper change, preserving the previous snapshot. Unknown metrics or incomplete pagination must not be silently ignored.
- **CPU-limit errors / delayed sync:** Free CPU suitability is UNVERIFIED. Switch your account to Workers Paid and set `runtime.plan:'paid'`. A queued job is not a successful sync. Backfill and dirty-day derivation can take several ticks under Free limits. Status exposes due times, skipped jobs and resource counts.
- **Missing spend:** check UTC windows, key permissions, provider coverage, partial billed days, backfill cursor, dirty days and errors. No learned/configured price means tokens remain unpriced. Anthropic priority is estimated; code execution is cost-only. Data lag can delay caps.
- **FX gaps:** weekends/holidays use a previous reference day. No currency rates at all produces a USD warning and blocks enforcement; check Frankfurter reachability and source choice. Rates are reference values, not card settlement amounts.
- **OpenRouter name warning:** rename duplicate keys in OpenRouter, then sync. Ambiguous `name:` rows cannot safely identify a hash; do not infer enforcement targets from them.
- **Alert missing:** check channel secret booleans, pending/failed/skipped delivery state, next retry and channel routing. Test alerts dispatch on a tick. Cloudflare email needs a supported EMAIL binding. URLs must use HTTPS and may not redirect.
- **Restore failed:** retain the budget/enforcement definition and live mode, investigate the critical event, and check provider state. Retries stop after 24 hours. Manual changes win; an overridden action is not re-applied.
- **Types changed after local dev:** local `.dev.vars` changes generated binding names. Remove the local vars file and run `npm run cf-typegen` before committing, then `npm run typecheck`. Runtime declarations are the official package to avoid publishing incidental non-placeholder examples from generated docs.
- **npm cache permission:** use `npm ci --cache .cache/npm` if a machine-level npm cache override is unwritable. Do not change ownership of another task's cache.

For a bug report include app version, redacted endpoint/status, configured mode, relevant job/period and a synthetic reproduction. Do not include raw responses, secrets, real account IDs, addresses or private names.
