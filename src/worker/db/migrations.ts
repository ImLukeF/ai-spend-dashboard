export const MIGRATIONS = [
  {
    version: 1,
    name: "init",
    statements: `
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
`
      .replace(/--[^\n]*/g, "")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean),
  },
];
