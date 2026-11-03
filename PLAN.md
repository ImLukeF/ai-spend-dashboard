# ai-spend-dashboard — v1 coding plan

> Self-hosted, org-level AI spend dashboard with budget caps, built on Cloudflare Workers + D1 + Cron Triggers.
> Repository: `github.com/ImLukeF/ai-spend-dashboard` · Plan written 2026-11-04 · Status: ready to build.
>
> **Who this is for:** the coding agent that builds v1 in **one pull request** from this file alone, without asking questions.
> Where the plan says **UNVERIFIED**, implement the stated fallback and leave a `// UNVERIFIED:` code comment with the doc link.
> Where the plan gives a decision, follow it. Don't reopen it. Anything under **Later** is out of scope for v1.

---

## 0. Ground rules for the build agent (non-negotiable)

1. Work on a feature branch (suggested name: `feat/v1`). Open **one** PR against `main`. **Never** push to `main`, merge, approve or close PRs, or change repository settings, branch protection or visibility. The maintainer reviews and merges.
2. **Never** commit or print secrets, tokens, API keys, real account/org/workspace/project/key IDs, server IPs, personal or business email addresses, street addresses or PO boxes. Use placeholders only: `example.com`, `apikey_EXAMPLE…`, `proj_example…`, `wrkspc_EXAMPLE…`. In tests, use fake values that do **not** match real key prefixes (for example `test-anthropic-admin-key-not-real`).
3. This is a generic public project. Don't name any company, client or private project, and don't add telemetry or "phone home" code.
4. Never invent statistics, user numbers, quotes or testimonials in docs or UI copy.
5. **Do not deploy.** Don't open public ports. Every local dev server binds to `127.0.0.1` only (§16.4).
6. Tests make **no live network calls** and use **no live credentials**. All provider responses come from committed fixtures (§15).
7. Keep commits narrow: one commit per milestone in §19 is ideal. Include `PLAN.md` unchanged in the repo.

---

## 1. Summary and problem

**Summary.** `ai-spend-dashboard` is a small, self-hosted Cloudflare Worker. On a schedule it pulls **organisation-level** usage and cost data from AI providers' admin/billing APIs (Anthropic, OpenAI and OpenRouter in v1) and stores hourly and daily rollups in D1. It charts spend by provider, API key, workspace/project, model and custom tag (for example "which bot or agent"). It evaluates budgets and sends alerts to a webhook, Slack, email or ntfy. Where a provider's admin API allows a **reversible** stop, it can also hard-stop a key or project. Hard-stops are opt-in, dry-run by default and fully logged. The Worker shows amounts in USD or a chosen currency such as AUD, with an optional GST/VAT-inclusive view. It deploys with one click ("Deploy to Cloudflare").

**Problem.**
- **Local-log tools see one machine.** The popular tools read local CLI logs on one machine, for example `ccusage` (19,318 GitHub stars, MIT, checked 2026-11-04). They can't see team or org spend across keys, servers and bots.
- **Gateway tools need traffic routed through them.** Helicone, LiteLLM and Portkey (all gateways) and Langfuse/OpenLIT (tracing via an SDK) require routing or instrumenting traffic. That's a big change for a team that only wants a spend view and a cap.
- **Org dashboards built on provider APIs are tiny.** Few small projects read provider admin APIs, and none combine a serverless one-click deploy, budgets, multi-channel alerts, currency conversion and reversible hard-stops (§22.3). Examples (checked 2026-11-04):
  - `Mfrostbutter/tokenpulse`: 5 stars.
  - `laigit-dot/api-token-usage-alert`: 16 stars.
  - `amedinat/LLMeter`: 7 stars, AGPL-3.0.
  - `htin1/toktop`: 174 stars, a terminal UI.
