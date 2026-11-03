# Configuration reference

`spend.config.ts` is the only non-secret configuration source. `defineConfig` preserves the input with TypeScript checking; the Worker validates it with zod and stores a canonical SHA-256 hash. Invalid configuration blocks sync/enforcement and API data. The browser is read-only. Defaults and complete examples are in the root config and `examples/`.

| Field                                               | Default / accepted values                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------- |
| `auth.mode`                                         | `token`, or `access`                                                      |
| `runtime.plan`                                      | `free`, or `paid`; changes job budgets, not your billing plan             |
| `publicUrl`                                         | Empty or HTTPS dashboard URL for alerts                                   |
| `providers.<provider>.enabled`                      | Anthropic/OpenAI true; OpenRouter false; secret also required             |
| `display.currency`, `extraCurrencies`               | USD, []; uppercase three-letter codes                                     |
| `display.tax`                                       | `{enabled:false,ratePercent:10,label:'GST'}`; rate 0–100                  |
| `fx.provider`, `markupPercent`                      | ECB (or RBA at your discretion), 0; markup 0–20                           |
| `sync.backfillDays`, `hourlyRetentionDays`          | 35 (1–180), 14 (1–400)                                                    |
| `pricing.overrides`                                 | []; `{provider,model,metric,usdPerMillion}`; nonnegative, estimation only |
| `tags`                                              | []; `{dimension,rules:[{value,match}]}`; first match per dimension        |
| `channels`                                          | []; channel definitions in [alerts](alerts.md)                            |
| `budgets`                                           | []; budget definitions in [budget docs](budgets-and-enforcement.md)       |
| `enforcement.protectedKeyIds`                       | []; never acted upon                                                      |
| `enforcement.maxActionsPerTick`, `maxActionsPerDay` | 10, 50                                                                    |
| `retention.eventsDays`, `dailyDays`                 | 400, 0; dailyDays 0 keeps daily facts forever                             |

Tags match `provider`, `workspaceIds`, `apiKeyIds`, `workspaceName`, `apiKeyName`. Fields are ANDed; arrays are ORed; names are case-insensitive globs with only `*` special. Untagged combinations display `(untagged)`.

IDs for budgets, channels and dimensions match `^[a-z0-9][a-z0-9-]{0,47}$` and are unique. Secret-name references match `^[A-Z][A-Z0-9_]{1,63}$`. Budget thresholds are sorted unique integers 1–1000. Referenced channels must exist; enforcement providers must be enabled.

## Secrets

Set with `npx wrangler secret put NAME` or the dashboard. Use ignored `.dev.vars` locally. Missing, blank and `-` all mean not configured. Never put secret **values** in `spend.config.ts`.

| Name                                        | Purpose                                                                                                           |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `DASHBOARD_TOKEN`                           | Token login, at least 32 random characters; session HMAC derives from it                                          |
| `READ_API_TOKEN`                            | Optional GET token, at least 32 characters; summary/spend/budgets only                                            |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`          | Access team HTTPS origin and application audience                                                                 |
| `ALLOWED_EMAILS`, `ADMIN_EMAILS`            | Optional comma-separated viewer/admin allowlists                                                                  |
| `ANTHROPIC_ADMIN_KEY`                       | Anthropic organisation admin credential                                                                           |
| `OPENAI_ADMIN_KEY`                          | OpenAI admin credential with usage permission                                                                     |
| `OPENROUTER_MANAGEMENT_KEY`                 | Organisation management key (read-only works without enforcement)                                                 |
| `ENFORCEMENT_MODE`                          | `off`, `dry_run` (blank/default), `live`                                                                          |
| `SLACK_WEBHOOK_URL`                         | Slack incoming webhook URL                                                                                        |
| `NTFY_TOPIC_URL`, `NTFY_TOKEN`              | Secret topic URL and optional bearer token                                                                        |
| `ALERT_WEBHOOK_URL`, `ALERT_WEBHOOK_SECRET` | HTTPS destination and Standard Webhooks signing material                                                          |
| `RESEND_API_KEY`                            | Resend transport credential                                                                                       |
| `ALERT_EMAIL_FROM`, `ALERT_EMAIL_TO`        | Email sender and comma-separated recipients                                                                       |
| `LOCAL_DEV`                                 | `true` only for local testing; additionally requires ntfy channel `allowInsecureLocalhost:true` for loopback HTTP |

Channel secret names are configurable. `/config` returns names and configured booleans; `/status` returns booleans, never values. Email addresses and destination URLs are secret values. The optional `EMAIL` binding is configured separately in Wrangler. `.env.example` mirrors `.dev.vars.example` for tooling discovery; Wrangler local secrets belong in `.dev.vars`.