- **People are asking for this.** Demand signals (checked 2026-11-04 via the HN Algolia API):
  - "Ask HN: How do you cap what your coding agents can spend?" (2026-10-19, 4 points; https://news.ycombinator.com/item?id=50149426). A weak but on-target signal.
  - "Meta caps internal AI token spending" (2026-07-01, 148 points; https://news.ycombinator.com/item?id=48754713).
  - Posts about AI usage dashboards on X are anecdotal. They're not quantified here, and no numbers are claimed.

---

## 2. Goals and non-goals

### 2.1 Goals (v1)
- **G1 Pull, don't proxy.** Read provider admin/usage/cost APIs on a schedule. Never sit in the request path.
- **G2 Durable rollups.** Store hourly token usage, daily usage and daily billed cost in D1. Re-pulls are idempotent and late provider revisions overwrite older values.
- **G3 Useful breakdowns.** Show spend per provider, workspace/project, API key, model and custom tag dimension, over common ranges plus a custom range. Every amount is labelled with its basis: billed, allocated or estimated.
- **G4 Budgets and alerts.** Support daily, weekly and monthly budgets on any scope. Alert at percentage thresholds and on forecast overrun, via a generic signed webhook, Slack, email (Resend or Cloudflare Email Service) or ntfy. Each alert fires once per threshold per period.
- **G5 Opt-in reversible hard-stop.** Act only on explicit targets: deactivate an Anthropic API key, set an OpenAI project hard spend limit, or disable an OpenRouter key. Enforcement is dry-run by default, with a double opt-in, an audit log and optional automatic restore at period end.
- **G6 One-click deploy.** Ship a "Deploy to Cloudflare" button. The Worker applies its own D1 schema, so no migration step is needed. Everything works on Workers Free for small orgs, and Workers Paid is recommended.
- **G7 Currency and tax view.** Use daily FX rates (ECB via Frankfurter) to show a display currency, with an optional card-FX markup and an optional tax-inclusive view (for example GST 10%).
- **G8 Secure by default.** Admin keys live only as Worker secrets. Auth fails closed (Cloudflare Access or a strong token), with strict CSP and no third-party calls beyond providers, FX and the configured alert channels.

### 2.2 Non-goals (v1)
- Proxying or gateway features, per-request tracing, or logging prompts/completions.
- Multi-tenant SaaS, user accounts, or RBAC beyond "viewer vs admin".
- Real-time (sub-minute) enforcement. Polling has a lag measured in minutes (§11.6).
- **Irreversible** actions: deleting keys, archiving workspaces or projects. These are excluded on purpose (§11.4).
- Tax advice or invoice reconciliation. The tax view is a configurable percentage only.
- Subscription plans (Claude Pro/Max/Team seats, ChatGPT plans, Cursor seats) and local CLI logs.
- Editing config, budgets or provider keys from the browser. Config is code (§9).
- More than one org/account per provider (see Later).

---

## 3. Target users

1. **Small and medium engineering teams** that run coding agents, bots and pipelines on Anthropic, OpenAI or OpenRouter org accounts and want a team-wide spend view and caps without a gateway.
2. **Solo developers and indie builders** with several bots, each on its own API key, who want a per-bot daily cap and a phone alert (ntfy).
3. **Platform and FinOps engineers** who want a cheap, auditable, self-hosted view in their own Cloudflare account, in their own currency.

**Assumed skills:** the user can create a provider admin key, click a deploy button and edit one config file in GitHub.

---

## 4. v1 scope

### In scope (must ship)

| Area | v1 deliverable |
|---|---|
| Providers | Anthropic (Admin API legacy usage + cost reports, API keys, workspaces), OpenAI (usage/completions, costs, projects, project API keys, project spend limit), OpenRouter (keys list, analytics query) |
| Storage | D1 schema with a self-applying migrator; hourly usage, daily usage, daily cost, derived daily spend, entities, tags, FX, budgets, events, deliveries, enforcement actions, audit log |
| Scheduling | One cron trigger (`*/15 * * * *`) and a due-job scheduler with per-plan subrequest budgets, locking, backfill and retention |
| Cost model | Billed → allocated (Anthropic per key) → estimated (gaps only), with integer micro-USD money |
| Tags | Config rules that map keys and workspaces/projects to tag dimensions (for example `agent`, `team`) |
| Budgets | Day, week and month periods (UTC); any scope; thresholds; forecast; tax and FX aware |
| Alerts | Webhook (Standard Webhooks signed), Slack, ntfy, email (Resend; Cloudflare Email Service optional); dedupe and retries |
| Enforcement | `anthropic.deactivate_api_key`, `anthropic.deactivate_workspace_keys`, `openai.set_project_spend_limit`, `openrouter.disable_key`; modes off, dry_run (default) and live; restore; audit |
| API | Read-only JSON API under `/api/v1`, session login, two admin POSTs (sync now, test alert), CSV export |
| UI | Preact SPA: Overview, Explore, Budgets, Keys & workspaces, Activity, Settings/Status, Login |
| Auth | `access` mode (Cloudflare Access JWT verified in the Worker) or `token` mode (signed session cookie); read-only API token |
| Deploy | Deploy button, `wrangler.jsonc` without a resource ID, `.dev.vars.example`, docs |
| Quality | Biome lint/format, TypeScript strict, Vitest in workerd with committed fixtures, GitHub Actions CI, secret-pattern scan |
| Docs | README, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, LICENSE (Apache-2.0), NOTICE, CHANGELOG, `docs/*` |

### Later (explicitly not v1)

**More providers.**
- xAI management billing API, Fireworks `usageCosts:query`, Together billing usage (beta).
- GitHub Copilot billing usage, Cursor Admin API (Enterprise only), Mistral admin usage (Enterprise preview).
- Vercel AI Gateway report (paid per query), Google Cloud Billing BigQuery export, AWS Cost Explorer (charged per request), Azure Cost Management.
- Balance-delta tracking for DeepSeek and Moonshot.
- Details in §8.5.

**Other later work.**
- **Anthropic Usage & Cost Analytics API (beta):** use it for reconciliation, `list_amount` and the `product=claude_code` split.
- **Claude Code analytics:** the per-user Claude Code endpoint.
- **More accounts and options:** multiple accounts per provider, local-timezone budget periods, an anomaly detector, Discord/Teams channels.
- **MCP:** a read-only MCP endpoint (tool definitions sketched in §13.5).
- **Ingest API:** an endpoint for local collectors.
- **Native limits:** showing native provider limits (OpenAI spend limits/alerts, Anthropic workspace limits).
- **Browser edits:** editing config in the browser.

---

## 5. Architecture and stack

### 5.1 Overview

```
                ┌──────────────────── Cloudflare account (user-owned) ─────────────────────┐
 Cron */15 ───▶ │ Worker.scheduled ──▶ tick(): lock → due jobs → budget(subrequests,D1)    │
                │   ├─ provider adapters (fetch, zod-validate, normalise)                   │
                │   │     api.anthropic.com · api.openai.com · openrouter.ai               │
                │   ├─ D1 upserts (window-replace) → derive spend_daily (allocate/estimate)│
                │   ├─ tags materialise → FX (api.frankfurter.dev) → budgets evaluate     │
                │   ├─ alerts dispatch (webhook/Slack/ntfy/email) → enforcement (opt-in)  │
                │   └─ retention                                                           │
 Browser ─(Access?)─▶ Worker.fetch ── /api/* (auth) ──▶ D1 read models (cached per data_version)
                │   └─ static SPA (Workers Static Assets, no data inside)                  │
                └──────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Stack decisions (with reasons)

| Choice | Why |
|---|---|
| **TypeScript (strict)** everywhere | One language and shared types for the Worker, config and SPA. Exhaustive checks on provider unions. |
| **Cloudflare Workers + D1 + Cron Triggers + Static Assets** | No servers. Free tier available. Secrets storage is built in. One-click deploy. Cron is native. D1 is SQLite (window functions, `json_each`, `ON CONFLICT`). |
| **Hono** `^4.13` (MIT) | Tiny router built for Workers, with middleware for auth and headers. |
| **zod** `^4.6` (MIT) | Validates config, every provider response (treated as untrusted) and every API input. Cloudflare's limits page recommends Zod ≥ 4.5 for memory use (checked 2026-11-04). |
| **jose** `^6.2` (MIT) | Standard JWT/JWKS verification for Cloudflare Access, as Cloudflare's docs use it. |
| **Preact** `^11.1` + **Vite** `^8.3` + `@preact/preset-vite` `^2.10` | Small SPA bundle. Uses only core hooks (`useState`, `useEffect`, `useMemo`), with no `preact/compat`. |
| **Chart.js** `^4.6` (MIT) | Stacked bars, lines and doughnuts with no plugins, and widely known. Bundle size is acceptable for an internal dashboard. |
| **Vitest** `^4.1.12` + **`@cloudflare/vitest-plugin`** `^1.5.1` | Tests run in workerd with a real local D1. `@cloudflare/vitest-pool-workers` is deprecated and renamed (checked 2026-11-04). The plugin's docs install `vitest@^4.1.0`, and its peer range also allows `^5`. |
| **Biome** `^2.6` | One fast tool for lint and format, which makes CI simpler than ESLint plus Prettier. |
| **Wrangler** `^4.157` | Deploy, local dev, `wrangler types` and `--check`. |
| **npm** (with `package-lock.json`) | Workers Builds and the Deploy button detect it, and it's the simplest choice for contributors. |
| Node **24 LTS** in CI; `engines.node >= 22` | Wrangler requires Node ≥ 22. 24 and 26 are LTS lines (nodejs.org, checked 2026-11-04). |
| TypeScript `^7.0.2` | If any tool's peer range rejects TS 7, pin `~5.9` and note it in the PR. |

**Pinning:** use caret ranges at the versions above and commit `package-lock.json`. Don't add other runtime dependencies without a written reason in the PR description.

### 5.3 Key design principles
1. **Pure core, thin shell.** Provider parsing, allocation, budgets, FX, tag rules, period maths and alert formatting are pure functions. I/O sits behind injected `Deps`: `fetch`, `now`, `randomId`, `log`, `config`.
2. **Heavy aggregation runs in SQL.** On Workers Free, CPU is 10 ms per invocation (§16.3), so CPU-heavy work happens in D1. JS stays O(rows changed this tick).
3. **Window-replace upserts.** For each pulled window, upsert rows (writing only when a value changed) and delete rows in that window that the provider no longer returns. This handles late revisions with no duplicates.
4. **Money is an integer of micro-USD** (`amount_micros`, 1e-6 USD). Never use floats for stored money. Convert to display currency only at read time.
5. **Fail closed.** If auth is misconfigured the API returns 503. An invalid config means no syncs, an error status, and no enforcement.
6. **Every number has provenance.** Each one carries its basis, data freshness, FX source and date.

---

## 6. Repository layout

```
.
├─ PLAN.md                         # this file (keep)
├─ README.md  CONTRIBUTING.md  SECURITY.md  CODE_OF_CONDUCT.md  CHANGELOG.md
├─ LICENSE                         # Apache-2.0 full text
├─ NOTICE                          # short Apache NOTICE + data attributions (ECB/Frankfurter)
├─ package.json  package-lock.json  .nvmrc (24)  .gitignore  .gitattributes  .editorconfig
├─ biome.json  tsconfig.json  tsconfig.base.json
├─ wrangler.jsonc                  # Worker config (no resource IDs; see §9.1)
├─ worker-configuration.d.ts       # generated by `wrangler types` (committed)
├─ .dev.vars.example               # secret names only, empty values (Deploy button reads this)
├─ spend.config.ts                 # THE user config (safe defaults: nothing enabled that acts)
├─ examples/
│  ├─ solo-bots.config.ts          # per-bot daily caps + ntfy
│  └─ team-monthly-aud.config.ts   # AUD + GST view, team tags, Slack + email
├─ public/
│  └─ _headers                     # security headers for static assets
├─ src/
│  ├─ shared/                      # imported by worker AND web (no Worker-only APIs)
│  │  ├─ config-schema.ts          # zod schema + `defineConfig()` + inferred types
│  │  ├─ api-types.ts              # request/response types for /api/v1
│  │  ├─ money.ts                  # micros helpers, decimal-string → micros (no floats)
│  │  └─ periods.ts                # UTC day/week/month period maths
│  ├─ worker/
│  │  ├─ index.ts                  # export default { fetch, scheduled }
│  │  ├─ deps.ts                   # Deps type + defaultDeps(env)
│  │  ├─ env.ts                    # secret-name helpers, isConfigured(secret)
│  │  ├─ config.ts                 # loadConfig(): validate spend.config.ts once per isolate
│  │  ├─ http/
│  │  │  ├─ app.ts                 # createApp(deps): Hono app, route table
│  │  │  ├─ auth.ts                # access-JWT, session cookie, read token, capability checks
│  │  │  ├─ csrf.ts  headers.ts  errors.ts
│  │  │  └─ routes/{summary,spend,usage,budgets,entities,events,status,config,session,admin,export}.ts
│  │  ├─ jobs/
│  │  │  ├─ tick.ts                # orchestrator: lock, schedule due jobs, budgets, deadline
│  │  │  ├─ registry.ts            # job definitions (§10.2)
│  │  │  ├─ budget.ts              # subrequest / D1-query budget accounting
│  │  │  ├─ derive.ts              # spend_daily from cost_daily + usage_daily
│  │  │  ├─ allocate.ts            # pure allocation (largest-remainder)
│  │  │  ├─ estimate.ts            # pure effective-rate estimation
│  │  │  └─ retention.ts
│  │  ├─ providers/
│  │  │  ├─ types.ts               # ProviderAdapter interface, normalised row types
│  │  │  ├─ http.ts                # providerFetch(): allow-listed host, timeout, retry, redaction
│  │  │  ├─ anthropic/{client,schemas,map,enforce}.ts
│  │  │  ├─ openai/{client,schemas,map,enforce}.ts
│  │  │  └─ openrouter/{client,schemas,map,enforce}.ts
│  │  ├─ fx/{frankfurter,convert}.ts
│  │  ├─ tags/{match,materialise}.ts
│  │  ├─ budgets/{evaluate,forecast}.ts
│  │  ├─ alerts/{events,dispatch,format}.ts
│  │  ├─ alerts/channels/{webhook,slack,ntfy,email-resend,email-cloudflare}.ts
│  │  ├─ enforcement/{plan,execute,restore}.ts
│  │  ├─ db/
│  │  │  ├─ migrate.ts             # self-applying migrator
│  │  │  ├─ migrations.ts          # ordered list: { version, name, statements[] }
│  │  │  └─ repo/*.ts              # small typed query modules per table
│  │  └─ lib/{redact,hash,ids,log,time,json}.ts
│  └─ web/
│     ├─ index.html  main.tsx  app.tsx  router.ts  api.ts  styles.css
│     ├─ lib/{format,colors,query}.ts
│     ├─ components/{Chart,DataTable,KpiTile,RangePicker,GroupBySelect,CurrencyToggle,BasisBadge,
│     │              Freshness,EmptyState,ErrorBanner,ProgressBar}.tsx
│     └─ pages/{Overview,Explore,Budgets,BudgetDetail,Keys,Activity,Settings,Login,Setup}.tsx
├─ test/
│  ├─ wrangler.test.jsonc          # test-only config: D1 binding, no assets, no crons
│  ├─ setup.ts                     # migrate DB, block global fetch
│  ├─ helpers/{fake-fetch,seed,clock,jwt,app}.ts
│  ├─ fixtures/
│  │  ├─ anthropic/*.json  openai/*.json  openrouter/*.json  frankfurter/*.json
│  │  └─ README.md                 # how fixtures were derived (documented shapes, fake IDs)
│  ├─ unit/*.test.ts
│  └─ integration/*.test.ts
├─ scripts/check-secrets.mjs       # repo scan for key/IP/email patterns (§17)
├─ docs/
│  ├─ deploy.md  configuration.md  auth.md  providers.md  budgets-and-enforcement.md
│  ├─ alerts.md  currency-and-tax.md  data-model.md  api.md  privacy.md  troubleshooting.md
└─ .github/
   ├─ workflows/ci.yml
   ├─ dependabot.yml
   ├─ ISSUE_TEMPLATE/{bug_report.yml,feature_request.yml,provider_request.yml}
   └─ pull_request_template.md
```

**`.gitignore` must include:**
- `node_modules/`, `dist/`, `.wrangler/`, `coverage/`
- `.dev.vars`, `.dev.vars.*` except `!.dev.vars.example`, and `.env*` except `!.env.example`
- `*.local.*`, `*.sqlite*`, and any `backup/` or `raw/` directories

---

## 7. Data model (D1)

All timestamps are ISO-8601 UTC strings (`YYYY-MM-DDTHH:MM:SSZ`). Days are `YYYY-MM-DD` in **UTC**. Text dimension columns use `''`, never `NULL`, so composite primary keys work. Anthropic's default workspace (`workspace_id: null`) is stored as `''` and labelled "Default workspace".

### 7.1 Migrator (no `wrangler d1 migrations` step)

The Deploy button does **not** run migrations by itself (Cloudflare deploy-buttons docs, checked 2026-11-04). With automatic provisioning, the D1 ID isn't written back to the user's repo. So the Worker applies its own schema:

- **Where migrations live.** `src/worker/db/migrations.ts` exports `MIGRATIONS: { version: number; name: string; statements: string[] }[]`.
- **When it runs.** `ensureSchema(db)` runs at the start of every `scheduled()` and on the first `/api` request per isolate (memoised).
  1. It reads `SELECT max(version) FROM schema_migrations`. If the table is missing, that counts as 0.
  2. For each pending migration it runs `db.batch([...statements, INSERT INTO schema_migrations ...])`. A batch is one transaction (D1 docs), so if two isolates race, the second fails on the primary key and simply re-reads.
- **Statement rules.** No triggers and no `;` inside string literals. Use plain `CREATE TABLE`/`CREATE INDEX` (with `IF NOT EXISTS` on v1 objects).
- **Contributor rule.** Never edit a released migration. Add a new version instead (documented in CONTRIBUTING).
- **No `wrangler d1 migrations`.** Don't use `wrangler d1 migrations` and don't create a top-level `migrations/` folder, so there is exactly one migration mechanism.

### 7.2 Migration 1 (`init`): exact DDL

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID;
-- keys used: data_version (int as text), tick_lock (JSON {owner, until}), config_hash, tags_hash,
--            summary_cache:<hash-of-params> (JSON), last_tick (JSON summary), first_run_at

CREATE TABLE IF NOT EXISTS sync_state (
  job TEXT PRIMARY KEY,                    -- e.g. 'anthropic.usage_hourly' (§10.2)
  provider TEXT NOT NULL,
  last_attempt_at TEXT, last_success_at TEXT, next_due_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,                         -- redacted, <= 300 chars
  last_rows INTEGER,
  cursor TEXT                              -- job-specific JSON (backfill progress, paging)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS entities (
  provider TEXT NOT NULL,                  -- 'anthropic' | 'openai' | 'openrouter'
  kind TEXT NOT NULL,                      -- 'api_key' | 'workspace'  (OpenAI project => 'workspace')
  id TEXT NOT NULL,                        -- provider ID; OpenRouter key => key hash
  name TEXT NOT NULL DEFAULT '',
  workspace_id TEXT NOT NULL DEFAULT '',   -- parent workspace/project for api keys
  status TEXT NOT NULL DEFAULT '',         -- provider status verbatim (active/inactive/archived/expired/disabled/...)
  created_at TEXT, last_used_at TEXT,
  meta TEXT NOT NULL DEFAULT '{}',         -- small JSON, never secrets (e.g. OpenRouter limit fields, usage counters)
  first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
  PRIMARY KEY (provider, kind, id)
) WITHOUT ROWID;

-- Long/narrow usage facts. metric vocabulary in §7.3.
CREATE TABLE IF NOT EXISTS usage_hourly (
  provider TEXT NOT NULL, hour TEXT NOT NULL,             -- 'YYYY-MM-DDTHH:00:00Z'
  workspace_id TEXT NOT NULL DEFAULT '', api_key_id TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '', service_tier TEXT NOT NULL DEFAULT '',
  metric TEXT NOT NULL, quantity INTEGER NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (provider, hour, workspace_id, api_key_id, model, service_tier, metric)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS usage_daily (
  provider TEXT NOT NULL, day TEXT NOT NULL,
  workspace_id TEXT NOT NULL DEFAULT '', api_key_id TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '', service_tier TEXT NOT NULL DEFAULT '',
  metric TEXT NOT NULL, quantity INTEGER NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (provider, day, workspace_id, api_key_id, model, service_tier, metric)
) WITHOUT ROWID;

-- Provider-reported (billed) cost at the finest grain the provider offers.
CREATE TABLE IF NOT EXISTS cost_daily (
  provider TEXT NOT NULL, day TEXT NOT NULL,
  workspace_id TEXT NOT NULL DEFAULT '', api_key_id TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '', service_tier TEXT NOT NULL DEFAULT '',
  metric TEXT NOT NULL DEFAULT 'other',     -- token type / cost type (§7.3)
  line_item TEXT NOT NULL DEFAULT '',       -- provider description / line_item verbatim (<=200 chars)
  amount_micros INTEGER NOT NULL,           -- USD * 1e6
  quantity INTEGER,                         -- provider quantity when given (tokens), else NULL
  updated_at TEXT NOT NULL,
  PRIMARY KEY (provider, day, workspace_id, api_key_id, model, service_tier, metric, line_item)
) WITHOUT ROWID;

-- Derived fact table used by charts and budgets (rebuilt per provider-day by derive.ts).
CREATE TABLE IF NOT EXISTS spend_daily (
  provider TEXT NOT NULL, day TEXT NOT NULL,
  workspace_id TEXT NOT NULL DEFAULT '', api_key_id TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '',
  basis TEXT NOT NULL,                      -- 'billed' | 'allocated' | 'estimated'
  amount_micros INTEGER NOT NULL,
  unpriced_tokens INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (provider, day, workspace_id, api_key_id, model, basis)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS spend_daily_day ON spend_daily (day);

-- Effective rates learned from billed data (USD micros per 1M units) for estimation.
CREATE TABLE IF NOT EXISTS effective_rates (
  provider TEXT NOT NULL, model TEXT NOT NULL, metric TEXT NOT NULL,
  micros_per_million INTEGER NOT NULL, sample_quantity INTEGER NOT NULL,
  window_start TEXT NOT NULL, window_end TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (provider, model, metric)
) WITHOUT ROWID;

-- Tag materialisation: one value per (provider, workspace, key, dimension).
CREATE TABLE IF NOT EXISTS entity_tags (
  provider TEXT NOT NULL, workspace_id TEXT NOT NULL, api_key_id TEXT NOT NULL,
  dimension TEXT NOT NULL, value TEXT NOT NULL,
  PRIMARY KEY (provider, workspace_id, api_key_id, dimension)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS fx_rates (
  day TEXT NOT NULL, quote TEXT NOT NULL,   -- base is always USD
  rate REAL NOT NULL,                       -- 1 USD = rate QUOTE
  source TEXT NOT NULL,                     -- e.g. 'frankfurter:ECB'
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (day, quote)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS budget_periods (
  budget_id TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL,
  definition_hash TEXT NOT NULL,
  spent_usd_micros INTEGER NOT NULL,
  spent REAL NOT NULL, limit_amount REAL NOT NULL, currency TEXT NOT NULL, tax_included INTEGER NOT NULL,
  percent REAL NOT NULL, forecast REAL,
  status TEXT NOT NULL,                     -- 'ok' | 'warning' | 'exceeded'
  basis_mix TEXT NOT NULL DEFAULT '{}',     -- JSON {billed, allocated, estimated} micros
  evaluated_at TEXT NOT NULL,
  PRIMARY KEY (budget_id, period_start)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,                      -- uuid v4
  type TEXT NOT NULL,                       -- §12.1
  severity TEXT NOT NULL,                   -- 'info' | 'warning' | 'critical'
  dedupe_key TEXT NOT NULL UNIQUE,
  budget_id TEXT, period_start TEXT,
  payload TEXT NOT NULL,                    -- JSON, no secrets
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_created ON events (created_at);

CREATE TABLE IF NOT EXISTS deliveries (
  event_id TEXT NOT NULL, channel_id TEXT NOT NULL,
  status TEXT NOT NULL,                     -- 'pending' | 'sent' | 'failed' | 'skipped'
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT, sent_at TEXT, last_error TEXT,
  PRIMARY KEY (event_id, channel_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS enforcement_actions (
  id TEXT PRIMARY KEY,
  budget_id TEXT NOT NULL, period_start TEXT NOT NULL,
  action_type TEXT NOT NULL, provider TEXT NOT NULL, target_id TEXT NOT NULL,
  mode TEXT NOT NULL,                       -- 'dry_run' | 'live'
  status TEXT NOT NULL,                     -- 'planned'|'dry_run'|'applied'|'failed'|'skipped'|'restored'|'restore_failed'|'overridden'
  previous_state TEXT, applied_state TEXT,  -- JSON snapshots (no secrets)
  reason TEXT, error TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (budget_id, period_start, action_type, target_id, mode)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL, actor TEXT NOT NULL,    -- 'cron' | 'access:<email>' | 'token' | 'read-token'
  action TEXT NOT NULL,                     -- 'sync_now' | 'test_alert' | 'enforce' | 'restore' | 'login' | 'login_failed'
  detail TEXT NOT NULL DEFAULT '{}'
);
```

**Upsert pattern.** Bind the whole row set as **one JSON parameter** and run `INSERT … SELECT … FROM json_each(?1) … ON CONFLICT … DO UPDATE SET … WHERE <any value differs>`. Follow it with a `DELETE` of rows in the same window whose key isn't in the JSON. Both statements go in one `db.batch`.
- This avoids D1's 100-bound-parameter limit and counts as one query per batch.
- It writes only changed rows, which keeps writes inside Free's 100k rows/day.
- Keep each JSON parameter under about 90 KB, because statements are limited to 100 KB. Chunk if needed.

### 7.3 Metric vocabulary

| metric | Anthropic usage field / cost `token_type` or `cost_type` | OpenAI usage field / cost `line_item` suffix | OpenRouter |
|---|---|---|---|
| `input_uncached` | `uncached_input_tokens` / `uncached_input_tokens` | `input_uncached_tokens` (else `input_tokens − input_cached_tokens − input_cache_write_tokens`, floored at 0) / suffix containing `input` but not `cached` (UNVERIFIED) | `tokens_prompt` (analytics) |
| `input_cache_read` | `cache_read_input_tokens` / same | `input_cached_tokens` / suffix containing `cached` (UNVERIFIED) | — |
| `input_cache_write_5m` | `cache_creation.ephemeral_5m_input_tokens` / same | — | — |
| `input_cache_write_1h` | `cache_creation.ephemeral_1h_input_tokens` / same | — | — |
| `input_cache_write` | — | `input_cache_write_tokens` | — |
| `output` | `output_tokens` / same | `output_tokens` / suffix containing `output` | `tokens_completion` |
| `requests` | — | `num_model_requests` | `request_count` |
| `web_search_requests` | `server_tool_use.web_search_requests` / `cost_type: web_search` | — | — |
| `code_execution` | cost only: `cost_type: code_execution` | — | — |
| `session_usage` | cost only: `cost_type: session_usage` | — | — |
| `total` | — | — | cost only: `total_usage` (USD) |
| `other` | anything unrecognised (keep `line_item`) | unparsed line items | — |

**Token metrics.** "Tokens" in the UI means the sum of the `input_*` and `output` metrics.

### 7.4 Retention (configurable, `retention` in config)
- `usage_hourly`: 14 days by default. It only feeds the 48-hour and 7-day hourly charts.
- `usage_daily`, `cost_daily`, `spend_daily`, `fx_rates` and `budget_periods`: kept forever by default (`0` = keep). These are small.
- `events`, `deliveries`, `enforcement_actions` and `audit_log`: 400 days by default.

---

## 8. External APIs and data sources

All facts below were checked on **2026-11-04** against official docs (§23 has the full source list).

**Shared HTTP client rules** (`providers/http.ts`):
- **Hosts.** Use a fixed base URL per provider. Refuse any other host and anything that isn't `https`.
- **Timeouts.** 25 s per request, via `AbortController`.
- **User-Agent.** Set `ai-spend-dashboard/<version> (+https://github.com/ImLukeF/ai-spend-dashboard)`, as Anthropic recommends an identifying UA.
- **Retries.** Retry 429 and 5xx up to 3 attempts. Honour `Retry-After` (seconds or HTTP date), otherwise use exponential backoff of 2 s, 4 s, 8 s with jitter, capped at 30 s. Never retry 400, 401, 403 or 404.
- **Response validation.** Parse responses with zod. Allow unknown fields (`.passthrough()` or loose objects). Missing required fields fail with a `SchemaDriftError` that names the endpoint and field.
- **Error redaction.** Errors carry only status, endpoint path and the provider's short `error.message`, passed through `redact()` (§14.4). Never include headers or request URLs with query strings.
- **Subrequest budget.** Every call increments the tick's subrequest counter (§10.3).

### 8.1 Anthropic (Admin API)

**Auth and headers.**
- Header `x-api-key: <ANTHROPIC_ADMIN_KEY>` and `anthropic-version: 2023-06-01`.
- The Admin API guide examples use 2023-06-01. The versioning page lists `2026-10-21` as the latest, and on that version API-key objects move `workspace_id` to `scope.workspace_id`. **Parse both fields.**
- Admin keys have the prefix `sk-ant-admin01-`. Only org members with the admin role can create them, and "the Admin API is unavailable for individual accounts".
- Admin keys have **no scopes** (full access). Docs: https://platform.claude.com/docs/en/manage-claude/admin-api , https://platform.claude.com/docs/en/manage-claude/admin-api-keys .

**Legacy status (risk).** Anthropic now labels `usage_report/messages` and `cost_report` **[Legacy]** ("remains supported"). It recommends the beta Usage & Cost Analytics API (`/v1/organizations/analytics/*`) for new integrations. **Use the legacy endpoints in v1 anyway**, because:
- Legacy data appears within about 5 minutes. The new API refreshes in about 4 h, up to 24 h, which is too slow for caps.
- The new API is beta, needs the `anthropic-beta: analytics-usage-cost-2026-08-24` header, and only covers data from 2026-01-01 onwards.

Keep the adapter interface narrow so an analytics adapter can be added later (§4 Later, §21 Q5).

#### 8.1.1 Usage report: `GET https://api.anthropic.com/v1/organizations/usage_report/messages`

**Params.**
- `starting_at`: RFC 3339, required. Buckets snap to UTC.
- `ending_at`: optional.
- `bucket_width`: `1m`, `1h` or `1d`.
- `limit`: counts buckets. `1h` has default 24 and max 168; `1d` has default 7 and max 31.
- `group_by[]`: values from `api_key_id`, `workspace_id`, `model`, `service_tier`, `context_window`, `inference_geo`, `speed`, `account_id`, `service_account_id`.
- `page`: the token from `next_page`.

**What v1 requests.**
- `group_by[]=api_key_id&group_by[]=workspace_id&group_by[]=model&group_by[]=service_tier`.
- Hourly job: `bucket_width=1h&limit=168`. Daily job: `bucket_width=1d&limit=31`.
- Paginate while `has_more` is true, using `page=<next_page>`. Cap at 10 pages per call, and log a warning if the cap is hit.

**Response (trimmed, from the reference docs):**
```json
{"data":[{"starting_at":"2025-08-01T00:00:00Z","ending_at":"2025-08-02T00:00:00Z",
  "results":[{"uncached_input_tokens":1500,
    "cache_creation":{"ephemeral_1h_input_tokens":0,"ephemeral_5m_input_tokens":0},
    "cache_read_input_tokens":200,"output_tokens":500,
    "server_tool_use":{"web_search_requests":10},
    "api_key_id":"apikey_01…","workspace_id":"wrkspc_01…","model":"claude-…",
    "service_tier":"standard","context_window":"0-200k","inference_geo":"global","speed":"standard"}]}],
 "has_more":true,"next_page":"page_…"}
```

**Parsing rules.**
- Empty buckets (`results: []`) are normal.
- A dimension is `null` unless you group by it. `workspace_id: null` means the default workspace. `api_key_id: null` means Console/Workbench usage, stored as `''` and labelled "No key (Console)".
- Treat every numeric field as optional and default it to 0. `cache_creation` and `server_tool_use` may be `null`.
- Map fields to metrics as in §7.3. Emit one row per non-zero metric.

**Freshness and rate limits.**
- "Usage and cost data typically appears within 5 minutes… The API supports polling once per minute for sustained use." No numeric rate limit is published for these endpoints (UNVERIFIED), so the scheduler polls at most every 15 minutes.
- Priority Tier costs are **not** in the cost report. Track them via `service_tier=priority*` usage (see §10.5).
- Docs: https://platform.claude.com/docs/en/manage-claude/usage-cost-api , https://platform.claude.com/docs/en/api/beta/organization/usage_report/retrieve_messages .

#### 8.1.2 Cost report: `GET https://api.anthropic.com/v1/organizations/cost_report`

**Params.** `starting_at` (required), `ending_at`, `bucket_width=1d` (**only daily**), `group_by[]` from `workspace_id` and `description`, `limit` (default 7, max 31), and `page`. No filters are documented.

**What v1 requests.** `group_by[]=workspace_id&group_by[]=description`.

**Result fields.**
- `amount` is a decimal **string** in the lowest currency unit (cents). Per the docs: "`"123.45"` in `"USD"` represents `$1.23`."
- `currency` is always `"USD"`.
- `cost_type` is one of `tokens`, `web_search`, `code_execution` or `session_usage`.
- `token_type` is one of `uncached_input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation.ephemeral_5m_input_tokens` or `cache_creation.ephemeral_1h_input_tokens`.
- Also returned: `service_tier` (`standard` or `batch`), `description`, `model`, `context_window`, `inference_geo`, `speed` and `workspace_id`. The breakdown fields are `null` unless grouped by `description`.

**Money parsing.**
- `centsDecimalStringToMicros("123.78912")` gives `1_237_891`.
- Implement it with string or BigInt arithmetic, never floats.
- Round half-up beyond the 6th decimal of dollars.
- Reject strings that don't match `^-?\d+(\.\d+)?$`, raising `SchemaDriftError`.

Docs: https://platform.claude.com/docs/en/api/beta/organization/cost_report/retrieve .

#### 8.1.3 Entities

**API keys.** `GET /v1/organizations/api_keys`.
- Params: `limit` (1–1000; use 1000), `after_id`, `status`, `workspace_id`. Response: `data[]`, `has_more`, `last_id`.
- Fields to read: `id`, `name`, `status` (`active`, `inactive`, `archived` or `expired`), `created_at`, and `workspace_id` or `scope.workspace_id`.
- **Do not store** `partial_key_hint`.

**Workspaces.** `GET /v1/organizations/workspaces?include_archived=true&limit=1000` (paginate with `after_id`). Fields: `id`, `name`, `archived_at`.

Docs: https://platform.claude.com/docs/en/api/organization/api_keys/list , https://platform.claude.com/docs/en/api/organization/workspaces .

#### 8.1.4 Enforcement endpoint (reversible)

**Endpoint.** `POST /v1/organizations/api_keys/{api_key_id}` with body `{"status":"inactive"}`. Restore with `{"status":"active"}`.
- `inactive` is reversible ("Re-enable returns it to `active`").
- `archived` is permanent. **Never send `archived`.**
- Expired keys can't be reactivated.
- Keys can't be created via the API.

Docs: https://platform.claude.com/docs/en/api/organization/api_keys/update , https://platform.claude.com/docs/en/manage-claude/authentication .

**Excluded on purpose:**
- `POST /v1/organizations/workspaces/{id}/archive`: irreversible, and it archives every key in the workspace.
- Workspace rate-limit overrides: they take about an hour to apply and cap throughput, not spend.
- The spend-limits API (`/v1/organizations/spend_limits`): early-access preview only.

Docs: https://platform.claude.com/docs/en/manage-claude/workspaces , https://platform.claude.com/docs/en/manage-claude/rate-limits-api , https://platform.claude.com/docs/en/api/beta/organization/spend_limits/list .

**Coverage notes (show in `docs/providers.md`):**
- Console playground usage has `api_key_id: null`.
- Code execution appears in cost only.
- Bedrock, Vertex and Google-managed Claude usage are billed by the cloud provider and aren't covered.
- Whether Claude Code usage billed via Console appears in `usage_report/messages` is UNVERIFIED (likely).

### 8.2 OpenAI (Administration API)

**Auth.**
- Send `Authorization: Bearer <OPENAI_ADMIN_KEY>`. Admin keys look like `sk-admin-…`.
- They're created at platform.openai.com → Settings → Organization → Admin keys by org owners. Admin keys don't work on non-admin endpoints.
- The usage endpoints need the `api.usage.read` permission.
- No numeric rate limit is documented. Endpoints may return `429` with `Retry-After`.
- Data latency is UNVERIFIED.

Docs: https://developers.openai.com/api/docs/guides/admin-apis , spec: https://github.com/openai/openai-openapi (openapi.yaml, spec 2.3.0, checked 2026-11-04).

#### 8.2.1 Usage: `GET https://api.openai.com/v1/organization/usage/completions`

**Params.**
- `start_time`: Unix seconds, required, inclusive.
- `end_time`: exclusive.
- `bucket_width`: `1m`, `1h` or `1d`. `limit` counts buckets: `1h` has default 24 and max 168; `1d` has default 7 and max 31.
- Filters: `project_ids`, `user_ids`, `api_key_ids`, `models`, `batch`.
- `group_by`: values from `project_id`, `user_id`, `api_key_id`, `model`, `batch`, `service_tier`, `api_source`.
- `page`: cursor.

**What v1 requests.** `group_by=project_id&group_by=api_key_id&group_by=model&group_by=service_tier`, repeating the param for each value. Paging stops at `has_more: false`.

**Response (trimmed, official example):**
```json
{"object":"page","data":[{"object":"bucket","start_time":1730419200,"end_time":1730505600,
 "results":[{"object":"organization.usage.completions.result","input_tokens":1000,"input_cached_tokens":400,
  "output_tokens":500,"input_audio_tokens":50,"output_audio_tokens":50,"num_model_requests":5,
  "project_id":null,"api_key_id":null,"model":null,"batch":null,"service_tier":null}]}],
 "has_more":true,"next_page":"page_AAAA…"}
```

**Parsing rules.**
- `input_tokens` **includes** cached and cache-write tokens. Prefer `input_uncached_tokens` when present (§7.3).
- Other endpoints (`embeddings`, `images`, `audio_*`, `vector_stores`, `code_interpreter_sessions`, `file_search_calls`, `web_search_calls`, `moderations`, `decisions`) are **not** pulled in v1. Their **money** still arrives through the Costs API.

#### 8.2.2 Costs: `GET https://api.openai.com/v1/organization/costs`

**Params.**
- `start_time` (required) and `end_time`.
- `bucket_width=1d` only. `limit` is 1–180 daily buckets (default 7).
- Filters: `project_ids`, `api_key_ids`, `line_items`.
- `group_by`: values from `project_id`, `user_id`, `line_item`, `api_key_id`, `api_source`.
- `page`: cursor.

**What v1 requests.** `group_by=project_id&group_by=api_key_id&group_by=line_item`. Per-key billed cost **is** available, so OpenAI needs no allocation step.

**Result:**
```json
{"object":"organization.costs.result","amount":{"value":0.06,"currency":"usd"},
 "line_item":"<model>, input_tokens","project_id":"proj_…","api_key_id":"key_…",
 "quantity":10000,"quantity_unit":"tokens"}
```

**Parsing rules.**
- `amount.value` is a **number in dollars**. The spec only says "numeric value". Dollars is inferred from the official example (`0.06` for 10,000 input tokens) and marked UNVERIFIED.
- Convert with the shared helper `usdToMicros(v: number | string)`: strings go through exact decimal parsing; finite numbers use `Math.round(v * 1e6)`, which is exact at micro-dollar precision for any realistic amount (far below 2^53 / 1e6). Non-finite values raise `SchemaDriftError`.
- `quantity_unit` is one of `tokens`, `1000_tokens`, `duration_seconds`, `duration_minutes`, `duration_hours`, `gibibyte_hours`, `images`, `characters` or null. Multiply `1000_tokens` by 1000. Store `quantity` only for token units.
- Parse `line_item` with the regex `^(?<model>.+?),\s*(?<kind>[\w .-]+)$`, best effort. Map the model and metric per §7.3. Unparsed items get `model=''`, `metric='other'`, and the raw `line_item` is kept.
- The spec warns that some `user_id` plus `project_id` combinations return 400. v1 doesn't group by `user_id`.

#### 8.2.3 Entities

**Projects.** `GET /v1/organization/projects?limit=100&include_archived=true`, paginating with `after`. Fields: `id`, `name`, `status`, `archived_at`.

**Project API keys.** `GET /v1/organization/projects/{project_id}/api_keys?limit=100`, paginating with `after`.
- Fields: `id`, `name`, `created_at`, `last_used_at`, and `owner.type`.
- **Do not store** `redacted_value`.
- On Free, refresh **at most 10 projects per tick**, round-robin, with the cursor in `sync_state.cursor`.

#### 8.2.4 Enforcement endpoint (reversible, provider-enforced)

**Hard spend limit for a project.**
- `GET`/`POST`/`DELETE https://api.openai.com/v1/organization/projects/{project_id}/spend_limit`.
- POST body: `{"threshold_amount": <int cents ≥1>, "currency": "USD", "interval": "month"}`.
- GET response: `{"object":"project.spend_limit","threshold_amount":10000,"currency":"USD","interval":"month","enforcement":{"status":"enforcing"|"inactive"}}`. GET returns **404 when no limit exists**.
- **Behaviour** (spend-limits guide): over-limit requests get 429 with `project_spend_limit_exceeded`. "Enforcement is not instantaneous… recorded spend can slightly exceed the configured amount."
- **Reversible:** raise or delete the limit and traffic resumes after the change propagates.

**Action semantics.**
1. Snapshot the current limit (GET; a 404 means `{"none":true}`).
2. POST `threshold_amount: 1` (one cent). Any project with spend this month is then over the limit.
3. To restore, POST the snapshot, or DELETE if the snapshot was `none`.

Whether a 1-cent threshold takes effect immediately for a project already over it is UNVERIFIED. The docs must tell users to test on a sandbox project first.

Docs: https://developers.openai.com/api/docs/guides/spend-limits , spec paths `/organization/projects/{project_id}/spend_limit`.

**Excluded on purpose:**
- `POST /v1/organization/projects/{id}/archive`: "You can't restore an archived project".
- `DELETE …/api_keys/{id}`: irreversible.
- Rate-limit clamps: they cap throughput, not spend.
- Key `scopes` changes: whether they block model calls is UNVERIFIED.

### 8.3 OpenRouter

**Auth.**
- Send `Authorization: Bearer <OPENROUTER_MANAGEMENT_KEY>`. This is a **management key** (formerly "provisioning key").
- Management keys can't make model requests. A **read-only** management key can read but not write. A workspace-scoped management key gets 403 on org-level endpoints.
- No numeric admin-endpoint rate limits are published (UNVERIFIED).
- Amounts are in USD credits.

Docs: https://openrouter.ai/docs/guides/overview/auth/management-api-keys.md .

**Endpoints used.**

1. **`GET https://openrouter.ai/api/v1/keys`** (params `offset`, `include_disabled=true`). Returns `data[]`.
   - Each key has `hash`, `name`, `label`, `disabled`, `limit`, `limit_remaining`, `limit_reset` (`daily`, `weekly`, `monthly` or null), `include_byok_in_limit`, `usage`, `usage_daily`, `usage_weekly`, `usage_monthly`, `byok_usage*`, `created_at`, `updated_at`, `expires_at`, `last_used_at`, `workspace_id`.
   - Usage windows are UTC days and months, and weeks run Monday to Sunday.
   - Page with `offset` until a page returns fewer items than the previous page or zero. The page size isn't documented (UNVERIFIED). Cap at 20 pages.
   - Store keys as entities. The `id` is the hash; `meta` holds the limit and usage counters.
   - Docs: https://openrouter.ai/docs/api/api-reference/api-keys/list-api-keys.md .
2. **`POST https://openrouter.ai/api/v1/analytics/query`** (management key). Request body:
   ```json
   {"metrics":["total_usage","request_count","tokens_prompt","tokens_completion"],
    "dimensions":["api_key_id","model"],"granularity":"day",
    "time_range":{"start":"2026-10-01T00:00:00Z","end":"2026-11-04T00:00:00Z"},"limit":1000}
   ```
   - Response: `{"data":{"data":[row…],"metadata":{"row_count","truncated","query_time_ms"}}}`.
   - Each row carries the time key **`date__day` or `created_at__day`**; accept either.
   - Count metrics may be **strings**, so parse numbers defensively.
   - At most **2 dimensions** are allowed.
   - `api_key_id` resolves to the key's **display name**, not the hash. Map it to a hash by exact match on `name`, then `label`, from the keys list. If no key or more than one key matches, store `api_key_id = 'name:' + value` and show a warning on the Keys page ("duplicate or unknown key name").
   - If `metadata.truncated` is true, split the time range in half and retry. Allow at most 3 splits per tick, and set a sync warning if still truncated.
   - Spend metrics are USD (number or string); convert with `usdToMicros` (§8.2.2).
   - Metric names should be confirmed with `GET /api/v1/analytics/meta` during development. The cookbook says "Metrics and dimensions evolve".
   - **Validate defensively:** unknown or missing metrics produce a `SchemaDriftError` with a clear message.
   - How far back the endpoint reaches is UNVERIFIED. Backfill up to `backfillDays`, and accept empty results.
   - Docs: https://openrouter.ai/docs/api/api-reference/analytics/query-analytics-data.md , https://openrouter.ai/docs/cookbook/administration/analytics-cost-control.md .
3. **Enforcement: `PATCH https://openrouter.ai/api/v1/keys/{hash}`** with body `{"disabled": true}`; restore with `{"disabled": false}`.
   - The body also accepts `name`, `limit`, `limit_reset`, `include_byok_in_limit` and `workspace_id`. Unknown fields are ignored, and an empty body returns 400.
   - Docs: https://openrouter.ai/docs/api/api-reference/api-keys/update-an-api-key.md .

**Not used in v1** (document as alternatives):
- `GET /api/v1/activity`: last 30 completed UTC days, per date × model × endpoint, filterable but **not groupable** by key.
- `GET /api/v1/credits`: lifetime totals.

**Recommend native limits.** OpenRouter's **native per-key `limit` + `limit_reset`** is enforced by OpenRouter in real time. The README must recommend native limits as the primary cap, with this dashboard as the cross-provider view and backstop.

### 8.4 FX rates: Frankfurter (ECB reference rates)

**Endpoint.** `GET https://api.frankfurter.dev/v2/rates?base=USD&quotes=<CSV>&providers=ECB&from=YYYY-MM-DD&to=YYYY-MM-DD`. Omit `from`/`to` for the latest rates.
- No key and no quotas ("no monthly or daily caps", but abuse is rate-limited). Caching is encouraged and it can be self-hosted.
- The server code is MIT (`lineofflight/frankfurter`).
- `api.frankfurter.app` now 301-redirects to `.dev`. The v1 API is deprecated but "remains available indefinitely". **Use v2.**

**Response** (verified live 2026-11-04):
```json
[{"date":"2026-10-30","base":"USD","quote":"AUD","rate":1.4236},
 {"date":"2026-11-02","base":"USD","quote":"AUD","rate":1.4269}]
```
Weekends and holidays are absent.

**Always pin `providers=ECB`.** v2 otherwise blends many central banks. ECB terms allow free reuse with source attribution, and a modification must be stated. A USD→AUD cross-rate **is** a derived rate.
- Show this in the UI footer and NOTICE: "FX: ECB euro reference rates via Frankfurter; USD cross-rates are derived. For information only."
- Optional config `fx.provider: 'ECB' | 'RBA'`. RBA data starts 2023-01-03. Its AUD/USD source is labelled WM/Reuters, so redistribution terms for that series are UNVERIFIED. Document it as "use at your own discretion".

**Conversion rule.** The rate for day D is the latest stored rate with `day ≤ D`. If none exists, use the earliest rate after D. If no rates exist at all, show USD and a banner.

**Markup.** `fx.markupPercent` (default 0) models card FX fees. Applied as `usd × rate × (1 + markup/100)`.

Docs: https://frankfurter.dev/ , https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html .

**Do not use** `open.er-api.com`: its terms forbid redistribution and require an attribution link.

### 8.5 Other providers: research status (for Later; don't implement in v1)

| Provider | Usable org spend API? | Notes (checked 2026-11-04) |
|---|---|---|
| xAI | **Yes** | `POST https://management-api.x.ai/v1/billing/teams/{team_id}/usage` (day or hour, `usd`, group by description); key `disabled` via `PUT /auth/api-keys/{id}`. Grouping by key is UNVERIFIED. https://docs.x.ai/developers/rest-api-reference/management/billing.md |
| Fireworks | **Yes** | `POST https://api.fireworks.ai/v1/accounts/{id}/usageCosts:query` (hour or day by model or API_KEY). https://docs.fireworks.ai/api-reference/query-usage-costs.md |
| Together | Beta, enabled per org | `GET https://api.together.ai/v1/billing/usage?month=&granularity=` (returns 404 if not enabled). https://docs.together.ai/reference/billing-usage.md |
| GitHub Copilot | **Yes** (org admin) | `GET /organizations/{org}/settings/billing/usage` (+ `/premium_request/usage`), budgets API. https://docs.github.com/en/rest/billing/usage |
| Cursor | Enterprise only | `POST /teams/daily-usage-data`, `/teams/spend`, `/teams/filtered-usage-events`. https://cursor.com/docs/account/teams/admin-api.md |
| Mistral | Enterprise, Preview | `GET https://api.mistral.ai/v1/admin/usage`, spend-limit endpoint. https://docs.mistral.ai/admin/admin-api/usage-metrics.md |
| Vercel AI Gateway | Pro/Enterprise; **$5 per 1,000 report queries** | `GET https://ai-gateway.vercel.sh/v1/report`. Must poll rarely. https://vercel.com/docs/ai-gateway/observability-and-spend/custom-reporting |
| Google Gemini / Vertex | Only via Cloud Billing **BigQuery export** / Budget API (GCP IAM, not the Gemini key) | https://ai.google.dev/gemini-api/docs/billing |
| AWS Bedrock | Cost Explorer `GetCostAndUsage` (**$0.01 per request**, SigV4) | https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_GetCostAndUsage.html |
| Azure OpenAI | Cost Management Query API (Entra ID) | https://learn.microsoft.com/en-us/rest/api/cost-management/query/usage |
| DeepSeek, Moonshot/Kimi | Balance only | Spend could only be inferred from balance deltas. https://api-docs.deepseek.com/api/get-user-balance |
| Groq, Cohere, Cerebras, Perplexity API, Workers AI | **No** usage/billing API found | UNVERIFIED that none exists. Re-check before adding. |

The `ProviderAdapter` interface (§10.1) must make adding any of these a self-contained change: a new folder, fixtures and a registry entry.

### 8.6 Tax facts (for docs only; the product just applies a percentage)

- **Australia.** GST is 10%. A GST-registered business "shouldn't be charged GST" on imported services if it gives the supplier its ABN and a GST-registration statement. Under the reverse charge, "the GST payable is 10% of the amount you paid". (ATO, page updated 11 Sep 2025: https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/in-detail/rules-for-specific-transactions/international-transactions/australian-business-importing-goods-and-services )
- **UK** VAT standard rate is 20% (https://www.gov.uk/vat-rates). **NZ** GST is 15% (https://www.ird.govt.nz/gst). **EU** standard rates vary, with a minimum of 15% (https://taxation-customs.ec.europa.eu/taxation/vat/vat-directive/vat-rates_en).
- Whether provider API amounts are pre-tax is **UNVERIFIED** (likely). Whether Anthropic or OpenAI charge AU GST on API invoices is **UNVERIFIED**. Anthropic says "Your billing address determines how taxes are calculated."
- **UI copy:** "Tax-inclusive view adds X% for budgeting. It isn't tax advice and may not match your invoice."

---

## 9. Configuration and secrets

**Two places, strictly separated:**
1. **`spend.config.ts`** (committed in the user's repo copy) holds non-secret behaviour: providers on/off, display currency, tax, tags, budgets, channels (by **secret name**), enforcement targets, auth mode and runtime plan.
   - It's validated by zod at build time (typecheck) and runtime.
   - The Deploy button clones the repo into the user's GitHub/GitLab account and builds with Workers Builds. Editing this file there redeploys.
2. **Worker secrets** hold everything sensitive: provider admin keys, auth tokens, Access identifiers, webhook URLs, channel tokens, email addresses and the enforcement master switch.
   - Set them with `npx wrangler secret put NAME` or Dashboard → Worker → Settings → Variables and Secrets.
   - For local dev they go in `.dev.vars` (gitignored).

**Why config-as-code.** A stolen dashboard session can't change budgets, repoint webhooks or enable hard-stops. Every change is a reviewed git commit. The Worker's write surface stays tiny (§13.3).

### 9.1 `wrangler.jsonc` (complete)

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "ai-spend-dashboard",
  "main": "src/worker/index.ts",
  "compatibility_date": "2026-11-01",
  // nodejs_compat is on by default for compatibility_date >= 2026-08-04; we don't need Node APIs anyway.
  "workers_dev": true,
  "preview_urls": false,
  "assets": {
    "directory": "./dist/web",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "d1_databases": [
    // No database_id on purpose: Wrangler / the Deploy button provision it automatically.
    { "binding": "DB", "database_name": "ai-spend-dashboard" }
  ],
  "triggers": { "crons": ["*/15 * * * *"] },
  "observability": { "enabled": true, "head_sampling_rate": 1 },
  "dev": { "ip": "127.0.0.1", "port": 8787 }
  // Optional (paid, beta): Cloudflare Email Service binding for the "cloudflare" email transport.
  // "send_email": [{ "name": "EMAIL" }]
}
```

**Notes on this config.**
- **Missing D1 ID.** "Add bindings… *without* adding resource IDs… resources will be created", and IDs are written back on a CLI deploy but **not** on dashboard/GitHub deploys (Wrangler config docs, "Automatic provisioning", checked 2026-11-04).
- **Exact flag names.** If the installed Wrangler rejects any key (for example `preview_urls`), remove it and note that in the PR. Don't guess alternatives.
- **Don't use `secrets.required`.** It makes `wrangler deploy` fail when a listed secret is missing, and every secret here is optional.
- **Tests use their own config.** `test/wrangler.test.jsonc` has the same `name` + `-test`, the same `compatibility_date`, the D1 binding `DB`, **no `assets`** and **no `triggers`**.

### 9.2 `.dev.vars.example` (the Deploy button prompts for these; keep it short)

```dotenv
# Token-mode login secret (>= 32 chars). Generate: openssl rand -base64 48
DASHBOARD_TOKEN=
# Provider admin keys. Leave blank for providers you don't use.
ANTHROPIC_ADMIN_KEY=
OPENAI_ADMIN_KEY=
OPENROUTER_MANAGEMENT_KEY=
# Enforcement master switch: off | dry_run | live   (blank = dry_run)
ENFORCEMENT_MODE=dry_run
```

Add a `package.json` → `"cloudflare": { "bindings": { NAME: { "description": "…" } } }` entry for each of these five, in Markdown, with links to where to create each key. This format is documented in the Cloudflare deploy-buttons docs.
- Whether the deploy UI accepts blank values is UNVERIFIED. The descriptions must say "enter `-` if unused".
- The Worker treats `''`, `'-'` and a missing value as **not configured**.

### 9.3 All secrets (documented in `docs/configuration.md`)

| Secret | Needed when | Notes |
|---|---|---|
| `DASHBOARD_TOKEN` | `auth.mode = 'token'` | ≥ 32 chars, else auth is "misconfigured" (503). The session HMAC key is derived from it (§14.2). |
| `READ_API_TOKEN` | optional | Bearer token for **GET-only** API access by scripts/agents. ≥ 32 chars. |
| `ACCESS_TEAM_DOMAIN` | `auth.mode = 'access'` | `https://<team>.cloudflareaccess.com` |
| `ACCESS_AUD` | `auth.mode = 'access'` | Access application AUD tag |
| `ALLOWED_EMAILS` | optional | Comma list. If set, the JWT `email` must be in it. |
| `ADMIN_EMAILS` | optional | Comma list allowed to use admin POSTs in Access mode. If unset, any allowed user. |
| `ANTHROPIC_ADMIN_KEY` | Anthropic enabled | `sk-ant-admin01-…` |
| `OPENAI_ADMIN_KEY` | OpenAI enabled | `sk-admin-…` |
| `OPENROUTER_MANAGEMENT_KEY` | OpenRouter enabled | A read-only management key works if enforcement isn't used. |
| `ENFORCEMENT_MODE` | optional | `off` / `dry_run` (default) / `live` |
| Channel secrets | per channel | Names are chosen in config. Defaults: `SLACK_WEBHOOK_URL`, `NTFY_TOPIC_URL`, `NTFY_TOKEN`, `ALERT_WEBHOOK_URL`, `ALERT_WEBHOOK_SECRET` (`whsec_…`), `RESEND_API_KEY`, `ALERT_EMAIL_FROM`, `ALERT_EMAIL_TO` |

### 9.4 `spend.config.ts` schema (zod; `src/shared/config-schema.ts`)

```ts
export default defineConfig({
  auth: { mode: 'token' },                       // 'token' | 'access'
  runtime: { plan: 'free' },                     // 'free' | 'paid' → job budgets (§10.3)
  publicUrl: '',                                 // optional, for links in alerts, e.g. 'https://spend.example.com'
  providers: {
    anthropic: { enabled: true },                // also requires the secret to be set
    openai: { enabled: true },
    openrouter: { enabled: false },
  },
  display: {
    currency: 'USD',                             // ISO 4217; 'AUD' etc. needs FX
    extraCurrencies: [],                         // shown in the currency switcher
    tax: { enabled: false, ratePercent: 10, label: 'GST' },
  },
  fx: { provider: 'ECB', markupPercent: 0 },
  sync: { backfillDays: 35, hourlyRetentionDays: 14 },  // backfillDays 1..180
  pricing: {
    // Optional USD-per-1M-unit overrides used ONLY for estimation (§10.5). Never required.
    overrides: [ /* { provider: 'anthropic', model: 'claude-example', metric: 'output', usdPerMillion: 0 } */ ],
  },
  tags: [
    // { dimension: 'agent', rules: [ { value: 'support-bot', match: { provider: 'anthropic', apiKeyName: 'support-*' } } ] }
  ],
  channels: [
    // { id: 'ops-slack', type: 'slack', webhookUrlSecret: 'SLACK_WEBHOOK_URL' }
  ],
  budgets: [
    // see §11.1
  ],
  enforcement: {
    protectedKeyIds: [],                         // never touched, even if listed in a budget
    maxActionsPerTick: 10,
    maxActionsPerDay: 50,
  },
  retention: { eventsDays: 400 },
});
```

**Validation rules (zod with refinements, and clear error messages):**
- IDs (`budget.id`, `channel.id`, `tag dimension`) match `^[a-z0-9][a-z0-9-]{0,47}$` and are unique.
- Currencies are 3 uppercase letters. `tax.ratePercent` is 0–100. `markupPercent` is 0–20. Thresholds are integers 1–1000, sorted and unique.
- Every channel ID referenced by a budget exists. Every enforcement action's provider is enabled.
- Secret names match `^[A-Z][A-Z0-9_]{1,63}$`.
- `defineConfig` is the identity function, typed with `z.input<typeof ConfigSchema>`.
- `loadConfig()` returns `{ ok: true, config, hash }` or `{ ok: false, errors: string[] }`. The hash is a stable SHA-256 of the canonical JSON and is stored in `meta.config_hash`.

**Shipped default.**
- The shipped `spend.config.ts` enables Anthropic and OpenAI (inert unless their secrets are set), has no budgets, no channels and no enforcement, and displays USD.
- `examples/` holds fuller configs. Each is validated by a unit test.
- In examples use only placeholder IDs (`apikey_EXAMPLE01`), and `example.com` in comments.

---

## 10. Sync engine

### 10.1 Provider adapter interface (`providers/types.ts`)

```ts
export type ProviderId = 'anthropic' | 'openai' | 'openrouter';
export interface UsageRow { provider: ProviderId; bucket: string /* hour ISO or day */; workspaceId: string; apiKeyId: string; model: string; serviceTier: string; metric: Metric; quantity: number; }
export interface CostRow  { provider: ProviderId; day: string; workspaceId: string; apiKeyId: string; model: string; serviceTier: string; metric: Metric; lineItem: string; amountMicros: number; quantity: number | null; }
export interface EntityRow { provider: ProviderId; kind: 'api_key' | 'workspace'; id: string; name: string; workspaceId: string; status: string; createdAt?: string; lastUsedAt?: string; meta?: Record<string, unknown>; }
export interface PullWindow { start: string; end: string | null } // ISO; end null = open
export interface ProviderAdapter {
  id: ProviderId;
  secretName: string;
  pullUsageHourly?(ctx: JobCtx, w: PullWindow): Promise<UsageRow[]>;
  pullUsageDaily?(ctx: JobCtx, w: PullWindow): Promise<UsageRow[]>;
  pullCostDaily(ctx: JobCtx, w: PullWindow): Promise<CostRow[]>;
  pullEntities(ctx: JobCtx, cursor: string | null): Promise<{ rows: EntityRow[]; cursor: string | null; complete: boolean }>;
  enforcement: Record<string, EnforcementHandler>; // keyed by action type (§11.4)
}
```

`JobCtx` holds `deps`, the budget counter, `secret` and a logger. Adapters never touch D1. Repositories do.

### 10.2 Jobs (registry, single cron `*/15 * * * *`)

| Job id | Interval | Window per run | Writes |
|---|---|---|---|
| `<p>.usage_hourly` (anthropic, openai) | 15 min | `[startOfUTCHour(now − 47h), open)` | `usage_hourly` (window-replace) |
| `<p>.usage_daily` (anthropic, openai) | 60 min | `[UTC day − 2, open)` | `usage_daily` (window-replace) |
| `<p>.cost_daily` (all three) | 60 min | `[UTC day − 2, open)`; also on UTC days 1–8 of a month, re-pull from the 1st of the previous month (late revisions) | `cost_daily` (window-replace) |
| `openrouter.cost_daily` | 60 min | The analytics query yields cost (`total`) **and** usage metrics. Write both `cost_daily` and `usage_daily` | both |
| `<p>.entities` | 24 h (and on first run) | Full list. OpenAI project keys use a round-robin cursor | `entities` (upsert; `last_seen_at`) |
| `<p>.backfill` | until complete | Chunks of up to 31 days (Anthropic/OpenAI usage_daily + cost), 30 days (OpenRouter), back to `backfillDays` | `usage_daily`, `cost_daily` |
| `derive` | whenever any usage/cost job changed rows for a day | Changed provider-days only | `spend_daily`, `effective_rates` |
| `tags` | when entities change or `tags` config hash changes | All seen (provider, workspace, key) combos | `entity_tags` |
| `fx` | 6 h | Quotes = union of `display.currency`, `display.extraCurrencies` and every non-USD budget currency. Missing days in `[min(day with spend), today]`, max 180 days per call | `fx_rates` |
| `budgets` | every tick | All budgets, current + just-ended periods | `budget_periods`, `events` |
| `alerts` | every tick | Pending deliveries (max 20 per tick) | `deliveries` |
| `enforcement` | every tick | Pending actions and restores | `enforcement_actions`, `events`, `audit_log` |
| `retention` | 24 h | — | deletes |

**Job conditions.**
- A provider job runs only if `providers.<p>.enabled` is set **and** its secret is configured.
- Job state lives in `sync_state`. A failure increments `consecutive_failures`, stores the redacted error and sets `next_due_at = now + min(interval × 2^failures, 6 h)`.

### 10.3 Tick orchestration and Free-plan limits

**Plan limits** (Cloudflare limits page, last updated 2026-10-29, checked 2026-11-04):
- **Free:** 10 ms CPU per invocation, cron included. 50 external subrequests per invocation, and D1 lists "Queries per Worker invocation: 50 (Free)", with a `batch()` counting as one. 5 cron triggers per account.
- **Paid:** cron gets 30 s CPU for intervals under 1 h, or 15 min CPU for intervals of 1 h or more. 10,000 subrequests by default.

`tick()` works like this:
1. `ensureSchema`, then load the config. If the config is invalid, record `meta.last_tick = {error}` and stop.
2. **Lock.** One statement: `INSERT INTO meta (k, v) VALUES ('tick_lock', ?1) ON CONFLICT (k) DO UPDATE SET v = excluded.v WHERE json_extract(meta.v, '$.until') < ?2` (where `?1` = `{owner, until: now+10min}`, `?2` = now ISO). The lock is acquired only if `meta.changes === 1`; otherwise return. Release by setting `until` to now in the `finally` block.
3. **Budget** from `runtime.plan`:
   - Free: `{ subrequests: 40, d1Queries: 40 }`.
   - Paid: `{ subrequests: 500, d1Queries: 500 }`.
   - Wall-clock deadline: 60 s on both. Stop starting jobs after 45 s.
4. **Order:** due provider jobs (most overdue first; backfill last) → derive → tags → fx → budgets → enforcement → alerts → retention.
   - Before each job, estimate its cost: a fixed estimate per job plus pages. Skip jobs that don't fit, leaving them due for the next tick.
5. **Finish.** Bump `meta.data_version` if any rows changed, write `meta.last_tick` (counts, duration, skipped jobs) and release the lock.

**CPU on Free.** Whether a typical org's tick fits in 10 ms CPU on Free is **UNVERIFIED**.
- Keep JS work O(rows changed). Use SQL for aggregation.
- Log `{job, rows, ms}` for each job.
- The README must say: "Free works for small orgs. If ticks fail with CPU-limit errors, set `runtime.plan: 'paid'` on Workers Paid."

### 10.4 Derive: billed → allocated (Anthropic per key)

**Anthropic.** For each changed `(provider='anthropic', day)`:
1. Load `cost_daily` rows for the day. Each row is keyed `(workspace_id, model, metric, tier)`, where tier is the cost `service_tier` (`standard` or `batch`).
2. Load `usage_daily` rows for the day and map the usage tier to `tierClass`:
   - `batch` → `batch`.
   - `priority` or `priority_on_demand` → **excluded** (not in the cost report; estimated in step 5).
   - Anything else → `standard`. That includes `standard`, `flex`, `flex_discount` and `''`. Mapping flex into the cost report this way is UNVERIFIED.
3. For each cost row `C` with amount `A`, find the usage rows `U` with the same `(workspace_id, model, metric, tierClass)`. For `web_search` cost, match on the `web_search_requests` metric.
   - If `Σ quantity(U) > 0`, split `A` across the `api_key_id`s in proportion to quantity, using **largest-remainder** rounding so the parts sum exactly to `A`.
   - Otherwise assign `A` to `api_key_id=''`.
   - Rows with a non-empty key get `basis='allocated'`. Rows with an empty key get `basis='billed'`.
   - The approximation is that context-window, speed and geo price differences inside one model aren't separated between keys. Totals stay exact. Document this.
4. Cost rows with `metric in (code_execution, session_usage, other)` go to `api_key_id=''`, `basis='billed'`.
5. **Priority-tier usage** gets `basis='estimated'` via §10.5, with a warning in the UI ("priority tier isn't in Anthropic's cost report").

**OpenAI.** `spend_daily` = `cost_daily` grouped by `(workspace_id=project_id, api_key_id, model)`, with `basis='billed'`.

**OpenRouter.** `spend_daily` = `cost_daily` (`metric='total'`) grouped by `(workspace_id, api_key_id, model)`, with `basis='billed'`.

**Write pattern.** Each provider-day is written with window-replace in one batch. `allocate.ts` is pure and has exhaustive unit tests (§15).

### 10.5 Estimation (gaps only)

**When estimation applies.** For a `(provider, day)` with usage rows but **zero** `cost_daily` rows. This also covers Anthropic priority-tier usage. Billed data always wins when present.
- Today's billed data may be partial, which means under-reporting until complete. Document this.

**Rate lookup**, per `(provider, model, metric)`:
1. A `pricing.overrides` entry in config.
2. Otherwise `effective_rates`, learned in `derive` over the trailing 14 days:
   - OpenAI: `Σ amount / Σ quantity` from cost rows with token quantities.
   - Anthropic: `Σ allocated amount / Σ matched quantity`.
   - Stored as micros per 1M units.
3. Otherwise the tokens are counted in `unpriced_tokens` and the UI shows "N tokens unpriced".

**No built-in price table.** This avoids shipping stale prices.

### 10.6 Tags

**Matching.** `tags[].rules[].match` fields are ANDed together:
- `provider`, `workspaceIds[]`, `apiKeyIds[]`.
- `workspaceName` and `apiKeyName`: case-insensitive glob with `*` only.

The first matching rule per dimension wins. A combination with no matching rule gets no row, and the UI shows it as `(untagged)`.

**Materialising.** `materialise` computes one row per distinct `(provider, workspace_id, api_key_id)` seen in `spend_daily` ∪ `entities`, per dimension. It writes them to `entity_tags` and stores `meta.tags_hash`.

**Querying.** Group by tag with `LEFT JOIN entity_tags t ON (provider, workspace_id, api_key_id) AND t.dimension = ?`, then `COALESCE(t.value,'(untagged)')`.

---

## 11. Budgets and enforcement

### 11.1 Budget definition (config)

```ts
{
  id: 'org-monthly', name: 'Whole org — monthly',
  period: 'month',                 // 'day' | 'week' (ISO, Monday 00:00 UTC) | 'month' — all UTC in v1
  amount: 500, currency: 'AUD', includeTax: false,
  scope: {                         // all fields optional; AND across fields, OR within arrays; {} = everything
    providers: ['anthropic', 'openai'],
    workspaceIds: [], apiKeyIds: [], models: ['claude-*'],
    tags: { agent: ['support-bot'] },
  },
  thresholds: [50, 80, 100],       // % of amount
  forecast: true,                  // alert when projected to exceed (week/month only)
  channels: ['ops-slack'],
  enforce: null,                   // or §11.3
}
```

### 11.2 Evaluation (`budgets/evaluate.ts`, pure + one SQL query per budget)

**Spend.**
- Spend in USD micros: `SUM(amount_micros)` from `spend_daily` (all bases) in `[period_start, period_end)`, filtered by scope. Tag filters use a join on `entity_tags`.
- Convert per day: `Σ_day usd_day × rate(day) × (1 + markup)`, then `× (1 + tax%)` if `includeTax`.

**Percent and status.** `percent = spent / amount × 100`. Status:
- `exceeded` if percent ≥ 100.
- `warning` if percent ≥ the lowest threshold.
- `ok` otherwise.

**Forecast** (week and month only):
- `spent / elapsed_hours × period_hours`.
- Only alert if `elapsed ≥ 25%` of the period and `forecast ≥ amount`.

**Events.**
- **Threshold crossed:** for each threshold `t ≤ percent`, emit an event with dedupe key `budget:<id>:<period_start>:t<t>:<definition_hash8>`. A config change gives a new hash, which is intended.
- **Forecast:** dedupe key `budget:<id>:<period_start>:forecast:<hash8>`.

**Edge cases.**
- **FX guard.** If any day in the period lacks a usable FX rate for a non-USD budget, evaluate in USD at the latest rate, set `warnings`, and **do not enforce**.
- **Just-ended periods.** These are evaluated one last time (final status) on the first tick after rollover.

### 11.3 Enforcement definition (config)

```ts
enforce: {
  atPercent: 100,                  // trigger (>= 1)
  restoreAtPeriodEnd: true,        // undo our own reversible actions when the next period starts
  actions: [
    { type: 'anthropic.deactivate_api_key', apiKeyId: 'apikey_EXAMPLE01' },
    { type: 'anthropic.deactivate_workspace_keys', workspaceId: 'wrkspc_EXAMPLE01', maxKeys: 20 },
    { type: 'openai.set_project_spend_limit', projectId: 'proj_example01' },
    { type: 'openrouter.disable_key', keyHash: 'example0hash' },
  ],
}
```

### 11.4 Enforcement rules (safety rails, all mandatory)

1. **Double opt-in.** An action runs live only if the config has an `enforce` block **and** the secret `ENFORCEMENT_MODE=live`.
   - With `dry_run`, or when unset, actions are recorded as `dry_run` and sent as a "DRY RUN — would deactivate …" alert.
   - With `off`, nothing is recorded.
2. **Explicit targets only.** The worker never infers targets from scope.
   - The target must exist in `entities` for that provider, with `last_seen` within 48 h.
   - It must not be in `protectedKeyIds`.
   - For workspace actions, the keys are listed fresh from the provider (`GET /v1/organizations/api_keys?workspace_id=…&status=active`), capped at `maxKeys`.
3. **Reversible actions only** (see §8.1.4, §8.2.4 and §8.3):

   | type | apply | snapshot → restore |
   |---|---|---|
   | `anthropic.deactivate_api_key` | `POST /v1/organizations/api_keys/{id}` `{"status":"inactive"}` | prev status (`active`) → `{"status":"active"}` |
   | `anthropic.deactivate_workspace_keys` | the above, for each active key in the workspace | per key |
   | `openai.set_project_spend_limit` | `GET` (404 means none), then `POST …/spend_limit` `{"threshold_amount":1,"currency":"USD","interval":"month"}` | POST previous limit, or `DELETE` if there was none |
   | `openrouter.disable_key` | `PATCH /api/v1/keys/{hash}` `{"disabled":true}` | `{"disabled":false}` |

4. **Idempotent.** The unique key `(budget_id, period_start, action_type, target_id, mode)` means no action repeats within a period.
5. **Rate caps.** `maxActionsPerTick` (default 10) and `maxActionsPerDay` (default 50). Anything past a cap is `skipped`, with a critical event.
6. **Freshness guard.** Skip live actions if the provider's last successful cost/usage sync is older than 2 h. Record it as `skipped` with reason `stale_data`.
7. **Human override wins.**
   - If the entity refresh shows a key we disabled (Anthropic, OpenRouter) is active again during the same period, mark the action `overridden`. Don't re-apply it this period. For `openai.set_project_spend_limit`, override is detected only at restore time (the spend limit isn't polled).
   - On restore, act only if the current provider state still equals `applied_state`. Otherwise mark it `overridden`.
8. **Visible.** Every transition creates an `events` row (`enforcement.dry_run`, `enforcement.applied`, `enforcement.failed`, `enforcement.restored`, `enforcement.skipped`) and an `audit_log` row (actor `cron`). Events go to the budget's channels.
9. **Never sent:** `archived` status, deletes, archives, admin-key operations, org-level spend limits.

### 11.5 Restore at period end

On the first tick after a period ends, for every `applied` action of that budget and the previous period with `restoreAtPeriodEnd: true`: fetch the current state, compare it, then restore or mark `overridden`. Failures become `restore_failed` with a critical event, retried on each tick for 24 h.

### 11.6 Documented limits of enforcement (README and docs must say this)

**Lag.**
- Polling is every 15 min, plus provider data lag: Anthropic is about 5 min; OpenAI and OpenRouter are UNVERIFIED.
- OpenAI's own spend-limit enforcement "is not instantaneous".
- A runaway agent can therefore overspend before a stop lands.

**Prefer provider-native caps where they exist**, and use this tool as the cross-provider view and backstop:
- OpenRouter per-key `limit`/`limit_reset`.
- OpenAI project/org hard spend limits and spend alerts.
- Anthropic workspace spend limits in the Console.

---

## 12. Alerts

### 12.1 Event types

| Type | When |
|---|---|
| `budget.threshold` | A budget crosses a threshold |
| `budget.forecast` | Forecast exceeds the budget |
| `budget.period_closed` | Info only; not sent unless the budget sets `notifyOnClose` (default false) |
| `enforcement.dry_run`, `.applied`, `.failed`, `.skipped`, `.restored`, `.restore_failed`, `.overridden` | Enforcement transitions (§11.4) |
| `sync.failing` | A provider job has had ≥ 3 consecutive failures or no success for 6 h. Dedupe per provider per UTC day. |
| `sync.recovered` | A provider recovers after `sync.failing` |
| `test` | Sent from the admin test-alert endpoint |

**Routing.** Budget events go to the budget's `channels`. Sync events go to channels with `receives: ['sync']`. Default channel `receives`: `['budget','enforcement']`.

### 12.2 Channel types (config)

```ts
{ id: 'hook',  type: 'webhook', urlSecret: 'ALERT_WEBHOOK_URL', signingSecretSecret: 'ALERT_WEBHOOK_SECRET' }
{ id: 'slack', type: 'slack',   webhookUrlSecret: 'SLACK_WEBHOOK_URL' }
{ id: 'ntfy',  type: 'ntfy',    topicUrlSecret: 'NTFY_TOPIC_URL', tokenSecret: 'NTFY_TOKEN' /* optional */ }
{ id: 'mail',  type: 'email',   transport: 'resend', apiKeySecret: 'RESEND_API_KEY', fromSecret: 'ALERT_EMAIL_FROM', toSecret: 'ALERT_EMAIL_TO' }
{ id: 'mail2', type: 'email',   transport: 'cloudflare', fromSecret: 'ALERT_EMAIL_FROM', toSecret: 'ALERT_EMAIL_TO' } // needs send_email binding "EMAIL"
```

**Webhook** (Standard Webhooks spec: https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md).
- `POST` JSON with headers `webhook-id` (= event id), `webhook-timestamp` (Unix seconds) and `webhook-signature: v1,<base64(HMAC-SHA256(secretBytes, "<id>.<ts>.<body>"))>`.
- The secret is `whsec_<base64>`; decode the part after the prefix.
- Body:
  ```json
  {"type":"budget.threshold","id":"<uuid>","timestamp":"<ISO>","data":{"budget":{"id","name","period","periodStart","periodEnd"},
   "spent":0,"limit":0,"currency":"AUD","taxIncluded":false,"percent":0,"threshold":80,"forecast":null,
   "basis":{"billed":0,"allocated":0,"estimated":0},"dataAsOf":"<ISO>","dashboardUrl":"<publicUrl or null>"}}
  ```
- Unit-test the signing against the spec's example vector, or a vector computed in the test with WebCrypto if the spec example isn't usable.

**Slack.**
- `POST <webhook URL>` with `{"text": "<plain summary>"}`. Slack returns `200 ok`.
- The URL format is `https://hooks.slack.com/services/T…/B…/…`. Slack says it "contains a secret".
- Docs: https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks .

**ntfy.**
- `POST <NTFY_TOPIC_URL>` with a plain text body (≤ 4,096 bytes) and these headers:
  - `Title` (≤ 100 chars).
  - `Priority`: 3 for threshold < 100; 4 for ≥ 100 and forecast; 5 for enforcement applied or failed.
  - `Tags`: `money_with_wings`, or `rotating_light` for enforcement.
  - `Click`: `publicUrl` when set.
  - `Authorization: Bearer <token>` when a token secret is set.
- The URL may be ntfy.sh or self-hosted. On ntfy.sh, topic names act like passwords, so keep the URL a secret. ntfy.sh's limit is 250 messages/day.
- Docs: https://docs.ntfy.sh/publish/ .

**Email via Resend.**
- `POST https://api.resend.com/emails` with `Authorization: Bearer <key>` and `Idempotency-Key: <event id>-<channel id>`.
- Body: `{from, to: [...], subject, text, html}`.
- Docs: https://resend.com/docs/api-reference/emails/send-email .

**Email via Cloudflare.**
- `await env.EMAIL.send({ to, from, subject, text, html })`.
- Email Service sending is **Beta and needs Workers Paid**. Sending only to **verified destination addresses** is free on all plans (Cloudflare Email Service docs, checked 2026-11-04).
- If the binding is absent, the delivery is `failed` with "send_email binding EMAIL not configured".
- Exact binding method signature: follow the installed `worker-configuration.d.ts` types. If they differ, adapt and note it in the PR.

**Formatting** (`alerts/format.ts`, pure, golden-tested). One summary builder feeds all channels. Example shape:

`[AI spend] "Whole org — monthly" reached 82% — A$410.12 of A$500.00 (excl. GST) · Nov 2026 (UTC) · forecast A$590.00 · data as of 03:15 UTC`

These are example values in a format string, not real data.

**Rules for every message.**
- Never include secrets, key hashes or full IDs. Show key **names**, with IDs truncated to 4 characters plus "…".

### 12.3 Delivery
- When an event is created, insert one `deliveries` row (`pending`) per routed channel. That happens in the same batch as the event insert.
- The `alerts` job sends up to 20 pending deliveries per tick. A 2xx response is `sent`. Otherwise increment `attempts` and back off 15 min, 1 h, then 6 h. After 4 attempts the delivery is `failed` (visible in the Activity page).
- Channel URLs must be `https:`. A channel whose secret is missing is `skipped`, with the reason shown in the Settings page.
- **ntfy exception:** `http://127.0.0.1` is allowed only when testing via `wrangler dev`, detected through an explicit `channel.allowInsecureLocalhost: true`, which defaults to false.

---

## 13. HTTP API, UI and MCP

### 13.1 Routes (`/api/v1`, JSON, `cache-control: no-store`)

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /api/v1/health` | none | `{ok:true}` only (no version, no counts) |
| `POST /api/v1/session` | none (token mode) | Body `{token}`. A constant-time compare against `DASHBOARD_TOKEN` sets the session cookie. 401 on mismatch, plus an audit `login_failed` row with only a hashed client IP (`sha256(ip + day)` truncated) |
| `DELETE /api/v1/session` | session | Clear the cookie |
| `GET /api/v1/me` | viewer | `{authMode, identity: email or 'token', canAdmin}` |
| `GET /api/v1/summary?currency=&tax=0\|1` | viewer, read-token | KPI tiles, budgets, freshness, warnings (§13.2) |
| `GET /api/v1/spend?from=&to=&groupBy=&provider=&workspace=&apiKey=&model=&tag=dim:value&currency=&tax=` | viewer, read-token | Daily spend series, top 8 + "Other" |
| `GET /api/v1/usage?from=&to=&granularity=hour\|day&metric=tokens\|requests&groupBy=…` | viewer | Token/request series (hourly only for the last 14 days) |
| `GET /api/v1/budgets` / `GET /api/v1/budgets/:id` | viewer, read-token | Current status, history of periods, related events/actions |
| `GET /api/v1/entities?provider=&kind=` | viewer | Keys and workspaces with names, status, tags and MTD spend |
| `GET /api/v1/events?type=&limit=50&before=` | viewer | Alerts, enforcement and sync events, with delivery status |
| `GET /api/v1/status` | viewer | Per-job `sync_state`, last tick, config validity, schema version, which secrets are set (booleans only) |
| `GET /api/v1/config` | viewer | Effective config **with secret names only** and `configured: true/false` |
| `GET /api/v1/export/spend.csv?from=&to=` | viewer | CSV: `day,provider,workspace_id,workspace_name,api_key_id,api_key_name,model,basis,amount_usd,amount_<cur>,<tag dims…>` |
| `POST /api/v1/admin/sync` | admin + CSRF | Runs `tick()` in `ctx.waitUntil`. Allowed at most once every 5 minutes (stored in `meta`). Audited. |
| `POST /api/v1/admin/test-alert` | admin + CSRF | Body `{channelId}`. Creates a `test` event for that channel. Allowed at most once per minute. Audited. |

**Validation.** Query params are validated with zod:
- `from`/`to` are `YYYY-MM-DD`. The range is at most 400 days, and `to ≥ from`.
- `groupBy` is one of `provider|workspace|api_key|model|tag:<dimension>`.
- `currency` is `USD`, the display currency or one of the extra currencies.
- Bad input returns 400 `{error:{code,message}}`.

**Caching.** Responses are cached in `meta.summary_cache:<sha256(params)>`, keyed by `data_version`. Recompute when the version changes, or when the cache is older than 60 s and the day changed.

### 13.2 Example response: `GET /api/v1/summary`

```json
{
  "generatedAt": "2026-11-04T03:15:00Z",
  "currency": "AUD", "taxIncluded": false,
  "fx": { "rate": 1.4319, "day": "2026-11-03", "source": "ECB via Frankfurter (derived USD cross-rate)", "markupPercent": 0 },
  "totals": { "today": 0, "yesterday": 0, "weekToDate": 0, "monthToDate": 0, "monthForecast": null },
  "byProvider": [ { "provider": "anthropic", "monthToDate": 0, "basisMix": { "billed": 0, "allocated": 0, "estimated": 0 } } ],
  "budgets": [ { "id": "org-monthly", "name": "Whole org — monthly", "period": "month", "spent": 0, "limit": 500,
                 "percent": 0, "status": "ok", "forecast": null, "enforcement": { "mode": "dry_run", "pending": 0 } } ],
  "freshness": [ { "provider": "anthropic", "lastSuccessAt": "…", "lastError": null, "stale": false } ],
  "unpricedTokens": 0,
  "warnings": []
}
```

### 13.3 Auth matrix (enforced by middleware, tested in a table)

| Caller | Static SPA | `GET /api/v1/*` | Admin POSTs |
|---|---|---|---|
| No credentials | served (it contains no data) | 401 | 401 |
| Valid Access JWT (`access` mode) | served | ✅ | ✅ if `ADMIN_EMAILS` unset or email listed |
| Valid session cookie (`token` mode) | served | ✅ | ✅ |
| `Authorization: Bearer <READ_API_TOKEN>` | — | ✅ only `summary`, `spend`, `budgets*` | 403 |
| Auth misconfigured | served (shows the Setup page) | 503 `{error:{code:'auth_not_configured'}}` | 503 |

### 13.4 UI (Preact SPA, hash router)

Global header: logo text, nav, currency switcher (USD, display currency, extras), a "incl. <label>" toggle (only if tax is enabled), a data-freshness dot (green if every enabled provider synced in the last 45 min; amber under 3 h; red otherwise), and a sign-out button in token mode.

1. **Overview (`#/`)**
   - KPI tiles: Today, Yesterday, Week-to-date, Month-to-date, Month forecast.
   - A 30-day stacked bar chart by provider.
   - A budget list with progress bars and status chips.
   - Top 5 keys and top 5 models this month.
   - Warnings: unpriced tokens, FX missing, sync errors, enforcement pending.
2. **Explore (`#/explore`)**
   - Range presets: 24 h (hourly tokens), 7 d, 30 d, 90 d, MTD, last month, custom.
   - Group by: provider, workspace/project, key, model or tag dimension. Filters for each.
   - A stacked bar chart, plus a table with spend, share %, tokens and requests, and basis badges.
   - CSV export button.
3. **Budgets (`#/budgets`, `#/budgets/:id`)**
   - The list, then per budget: progress, forecast, thresholds hit, period history (last 12) as bars, events and enforcement actions with their status.
4. **Keys & workspaces (`#/keys`)**
   - Table: provider, name, truncated ID, workspace/project, status, tags, MTD spend, last used.
   - Warnings for OpenRouter duplicate names and for keys protected from enforcement.
5. **Activity (`#/activity`)**
   - Event feed with filters (alerts, enforcement, sync), plus delivery status per channel.
6. **Settings & status (`#/settings`)**
   - Config validity and errors, auth mode, providers (enabled, secret set, last success/error, rows, next due), channels (secret set?) with "Send test", the "Sync now" button, FX source and latest rate, tax setting, schema version and app version.
   - Read-only. Edits happen in `spend.config.ts`, and the page links to the docs.
7. **Login (`#/login`, token mode)** and **Setup (`#/setup`)**, shown when the API returns 503 `auth_not_configured`. Setup has step-by-step instructions and no data.

**Design rules.**
- System font stack, light and dark via `prefers-color-scheme`, no external fonts or CDNs.
- Okabe–Ito colour-blind-safe categorical palette (8 colours, then "Other" in grey).
- Every chart has an adjacent data table (accessibility).
- Respect `prefers-reduced-motion` by turning off Chart.js animation.
- Keyboard-navigable controls.
- Numbers use `Intl.NumberFormat` with the currency.
- Estimated amounts are shown in italics with an "est." badge. Allocated amounts get an "alloc." badge with a tooltip that explains how they were allocated.

**`public/_headers`:**
```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
  Strict-Transport-Security: max-age=31536000
```
The Worker adds the same headers to its own responses. `_headers` doesn't apply to Worker responses (Cloudflare static-assets headers docs, checked 2026-11-04). Vite must not inline scripts: set `build.modulePreload.polyfill=false` and use no inline `<script>`.

### 13.5 MCP (Later; definitions recorded so v1's API shape fits)

A future read-only `POST /mcp` (Streamable HTTP, bearer `READ_API_TOKEN` or Access service token) exposing:
- `get_spend_summary {currency?: string, includeTax?: boolean}`: same data as `/summary`.
- `get_budget_status {budgetId?: string}`: status, percent, remaining amount and period end. This lets agents check remaining budget before expensive work.
- `query_spend {from: string, to: string, groupBy: "provider"|"workspace"|"api_key"|"model"|`tag:${string}`, filters?: object}`.
- `list_recent_events {type?: string, limit?: number}`.

No write tools.

Coding agents can already use `GET /api/v1/budgets` with `READ_API_TOKEN` in v1. Document a short `curl` example in `docs/api.md`.

---

## 14. Security and privacy design

### 14.1 Threat model (summary)

**Assets to protect:**
- Provider admin keys, which have full org control. Anthropic admin keys have no scopes.
- The OpenRouter management key.
- Alert channel secrets.
- Spend data, key names and team structure.

**Adversaries and failures considered:**
- Internet scanners hitting `*.workers.dev`.
- A stolen browser session.
- XSS via provider-supplied names.
- A malicious or compromised provider response (schema drift, huge payloads).
- Supply-chain attacks via dependencies or Actions.
- Operator mistakes: a wrong config causing false enforcement, or secrets committed to a fork.

### 14.2 Controls

**Admin keys and outbound traffic.**
- **Admin keys** exist only as Worker secrets. They're read only inside a provider client and sent only to that provider's fixed host. They're never stored in D1, logged, returned or sent to the browser.
- `/status` and `/config` show only booleans.
- **Outbound allow-list:** each provider client only reaches its host. FX only reaches `api.frankfurter.dev`. Channel URLs come from secrets and must be `https`, and provider credentials are never attached to them.

**Auth.**
- **Fail-closed auth.**
  - In `access` mode, both `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` must be set.
  - In `token` mode, `DASHBOARD_TOKEN` must be ≥ 32 chars.
  - Otherwise every `/api` route except `health` returns 503.
- **Access mode.**
  - Verify `Cf-Access-Jwt-Assertion` with jose `jwtVerify` against a JWKS fetched from `${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`. Fetch it through `deps.fetch` and cache it for 1 h per isolate, then use `createLocalJWKSet`.
  - Re-fetch once when a `kid` is unknown.
  - Check `issuer = ACCESS_TEAM_DOMAIN`, `audience = ACCESS_AUD` and `algorithms: ['RS256']`.
  - Fall back to the `CF_Authorization` cookie only if the header is absent.
  - Workers with Static Assets don't receive `ctx.access` (Cloudflare docs), so manual verification is **required**.
  - Docs: https://developers.cloudflare.com/workers/configuration/cloudflare-access/ .
  - **Service tokens** for machines: Access-issued JWTs without `email` are allowed for GET only when `ALLOWED_EMAILS` is unset. Otherwise they're denied. Document this.
- **Token mode.**
  - Compare SHA-256 digests in constant time.
  - The session cookie is `asd_session=<b64url(payload)>.<b64url(HMAC-SHA256)>`, with payload `{v:1, iat, exp}` and lifetime 12 h.
  - The key is `HKDF-SHA256(ikm=DASHBOARD_TOKEN, salt="ai-spend-dashboard", info="session-v1")` via WebCrypto. Rotating the token invalidates all sessions.
  - Attributes: `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`.
  - No server-side session table.
- **CSRF** on the POSTs: require `content-type: application/json`, a custom header `x-asd-csrf: 1`, and either an `Origin` header equal to the request origin or a missing `Origin`. SameSite=Strict adds defence in depth.
- **Login brute force:** tokens are ≥ 32 random chars (entropy makes guessing infeasible). Failed logins are audited. No lockout in v1, which also avoids a DoS vector.

**Output and input handling.**
- **XSS:** Preact escapes text by default. Never use `dangerouslySetInnerHTML`. The strict CSP has no inline script. Provider names are displayed as text only.
- **Input limits:** request bodies ≤ 16 KB. Query params are validated. Provider responses are capped at 10 MB each (check `content-length`, and abort if the streamed body exceeds the cap). zod validation applies throughout.
- **Logging:** structured `console.log(JSON)` with `redact()` applied to every string field. Never log request headers, URLs with query strings, cookies or response bodies.

**Enforcement.** The safety rails are in §11.4.

**Supply chain.**
- Minimal runtime deps (hono, zod, jose, preact, chart.js).
- `npm ci` with a lockfile.
- Dependabot for npm and GitHub Actions.
- Workflow `permissions: contents: read`, no `pull_request_target`, no secrets in CI.

**Repository hygiene.**
- `scripts/check-secrets.mjs` runs in CI (§17).
- `.gitignore` covers `.dev.vars*` and `.env*`.
- Fixtures use fake IDs.
- `SECURITY.md` gives the private reporting path.

### 14.3 Privacy
- **Data stored:** provider entity IDs and names, token counts, costs and timestamps, all inside the user's own D1. No prompts or completions, which these APIs don't provide anyway. No end-user emails in v1, because Claude Code analytics and OpenAI `user_id` grouping are not pulled.
- **No telemetry** and no analytics scripts. The only third parties contacted are the configured providers, Frankfurter and the configured alert channels.
- **Retention** is configurable (§7.4). `docs/privacy.md` lists every data flow, plus how to wipe the data: delete the D1 database, or run `DELETE` on each table.

### 14.4 `redact()` patterns (unit-tested)

`sk-ant-[A-Za-z0-9_-]{6,}`, `sk-admin-[A-Za-z0-9_-]{6,}`, `sk-proj-[A-Za-z0-9_-]{6,}`, `sk-or-[A-Za-z0-9_-]{6,}`, `sk-[A-Za-z0-9_-]{20,}`, `re_[A-Za-z0-9_]{10,}`, `whsec_[A-Za-z0-9+/=]{10,}`, `tk_[A-Za-z0-9]{10,}`, `Bearer\s+\S+`, `hooks\.slack\.com/services/\S+`, `https?://[^\s"']*ntfy[^\s"']*`, `[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}` (emails). Each match is replaced with `[redacted]`, and output is truncated to 300 chars.

---

## 15. Testing strategy

**Rules.**
- No live network: `test/setup.ts` replaces `globalThis.fetch` with a function that throws `LiveNetworkBlocked`. All I/O goes through injected `deps.fetch`.
- No live credentials. Committed fixtures only.
- Deterministic clock via `deps.now`.
- Keep tests proportional: one primary proof per contract. Don't assert on source strings or UI copy.

### 15.1 Tooling
- `vitest.config.ts` uses `cloudflareTest({ wrangler: { configPath: './test/wrangler.test.jsonc' } })` from `@cloudflare/vitest-plugin` (current docs: https://developers.cloudflare.com/workers/testing/vitest-integration/ , checked 2026-11-04).
  - Exact plugin option names (for example how to pass test bindings): follow the installed package's README and types.
  - Test-only secrets such as `DASHBOARD_TOKEN=test-dashboard-token-0123456789abcdef0123` are passed as Miniflare bindings in the vitest config, **not** in any `.dev.vars`.
- `env` comes from `cloudflare:workers` (or `cloudflare:test`, per the installed version's docs). Cron tests can use `createScheduledController()`, but prefer calling `tick(env, deps)` directly.
- `test/setup.ts`: run `ensureSchema(env.DB)`, block global fetch, and give integration tests a `resetDb()` helper that deletes all rows from every table in `beforeEach`.
- Workers: `maxWorkers: 2` and no file parallelism if memory is constrained (keep the defaults small).
- `msw` + `@msw/cloudflare` is the Cloudflare-documented way to mock outbound fetch. **Don't** add it, because DI makes it unnecessary.

### 15.2 Fixtures (`test/fixtures/**`)
- Hand-written from the **documented** response shapes in §8, with fake IDs (`apikey_01EXAMPLE…`, `wrkspc_01EXAMPLE…`, `proj_example…`, `key_example…`, `example0hash…`) and model names like `claude-example-1` and `gpt-example-1`.
- `test/fixtures/README.md` records each fixture's source doc URL and the date checked.

**Required fixture sets:**
- **Anthropic:**
  - usage 1h with two pages (`has_more`/`next_page`).
  - usage 1d.
  - Usage edge cases: `null` workspace, `null` api_key, `null` `cache_creation`.
  - cost 1d grouped by workspace + description, covering all 5 token types plus `web_search`, `code_execution` and `session_usage`.
  - api_keys with both `workspace_id` and `scope.workspace_id` forms.
  - workspaces.
  - api_key update response.
  - Error bodies: 401, 429 with `retry-after`, 500.
- **OpenAI:**
  - completions 1h with two pages.
  - completions 1d.
  - costs grouped by project + key + line_item, including an unparseable line item and `1000_tokens` quantities.
  - projects (two pages).
  - project api_keys.
  - spend_limit GET 200, GET 404, POST 200, DELETE 200.
  - 429 with `Retry-After`.
- **OpenRouter:**
  - keys (two pages).
  - analytics query with `date__day`.
  - analytics query with `created_at__day`, string counts and `truncated: true`, followed by a split.
  - PATCH response.
  - 403 from a workspace-scoped key.
- **Frankfurter:** a v2 range with a weekend gap, and an empty array.

### 15.3 Unit tests (pure)

| Area | Cases |
|---|---|
| `money.ts` | `centsDecimalStringToMicros` and `usdToMicros` (numbers and strings): negatives, rounding, rejects junk and non-finite values |
| `periods.ts` | UTC day, ISO week starting Monday (including year boundaries), month (including Feb/leap), `elapsed` |
| Provider `map.ts` (each) | Fixture to normalised rows, metric mapping (§7.3), null handling, schema drift error |
| `http.ts` | Retry on 429/5xx with `Retry-After`, no retry on 4xx, timeout, host allow-list, error redaction |
| `allocate.ts` | Exact sum, largest remainder, zero-usage → unattributed, batch vs standard split, priority excluded, web_search by requests |
| `estimate.ts` | Override precedence, learned rate, unpriced tokens, billed-wins rule |
| `tags/match.ts` | Glob, AND/OR semantics, first-match, untagged |
| `fx/convert.ts` | Nearest-previous rate, earliest-after fallback, markup, tax, missing FX |
| `budgets/evaluate.ts` + `forecast.ts` | Thresholds, dedupe keys, status, forecast gating (25%), FX guard, just-closed period |
| `enforcement/plan.ts` | Mode matrix (off/dry_run/live × enforce block), protected IDs, caps, stale-data guard, override detection, restore decisions |
| `alerts/format.ts` | Golden outputs per channel, no secrets or full IDs, length limits (ntfy 4,096, Title 100) |
| `webhook` signing | Standard Webhooks signature vector |
| `auth.ts` | Access JWT: generate an RSA key pair with WebCrypto **in the test**, sign with jose, serve the JWKS via fake fetch; cover wrong aud/iss/exp/alg, unknown kid then refetch, `ALLOWED_EMAILS`. Session cookie: tamper, expiry, rotation |
| `redact.ts` | Every pattern in §14.4 |
| `config-schema.ts` | Shipped config and both examples valid; each refinement error |

### 15.4 Integration tests (workerd + local D1)
1. **Full tick, happy path.** All three providers are mocked. Assert row counts in each table, `spend_daily` totals equal billed totals exactly, `data_version` bumped, and `sync_state` success.
2. **Idempotency.** A second tick with the same fixtures leaves zero changed rows (check `meta.changes`).
3. **Late revision.** The second tick returns a changed amount and one fewer row for a day. The table matches the new data exactly.
4. **Budgets → alerts.** Crossing 80% creates one event and one delivery per channel. A repeated tick creates no duplicates. A failing channel retries with backoff.
5. **Enforcement matrix.**
   - `dry_run` records actions and makes no provider write calls. Assert fake fetch saw no POST or PATCH.
   - `live` applies each of the four action types with the exact request bodies from §11.4.
   - Restore at period end.
   - A human override detected leads to `overridden`, and the action isn't re-applied.
6. **Free-plan budget.** With `runtime.plan='free'` and many OpenAI projects, the tick stops at 40 subrequests, and the remaining jobs run on the next tick.
7. **Lock.** Concurrent `tick()` calls: one runs, the other returns immediately.
8. **HTTP auth matrix** (§13.3), table-driven over every route. Also cover: 503 when misconfigured, CSRF rejections, security headers present, `/config` and `/status` responses never contain any test secret value (assert on the response text).
9. **API shapes.** `summary`, `spend` (each `groupBy`, including a tag), `usage` hourly, `budgets`, CSV header row. Validate responses against the zod schemas in `api-types.ts`.
10. **Migrator.** Fresh DB → version N. A second run is a no-op. Simulated concurrent apply.

**Not in v1:** browser E2E tests. Manual smoke steps go in CONTRIBUTING: `npm run dev`, open `http://127.0.0.1:8787`, then trigger a local cron with `curl "http://127.0.0.1:8787/cdn-cgi/local/scheduled?cron=*/15+*+*+*+*"` (Cloudflare docs: `/cdn-cgi/local/scheduled`, `wrangler dev --test-scheduled`).

---

## 16. Build, local dev and scripts

### 16.1 `package.json` (essentials)
```json
{
  "name": "ai-spend-dashboard", "version": "0.1.0", "private": true, "type": "module",
  "license": "Apache-2.0", "engines": { "node": ">=22" },
  "scripts": {
    "dev": "npm run build && wrangler dev --test-scheduled",
    "dev:web": "vite --host 127.0.0.1 --port 5173",
    "build": "vite build",
    "deploy": "npm run build && wrangler deploy",
    "lint": "biome ci .",
    "format": "biome format --write .",
    "typecheck": "wrangler types --check && tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "check:secrets": "node scripts/check-secrets.mjs",
    "cf-typegen": "wrangler types",
    "check": "npm run lint && npm run typecheck && npm test && npm run build && npm run check:secrets"
  },
  "cloudflare": { "bindings": { "DASHBOARD_TOKEN": { "description": "…" } } }
}
```
**Deploy-button behaviour.** The Deploy button pre-fills its build and deploy commands from the `build`/`deploy` scripts (Cloudflare docs). `deploy` rebuilds, which is harmless and keeps the manual `npm run deploy` correct.

### 16.2 Vite
- `root: 'src/web'`, `build.outDir: '../../dist/web'`, `publicDir: '../../public'`.
- Plugin: `@preact/preset-vite`.
- `server.host: '127.0.0.1'`, with `server.proxy['/api'] = 'http://127.0.0.1:8787'`.

### 16.3 Platform limits that shape the code (Cloudflare, checked 2026-11-04)
- **Workers Free:** 100k requests/day, **10 ms CPU** per invocation, **50 subrequests**, 128 MB memory, **5 cron triggers per account**.
- **Workers Paid:** 30 s CPU by default for HTTP; cron gets 30 s (interval < 1 h) or 15 min (≥ 1 h); 10,000 subrequests.
- **D1 Free:** 5M rows read/day, 100k rows written/day, **500 MB per database**, 50 queries per invocation (batch = 1). D1 Paid: 10 GB per database.
- **D1 query limits:** 100 bound params, 100 KB statement, 30 s per query.
- **Time Travel:** 7 days (Free) or 30 days (Paid).

Sources: https://developers.cloudflare.com/workers/platform/limits/ , https://developers.cloudflare.com/d1/platform/limits/ .

### 16.4 Local dev safety
- `wrangler.jsonc` sets `dev.ip = 127.0.0.1`, and Vite uses `--host 127.0.0.1`. Never use `0.0.0.0`.
- `.dev.vars` (gitignored) holds local secrets. CONTRIBUTING explains how to run with **no** provider keys: the dashboard shows the empty state.
- Add a `npm run seed:local` script that loads **synthetic** demo rows into the local D1 for UI work (`scripts/seed-local.mjs`). Output must be clearly labelled "synthetic demo data".

---

## 17. CI (GitHub Actions)

`.github/workflows/ci.yml`:
```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
      - run: npx wrangler deploy --dry-run --outdir dist/worker
      - run: npm run check:secrets
```

**Action versions.** `actions/checkout` latest is `v7.0.1` and `actions/setup-node` latest is `v7.1.0` (GitHub API, checked 2026-11-04). If `@v7` fails to resolve, use the latest major shown on the action's releases page.

**`wrangler deploy --dry-run`** must not need Cloudflare credentials. If it does with the installed Wrangler, replace it with `npx wrangler types --check` (already in typecheck) and note that in the PR.

**Other CI files.**
- `dependabot.yml`: weekly updates for `npm` and `github-actions`, grouping minor and patch updates.

**`scripts/check-secrets.mjs`** scans `git ls-files` output for:
- Key-like patterns from §14.4 (anything other than the documented fake test values).
- `-----BEGIN [A-Z ]*PRIVATE KEY-----`.
- IPv4 addresses other than `127.0.0.1`, `0.0.0.0` and the documentation ranges `192.0.2.x`, `198.51.100.x` and `203.0.113.x`.
- Email addresses other than `@example.com`, `@example.org` and `@example.net`.
- `workers.dev` hostnames other than `<placeholder>.workers.dev`.
- UUID-shaped strings in `wrangler*.jsonc`.

It exits 1 and lists `file:line`. There's an allowlist file `scripts/check-secrets.allow` for intentional examples (for example spec URLs).

---

## 18. Documentation and licence

**README.md** must cover:
- **Intro:** a one-paragraph pitch and how it differs from local-log tools and gateways (neutral and factual).
- **Feature list:** a "Supported providers" table with status (v1: Anthropic, OpenAI, OpenRouter; Later list).
- **Deploy:**
  - The Deploy button: `[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ImLukeF/ai-spend-dashboard)`.
  - Manual deploy steps.
  - Creating each provider's admin key, with links.
  - Choosing auth: Access recommended, token otherwise.
- **Configuration:** a `spend.config.ts` walkthrough covering budgets, tags, channels and enforcement. Enforcement gets **prominent warnings**: dry-run first, test on sandbox keys/projects, lag, prefer native caps.
- **Currency and tax** explanation.
- **Costs:** Cloudflare Free vs Paid trade-offs, linking to Cloudflare pricing. Don't state prices for third parties beyond those cited in §8.5.
- **Limitations, FAQ, security note, licence.**
- **Screenshots:** none in v1, or only from `seed:local` synthetic data, labelled "synthetic demo data".

**`docs/*`:**
- `deploy.md`: button and manual deploy, custom domain, Access setup step by step, upgrading.
- `configuration.md`: full schema reference generated by hand from the zod schema, plus every secret.
- `auth.md`: Access vs token, service tokens, `READ_API_TOKEN`.
- `providers.md`: per-provider endpoints used, permissions, coverage gaps, data lag, native caps. Copy §8, including the UNVERIFIED notes.
- `budgets-and-enforcement.md`: semantics, safety rails, the restore and override rules, a dry-run walkthrough.
- `alerts.md`: payloads, how to verify a webhook signature (with a Node snippet), ntfy and Slack setup.
- `currency-and-tax.md`: ECB attribution, derived cross-rates, markup, the tax disclaimer.
- `data-model.md`: tables, bases, the allocation explanation.
- `api.md`: routes, examples, the read token for agents.
- `privacy.md` and `troubleshooting.md`: CPU limits, 401/403 from providers, missing rows, FX gaps.

**Other files.**
- **CONTRIBUTING.md:**
  - Setup (Node 24, `npm ci`), commands, dev on 127.0.0.1.
  - The test rules: fixtures only, no live calls, no real IDs.
  - How to sanitise a real response into a fixture: replace every ID, name and amount.
  - An "Adding a provider" checklist: adapter + schemas + fixtures + docs + registry + status table.
  - Migration rules, Conventional Commits, and "PRs only; the maintainer merges".
  - DCO sign-off is **not** required unless the maintainer decides otherwise (§21).
- **SECURITY.md:**
  - Report privately via GitHub "Report a vulnerability" (Security Advisories). No email address is listed.
  - Scope: the Worker, auth, enforcement, secret handling.
  - Supported versions: latest release.
  - Guidance: rotate provider admin keys if exposed; this project never asks for keys outside Worker secrets.
- **CODE_OF_CONDUCT.md:** Contributor Covenant 2.1, with enforcement contact = GitHub private report to the maintainer. No email.
- **CHANGELOG.md:** Keep a Changelog format; `0.1.0 — Unreleased`.
- **LICENSE: Apache-2.0** (full text from https://www.apache.org/licenses/LICENSE-2.0.txt). `NOTICE`: "ai-spend-dashboard — Copyright 2026 the ai-spend-dashboard contributors", plus the data attribution line for ECB/Frankfurter.

**Why Apache-2.0 over MIT.** Both are permissive and compatible with all the dependencies (MIT/Apache).
- Apache-2.0 adds an **express patent grant** with patent-retaliation termination (§3) and explicit contribution licensing (§5). That matters for a tool companies deploy internally and that takes outside contributions (choosealicense.com, apache.org, checked 2026-11-04).
- Peers differ: ccusage is MIT, Helicone is Apache-2.0, Langfuse is MIT except `ee/`.
- MIT would also be acceptable. See open question Q1.

---

## 19. Milestones for the v1 PR (ordered; tick each in the PR description)

Each milestone ends with `npm run check` passing locally on that commit.

- [ ] **M0 Scaffold and tooling.**
  - Files: `package.json`, lockfile, `.nvmrc`, `tsconfig*`, `biome.json`, `wrangler.jsonc`, `test/wrangler.test.jsonc`, `worker-configuration.d.ts`, `.gitignore`, `.dev.vars.example`, a minimal `src/worker/index.ts` returning 404, a Vite skeleton, `ci.yml`, `dependabot.yml`, LICENSE, NOTICE and stub docs.
  - *AC:* `npm ci && npm run check` passes. CI runs on the PR. `check:secrets` passes. `wrangler types --check` passes.
- [ ] **M1 Shared core.**
  - Files: `config-schema.ts` + `spend.config.ts` + examples, `money.ts`, `periods.ts`, `redact.ts`, `hash.ts`, `log.ts`.
  - *AC:* the unit tests in §15.3 for these modules pass. An invalid config produces readable errors.
- [ ] **M2 D1 schema and repos.**
  - Files: `migrations.ts` (§7.2 exactly), `migrate.ts`, typed repos with the json_each window-replace helper.
  - *AC:* migrator tests pass. Window-replace upsert/delete tests pass. An unchanged upsert writes 0 rows.
- [ ] **M3 HTTP shell and auth.**
  - Files: Hono app, error handling, security headers, `public/_headers`, Access JWT, session login/logout, read token, CSRF, `/health`, `/me`, `/status` (stub), `/config`.
  - *AC:* the auth matrix and CSRF integration tests pass. Misconfiguration returns 503. No secret value appears in any response.
- [ ] **M4 Provider framework and Anthropic.**
  - Files: `http.ts` (retry, allow-list, redaction, budget counting), the Anthropic adapter (usage hourly/daily, cost, entities) with fixtures.
  - *AC:* the Anthropic mapping and HTTP unit tests pass. Pagination is followed. Schema drift is surfaced.
- [ ] **M5 OpenAI adapter.**
  - Scope: usage hourly/daily, costs (line-item parsing), projects + keys round-robin.
  - *AC:* fixtures map correctly, `1000_tokens` is handled, and 429 is retried.
- [ ] **M6 OpenRouter adapter.**
  - Scope: keys paging, analytics query (both date keys, string numbers, truncation split, name→hash mapping).
  - *AC:* fixtures map correctly. Duplicate names are flagged.
- [ ] **M7 Tick orchestrator.**
  - Scope: registry, due logic, lock, plan budgets, deadline, backfill cursors, `sync_state`, retention, `scheduled()` wiring.
  - *AC:* the integration tests for happy path, idempotency, late revision, free-plan budget and lock pass.
- [ ] **M8 Derive and tags.**
  - Scope: allocation, estimation, effective rates, `spend_daily`, tag materialisation.
  - *AC:* the allocation and estimation unit tests pass. The integration test shows `spend_daily` totals equal to billed totals exactly. Tag grouping works.
- [ ] **M9 FX and tax.**
  - Scope: the Frankfurter client (v2, `providers=ECB`), fx job, conversion, markup, tax view.
  - *AC:* the conversion tests pass, missing FX shows a warning, and the ECB attribution appears in the UI footer and NOTICE.
- [ ] **M10 Budgets.**
  - Scope: evaluation, forecast, `budget_periods`, events with dedupe.
  - *AC:* the budget unit tests and the budgets → alerts integration test pass.
- [ ] **M11 Alerts.**
  - Scope: the four channel types (webhook signed, Slack, ntfy, email via Resend or Cloudflare), delivery retries, test-alert endpoint.
  - *AC:* golden format tests and the signature vector test pass. Retries and backoff work. A missing secret gives `skipped`.
- [ ] **M12 Enforcement.**
  - Scope: plan, execute and restore for the 4 action types, all safety rails, audit log.
  - *AC:* the enforcement-matrix integration test passes, including that no write call happens in `dry_run` and that override is respected.
- [ ] **M13 Read API.**
  - Scope: `summary`, `spend`, `usage`, `budgets`, `entities`, `events`, `status`, CSV export, caching by `data_version`, the admin sync endpoint.
  - *AC:* the API shape tests pass. The read token is limited to the documented routes.
- [ ] **M14 Dashboard UI.**
  - Scope: all pages in §13.4, charts with data tables, currency and tax toggles, the Setup and Login flows, synthetic seed script.
  - *AC:* `npm run build` succeeds. Manual smoke on `127.0.0.1` with `seed:local` renders every page with no console errors. The CSP has no violations, checked in the browser console. In the PR, attach screenshots taken from synthetic data only, or state that none were taken.
- [ ] **M15 Docs and polish.**
  - Scope: README with the Deploy button, all `docs/*`, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, CHANGELOG, issue/PR templates.
  - *AC:* every UNVERIFIED item from §8 and §11.6 appears in `docs/providers.md` or the relevant doc. No private names, IDs, IPs or emails (`check:secrets` passes).
- [ ] **M16 Final verification.**
  - Steps: `npm ci && npm run check` from clean, plus `wrangler deploy --dry-run`. Then fill in the PR description: summary, milestone checklist, deviations from the plan with reasons, UNVERIFIED items touched, and "not deployed".

---

## 20. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Anthropic retires the legacy usage/cost endpoints | Anthropic sync breaks | Narrow adapter interface. Schema-drift errors are surfaced. Analytics adapter planned (Later). Docs link the deprecation notice. |
| Provider schema drift (OpenRouter analytics "evolves") | Wrong or missing data | zod validation with explicit drift errors, sync-failure alerts, tolerant parsing, fixture tests per shape |
| Per-key Anthropic costs are **allocated**, not billed | Per-key numbers can be slightly off (context window, speed, geo) | Basis badges, a documented method, exact totals, unit tests |
| Data latency (15-min polling plus provider lag; OpenAI/OpenRouter lag UNVERIFIED) | A cap stops spend late | Docs say so plainly. Recommend native caps. Forecast alerts give early warning. |
| False-positive enforcement (bug, FX glitch, duplicate rows) | A production key gets disabled | Double opt-in, dry-run default, explicit targets, protected IDs, freshness/FX guards, caps, reversible-only, override respect, alerts on every action |
| OpenAI 1-cent spend-limit semantics UNVERIFIED | Stop may not apply as expected | Documented: test on a sandbox project. The action records the provider response, and a failure raises a critical alert. |
| Free-plan CPU (10 ms) or subrequest (50) limits | Ticks fail or lag | Job budgets, SQL aggregation, chunked backfill, `runtime.plan` switch, a docs recommendation for Paid |
| Admin key compromise via Worker or account | Full provider org control | Secrets only, Access recommended, no key echo, minimal deps, SECURITY.md rotation guidance |
| Deploy button prompts or blank secrets behave unexpectedly (UNVERIFIED) | First-run confusion | Short `.dev.vars.example`, a `-` = unset convention, the Setup page, troubleshooting docs |
| FX source terms or availability | Wrong or missing currency view | ECB attribution, USD always available, self-hostable Frankfurter, a banner on gaps |
| Tax view misread as tax advice | User confusion | Explicit disclaimer and "for budgeting only" copy |
| Scope creep in one PR | Late or low-quality v1 | Strict v1 list, Later list, milestone ACs |

---

## 21. Open questions for the maintainer (defaults the build uses until answered)

1. **Licence:** Apache-2.0 (default) or MIT?
2. **Cron cadence:** `*/15` (default) vs hourly. Hourly cuts invocations to a quarter and, on Paid, gets 15 min CPU instead of 30 s, but adds up to 45 min of extra enforcement lag.
3. **Default display currency** in the shipped config: USD (default), with AUD + GST shown in an example. Should the shipped default be AUD instead?
4. **OpenAI enforcement:** keep `openai.set_project_spend_limit` in v1 (default yes, dry-run by default), or ship OpenAI as alert-only until it's tested on a sandbox project?
5. **Anthropic Analytics API:** add the beta analytics adapter as a reconciliation source soon after v1, or wait until it leaves beta?
6. **More providers, in priority order:** suggested xAI → Fireworks → GitHub Copilot → Together → Cursor (Enterprise).
7. **MCP endpoint (§13.5) and ingest API for local collectors:** next release or not at all?
8. **DCO sign-off** for contributions: off by default. Turn it on?
9. **Screenshots in the README:** synthetic-data screenshots acceptable?
10. **Repo description and topics:** the maintainer sets these in GitHub settings, since the build agent must not change repo settings.

---

## 22. Prior art and differentiation (all checked 2026-11-04)

### 22.1 Local-log tools
- `ccusage/ccusage` (19,318 stars, MIT): local CLI logs. https://github.com/ccusage/ccusage

### 22.2 Gateways and tracing (they need traffic routed or instrumented)
- Helicone (6,258 stars, Apache-2.0): https://github.com/Helicone/helicone
- LiteLLM (62,645 stars, MIT except `enterprise/`): virtual-key budgets, needs Postgres. https://github.com/BerriAI/litellm , https://docs.litellm.ai/docs/proxy/users
- Portkey gateway (13,313 stars, MIT): https://github.com/Portkey-AI/gateway
- Langfuse (36,965 stars, MIT except `ee/`): https://github.com/langfuse/langfuse
- OpenLIT (2,903 stars, Apache-2.0): https://github.com/openlit/openlit
- OpenMeter (2,432 stars, Apache-2.0): https://github.com/openmeterio/openmeter

### 22.3 Tools that read admin APIs
- `Mfrostbutter/tokenpulse` (5 stars, MIT): https://github.com/Mfrostbutter/tokenpulse
- `laigit-dot/api-token-usage-alert` (16 stars, MIT): https://github.com/laigit-dot/api-token-usage-alert
- `amedinat/LLMeter` (7 stars, AGPL-3.0): https://github.com/amedinat/LLMeter
- `htin1/toktop` (174 stars, MIT, terminal UI): https://github.com/htin1/toktop
- `shawnpetros/lithium` (2 stars, MIT): https://github.com/shawnpetros/lithium

### 22.4 Official examples (MIT)
- Anthropic: https://github.com/anthropics/claude-cookbooks/blob/main/observability/usage_cost_api.ipynb
- OpenAI: https://github.com/openai/openai-cookbook/blob/main/examples/completions_usage_api.ipynb

### 22.5 Differentiation
- Serverless one-click deploy into the user's own Cloudflare account.
- No proxy.
- Billed-vs-allocated-vs-estimated provenance.
- Reversible, audited hard-stops.
- Multi-channel signed alerts.
- FX and tax view.
- Apache-2.0.

**Don't copy code from AGPL projects.**

---

## 23. Sources (all checked 2026-11-04)

**Anthropic:**
- https://platform.claude.com/docs/en/manage-claude/usage-cost-api
- https://platform.claude.com/docs/en/api/beta/organization/usage_report/retrieve_messages
- https://platform.claude.com/docs/en/api/beta/organization/cost_report/retrieve
- https://platform.claude.com/docs/en/manage-claude/usage-cost-analytics-api
- https://platform.claude.com/docs/en/manage-claude/claude-code-analytics-api
- https://platform.claude.com/docs/en/manage-claude/admin-api
- https://platform.claude.com/docs/en/manage-claude/admin-api-keys
- https://platform.claude.com/docs/en/manage-claude/authentication
- https://platform.claude.com/docs/en/api/organization/api_keys/list
- https://platform.claude.com/docs/en/api/organization/api_keys/update
- https://platform.claude.com/docs/en/manage-claude/workspaces
- https://platform.claude.com/docs/en/api/organization/workspaces
- https://platform.claude.com/docs/en/manage-claude/rate-limits-api
- https://platform.claude.com/docs/en/manage-claude/spend-limits-api
- https://platform.claude.com/docs/en/api/versioning
- https://support.claude.com/en/articles/12997130-understanding-your-billing-address-and-tax-calculations

**OpenAI:**
- https://developers.openai.com/api/docs/guides/admin-apis
- https://developers.openai.com/api/docs/guides/spend-limits
- https://developers.openai.com/api/docs/guides/rbac
- https://developers.openai.com/api/docs/guides/terraform/projects-and-access
- https://developers.openai.com/cookbook/examples/completions_usage_api
- https://github.com/openai/openai-openapi (openapi.yaml: `/organization/usage/*`, `/organization/costs`, `/organization/projects*`, `/organization/projects/{project_id}/spend_limit`)

**OpenRouter:**
- https://openrouter.ai/docs/guides/overview/auth/management-api-keys.md
- https://openrouter.ai/docs/api/api-reference/api-keys/list-api-keys.md
- https://openrouter.ai/docs/api/api-reference/api-keys/update-an-api-key.md
- https://openrouter.ai/docs/api/api-reference/analytics/query-analytics-data.md
- https://openrouter.ai/docs/cookbook/administration/analytics-cost-control.md
- https://openrouter.ai/docs/api/api-reference/analytics/get-user-activity-grouped-by-endpoint.md
- https://openrouter.ai/docs/api/api-reference/credits/get-remaining-credits.md

**Cloudflare:**
- https://developers.cloudflare.com/workers/platform/deploy-buttons/
- https://developers.cloudflare.com/workers/wrangler/configuration/
- https://developers.cloudflare.com/workers/configuration/cron-triggers/
- https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/d1/worker-api/d1-database/
- https://developers.cloudflare.com/workers/static-assets/routing/worker-script/
- https://developers.cloudflare.com/workers/static-assets/headers/
- https://developers.cloudflare.com/workers/configuration/cloudflare-access/
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
- https://developers.cloudflare.com/email-service/
- https://developers.cloudflare.com/email-service/api/send-emails/workers-api/
- https://developers.cloudflare.com/workers/configuration/secrets/
- https://developers.cloudflare.com/workers/testing/vitest-integration/
- https://developers.cloudflare.com/workers/testing/vitest-integration/mock-outbound-requests/
- https://developers.cloudflare.com/workers/languages/typescript/

**FX:**
- https://frankfurter.dev/ , https://github.com/lineofflight/frankfurter , https://api.frankfurter.dev/v2/rates (live check)
- https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html
- https://www.rba.gov.au/copyright/
- https://www.exchangerate-api.com/docs/free

**Tax:**
- ATO page in §8.6
- https://www.gov.uk/vat-rates , https://www.ird.govt.nz/gst , https://taxation-customs.ec.europa.eu/taxation/vat/vat-directive/vat-rates_en

**Alerts:**
- https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks
- https://docs.ntfy.sh/publish/
- https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md
- https://resend.com/docs/api-reference/emails/send-email

**Licences:**
- https://choosealicense.com/licenses/mit/ , https://choosealicense.com/licenses/apache-2.0/ , https://www.apache.org/licenses/LICENSE-2.0.txt
- https://www.contributor-covenant.org/version/2/1/code_of_conduct/

**Other providers:** URLs in §8.5.

**Demand:**
- https://news.ycombinator.com/item?id=50149426 , https://news.ycombinator.com/item?id=48754713 (via https://hn.algolia.com/api/v1/)

**Package versions:** registry.npmjs.org and the GitHub releases API, checked 2026-11-04 (§5.2, §17).
