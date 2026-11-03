import { z } from "zod";
import type { SpendRow } from "../../shared/api-types";
import type { Config } from "../../shared/config-schema";
import { addDays, day, iso, period } from "../../shared/periods";
import { channelConfigured } from "../alerts/dispatch";
import { getMeta, setMeta } from "../db/repo/state";
import type { Deps } from "../deps";
import { mode } from "../enforcement/plan";
import { providerSecrets, secret } from "../env";
import { convert, type FxRate, rateFor } from "../fx/convert";
import { hash } from "../lib/hash";
export class InputError extends Error {}
const date = z.iso.date();
const paramsSchema = z.object({
  from: date.optional(),
  to: date.optional(),
  groupBy: z
    .string()
    .regex(/^(provider|workspace|api_key|model|tag:[a-z0-9][a-z0-9-]{0,47})$/)
    .default("provider"),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  tax: z.enum(["0", "1"]).default("0"),
  provider: z.enum(["anthropic", "openai", "openrouter"]).optional(),
  workspace: z.string().max(200).optional(),
  apiKey: z.string().max(200).optional(),
  model: z.string().max(200).optional(),
  tag: z.string().max(240).optional(),
  granularity: z.enum(["hour", "day"]).default("day"),
  metric: z.enum(["tokens", "requests"]).default("tokens"),
});
export function queryParams(url: URL, deps: Deps) {
  const raw = Object.fromEntries(url.searchParams);
  const parsed = paramsSchema.safeParse(raw);
  if (!parsed.success) throw new InputError("Invalid query parameters");
  const p = parsed.data;
  const from = p.from ?? day(addDays(deps.now(), -29));
  const to = p.to ?? day(deps.now());
  if (to < from || (Date.parse(to) - Date.parse(from)) / 86400000 > 399)
    throw new InputError("Range must be ordered and at most 400 days");
  const currency = p.currency ?? deps.config.display.currency;
  if (
    !["USD", deps.config.display.currency, ...deps.config.display.extraCurrencies].includes(
      currency,
    )
  )
    throw new InputError("Unsupported display currency");
  if (
    p.groupBy.startsWith("tag:") &&
    !deps.config.tags.some((t) => t.dimension === p.groupBy.slice(4))
  )
    throw new InputError("Unknown tag dimension");
  if (p.tag && !deps.config.tags.some((t) => t.dimension === p.tag?.split(":")[0]))
    throw new InputError("Unknown tag filter");
  return { ...p, from, to, currency };
}
type Params = ReturnType<typeof queryParams>;
function filter(p: Params) {
  const clauses = [];
  const args: unknown[] = [];
  for (const [q, col] of [
    ["provider", "provider"],
    ["workspace", "workspace_id"],
    ["apiKey", "api_key_id"],
    ["model", "model"],
  ] as const) {
    if (p[q]) {
      clauses.push(`s.${col}=?`);
      args.push(p[q]);
    }
  }
  if (p.tag) {
    const split = p.tag.indexOf(":");
    if (split < 1) throw new InputError("Tag filter must be dimension:value");
    clauses.push(
      "EXISTS(SELECT 1 FROM entity_tags t WHERE t.provider=s.provider AND t.workspace_id=s.workspace_id AND t.api_key_id=s.api_key_id AND t.dimension=? AND t.value=?)",
    );
    args.push(p.tag.slice(0, split), p.tag.slice(split + 1));
  }
  return { sql: clauses.length ? ` AND ${clauses.join(" AND ")}` : "", args };
}
function grouping(group: string) {
  if (group === "provider") return "s.provider";
  if (group === "model") return "COALESCE(NULLIF(s.model,''),'(unattributed)')";
  if (group === "workspace")
    return "COALESCE((SELECT e.name FROM entities e WHERE e.provider=s.provider AND e.kind='workspace' AND e.id=s.workspace_id),NULLIF(s.workspace_id,''),'Default workspace') || ' · ' || s.provider || ' · ' || substr(s.workspace_id,-8)";
  if (group === "api_key")
    return "COALESCE((SELECT e.name FROM entities e WHERE e.provider=s.provider AND e.kind='api_key' AND e.id=s.api_key_id),NULLIF(s.api_key_id,''),'No key (Console)') || ' · ' || s.provider || ' · ' || substr(s.api_key_id,-8)";
  return "COALESCE((SELECT value FROM entity_tags t WHERE t.provider=s.provider AND t.workspace_id=s.workspace_id AND t.api_key_id=s.api_key_id AND t.dimension=?),'(untagged)')";
}
export async function spend(deps: Deps, p: Params) {
  const db = deps.env.DB;
  const f = filter(p);
  const group = grouping(p.groupBy);
  const groupArgs = p.groupBy.startsWith("tag:") ? [p.groupBy.slice(4)] : [];
  const facts = await db
    .prepare(
      `SELECT day,${group} AS label,basis,SUM(amount_micros) amount_micros,SUM(unpriced_tokens) unpriced_tokens FROM spend_daily s WHERE day>=? AND day<=?${f.sql} GROUP BY day,label,basis`,
    )
    .bind(...groupArgs, p.from, p.to, ...f.args)
    .all<{
      day: string;
      label: string;
      basis: "billed" | "allocated" | "estimated";
      amount_micros: number;
      unpriced_tokens: number;
    }>();
  const rates = (await db.prepare("SELECT * FROM fx_rates").all<FxRate>()).results;
  const missing = facts.results.some((r) => !rateFor(rates, r.day, p.currency));
  const currency = missing ? "USD" : p.currency;
  const rows = new Map<string, SpendRow>();
  const tax =
    p.tax === "1" && deps.config.display.tax.enabled ? deps.config.display.tax.ratePercent : 0;
  for (const r of facts.results) {
    const k = `${r.day}:${r.label}`;
    const row = rows.get(k) ?? {
      day: r.day,
      group: r.label,
      amount: 0,
      amountMicros: 0,
      basisMix: { billed: 0, allocated: 0, estimated: 0 },
      unpricedTokens: 0,
      tokens: 0,
      requests: 0,
    };
    row.amount += convert(
      r.amount_micros,
      r.day,
      currency,
      rates,
      deps.config.fx.markupPercent,
      tax,
    ).amount;
    row.amountMicros += r.amount_micros;
    row.basisMix[r.basis] += r.amount_micros;
    row.unpricedTokens += r.unpriced_tokens;
    rows.set(k, row);
  }
  const counts = await db
    .prepare(
      `SELECT day,${group} AS label,SUM(CASE WHEN metric LIKE 'input_%' OR metric='output' THEN quantity ELSE 0 END) tokens,SUM(CASE WHEN metric='requests' THEN quantity ELSE 0 END) requests FROM usage_daily s WHERE day>=? AND day<=?${f.sql} GROUP BY day,label`,
    )
    .bind(...groupArgs, p.from, p.to, ...f.args)
    .all<{ day: string; label: string; tokens: number; requests: number }>();
  for (const c of counts.results) {
    const r = rows.get(`${c.day}:${c.label}`);
    if (r) {
      r.tokens = c.tokens;
      r.requests = c.requests;
    }
  }
  const totals = new Map<string, number>();
  for (const r of rows.values()) totals.set(r.group, (totals.get(r.group) ?? 0) + r.amount);
  const top = new Set(
    [...totals]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([label]) => label),
  );
  const out = new Map<string, SpendRow>();
  for (const r of rows.values()) {
    const group = top.has(r.group) ? r.group : "Other";
    const key = `${r.day}:${group}`;
    const existing = out.get(key);
    if (existing) {
      existing.amount += r.amount;
      existing.amountMicros += r.amountMicros;
      existing.tokens += r.tokens;
      existing.requests += r.requests;
      existing.unpricedTokens += r.unpricedTokens;
      for (const basis of ["billed", "allocated", "estimated"] as const)
        existing.basisMix[basis] += r.basisMix[basis];
    } else out.set(key, { ...r, group, basisMix: { ...r.basisMix } });
  }
  return {
    rows: [...out.values()].sort(
      (a, b) => a.day.localeCompare(b.day) || a.group.localeCompare(b.group),
    ),
    currency,
    taxIncluded: tax > 0,
    warnings: [
      ...(missing ? ["FX unavailable; showing USD"] : []),
      ...(facts.results.some((r) => r.basis === "estimated")
        ? [
            "Estimated amounts may include priority tier, which is absent from Anthropic cost reports",
          ]
        : []),
    ],
  };
}
export async function usage(deps: Deps, p: Params) {
  if (
    p.granularity === "hour" &&
    p.from < day(addDays(deps.now(), -deps.config.sync.hourlyRetentionDays))
  )
    throw new InputError("Hourly data outside retention");
  const hourly = p.granularity === "hour";
  const bucket = hourly ? "hour" : "day";
  const f = filter(p);
  const rows = await deps.env.DB.prepare(
    `SELECT ${bucket} bucket,${grouping(p.groupBy)} AS label,SUM(quantity) quantity FROM ${hourly ? "usage_hourly" : "usage_daily"} s WHERE ${bucket}>=? AND ${bucket}<?${f.sql} AND ${p.metric === "tokens" ? "(metric LIKE 'input_%' OR metric='output')" : "metric='requests'"} GROUP BY ${bucket},label ORDER BY ${bucket}`,
  )
    .bind(
      ...(p.groupBy.startsWith("tag:") ? [p.groupBy.slice(4)] : []),
      p.from,
      day(addDays(new Date(p.to), 1)),
      ...f.args,
    )
    .all<{ bucket: string; label: string; quantity: number }>();
  return {
    rows: rows.results.map((r) => ({ bucket: r.bucket, group: r.label, quantity: r.quantity })),
  };
}
export async function budgets(deps: Deps) {
  const rows = (
    await deps.env.DB.prepare("SELECT * FROM budget_periods ORDER BY period_start DESC").all<
      Record<string, unknown>
    >()
  ).results;
  const pending = (
    await deps.env.DB.prepare(
      "SELECT budget_id,period_start,count(*) count FROM enforcement_actions WHERE status IN ('planned','restore_failed') GROUP BY budget_id,period_start",
    ).all<{ budget_id: string; period_start: string; count: number }>()
  ).results;
  return {
    budgets: deps.config.budgets.map((b) => {
      const current = rows.find(
        (r) => r.budget_id === b.id && r.period_start === period(deps.now(), b.period).start,
      );
      return {
        id: b.id,
        name: b.name,
        period: b.period,
        spent: Number(current?.spent ?? 0),
        limit: b.amount,
        currency: current?.currency ?? b.currency,
        percent: Number(current?.percent ?? 0),
        status: current?.status ?? "ok",
        forecast: current?.forecast ?? null,
        thresholds: b.thresholds,
        periodStart: current?.period_start ?? period(deps.now(), b.period).start,
        periodEnd: current?.period_end ?? period(deps.now(), b.period).end,
        enforcement: {
          mode: mode(secret(deps.env, "ENFORCEMENT_MODE")),
          pending:
            pending.find(
              (a) => a.budget_id === b.id && a.period_start === period(deps.now(), b.period).start,
            )?.count ?? 0,
        },
      };
    }),
  };
}
export async function status(deps: Deps) {
  const db = deps.env.DB;
  const names = new Set([
    "DASHBOARD_TOKEN",
    "READ_API_TOKEN",
    "ACCESS_TEAM_DOMAIN",
    "ACCESS_AUD",
    ...Object.values(providerSecrets),
  ]);
  for (const ch of deps.config.channels)
    for (const [key, value] of Object.entries(ch))
      if (key.endsWith("Secret") && typeof value === "string") names.add(value);
  return {
    configValid: true,
    configErrors: [],
    schemaVersion: await db
      .prepare("SELECT MAX(version) v FROM schema_migrations")
      .first<number>("v"),
    version: "0.1.0",
    providers: Object.entries(deps.config.providers).map(([provider, p]) => ({
      provider,
      enabled: p.enabled,
      configured: Boolean(
        secret(deps.env, providerSecrets[provider as keyof typeof providerSecrets]),
      ),
    })),
    jobs: (await db.prepare("SELECT * FROM sync_state ORDER BY job").all()).results,
    lastTick: JSON.parse((await getMeta(db, "last_tick")) ?? "null"),
    secrets: Object.fromEntries([...names].map((n) => [n, Boolean(secret(deps.env, n))])),
    channels: deps.config.channels.map((ch) => ({
      id: ch.id,
      type: ch.type,
      configured: channelConfigured(deps, ch),
    })),
    fx: (await db.prepare("SELECT * FROM fx_rates ORDER BY day DESC LIMIT 20").all()).results,
    enforcementMode: mode(secret(deps.env, "ENFORCEMENT_MODE")),
  };
}
export async function summary(deps: Deps, p: Params) {
  const today = day(deps.now());
  const cacheKey = `summary_cache:${await hash({ currency: p.currency, tax: p.tax })}`;
  const version = (await getMeta(deps.env.DB, "data_version")) ?? "0";
  const cached = JSON.parse((await getMeta(deps.env.DB, cacheKey)) ?? "null") as {
    version: string;
    day: string;
    created: number;
    value: unknown;
  } | null;
  if (cached?.version === version && cached.day === today && Date.now() - cached.created < 60000)
    return cached.value;
  const month = period(deps.now(), "month");
  const week = period(deps.now(), "week");
  const from =
    [month.start.slice(0, 10), week.start.slice(0, 10), day(addDays(deps.now(), -1))].sort()[0] ??
    today;
  const data = await spend(deps, { ...p, from, to: today, groupBy: "provider" });
  const total = (from: string, to = today) =>
    data.rows.filter((r) => r.day >= from && r.day <= to).reduce((n, r) => n + r.amount, 0);
  const mtd = total(month.start.slice(0, 10));
  const states = (
    await deps.env.DB.prepare(
      "SELECT provider,max(last_success_at) lastSuccessAt FROM sync_state WHERE job LIKE ? OR job LIKE ? GROUP BY provider",
    )
      .bind("%.cost_daily", "%.usage_hourly")
      .all<{ provider: string; lastSuccessAt: string | null }>()
  ).results;
  const freshness = Object.entries(deps.config.providers)
    .filter(([, p]) => p.enabled)
    .map(([provider]) => {
      const s = states.find((s) => s.provider === provider);
      return {
        provider,
        lastSuccessAt: s?.lastSuccessAt ?? null,
        lastError: null,
        stale: !s?.lastSuccessAt || deps.now().getTime() - Date.parse(s.lastSuccessAt) > 45 * 60000,
      };
    });
  const byProvider = ["anthropic", "openai", "openrouter"].map((provider) => {
    const rows = data.rows.filter((r) => r.group === provider && r.day >= month.start.slice(0, 10));
    return {
      provider,
      monthToDate: rows.reduce((n, r) => n + r.amount, 0),
      basisMix: {
        billed: rows.reduce((n, r) => n + r.basisMix.billed, 0),
        allocated: rows.reduce((n, r) => n + r.basisMix.allocated, 0),
        estimated: rows.reduce((n, r) => n + r.basisMix.estimated, 0),
      },
    };
  });
  const rates = (await deps.env.DB.prepare("SELECT * FROM fx_rates").all<FxRate>()).results;
  const rate = rateFor(rates, today, data.currency);
  const result = {
    generatedAt: iso(deps.now()),
    currency: data.currency,
    taxIncluded: data.taxIncluded,
    fx: rate ? { ...rate, markupPercent: deps.config.fx.markupPercent } : null,
    totals: {
      today: total(today),
      yesterday: total(day(addDays(deps.now(), -1)), day(addDays(deps.now(), -1))),
      weekToDate: total(week.start.slice(0, 10)),
      monthToDate: mtd,
      monthForecast: month.elapsedHours > 0 ? (mtd / month.elapsedHours) * month.hours : null,
    },
    byProvider,
    budgets: (await budgets(deps)).budgets,
    freshness,
    unpricedTokens: data.rows.reduce((n, r) => n + r.unpricedTokens, 0),
    warnings: [
      ...data.warnings,
      ...freshness.filter((f) => f.stale).map((f) => `${f.provider}: no recent sync`),
    ],
  };
  await setMeta(deps.env.DB, cacheKey, { version, day: today, created: Date.now(), value: result });
  return result;
}
export function csvCell(value: unknown) {
  const text = String(value ?? "");
  const safe = /^[=+\-@\t\r\n]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}
export async function exportCsv(deps: Deps, p: Params) {
  const f = filter(p);
  const rows = (
    await deps.env.DB.prepare(
      `SELECT s.*,COALESCE(w.name,'') workspace_name,COALESCE(k.name,'') api_key_name FROM spend_daily s LEFT JOIN entities w ON w.provider=s.provider AND w.kind='workspace' AND w.id=s.workspace_id LEFT JOIN entities k ON k.provider=s.provider AND k.kind='api_key' AND k.id=s.api_key_id WHERE s.day>=? AND s.day<=?${f.sql} ORDER BY s.day,s.provider`,
    )
      .bind(p.from, p.to, ...f.args)
      .all<Record<string, unknown>>()
  ).results;
  const rates = (await deps.env.DB.prepare("SELECT * FROM fx_rates").all<FxRate>()).results;
  const currency = rows.some((r) => !rateFor(rates, String(r.day), p.currency))
    ? "USD"
    : p.currency;
  const tags = (
    await deps.env.DB.prepare("SELECT * FROM entity_tags").all<{
      provider: string;
      workspace_id: string;
      api_key_id: string;
      dimension: string;
      value: string;
    }>()
  ).results;
  const dimensions = deps.config.tags.map((t) => t.dimension);
  const header = [
    "day",
    "provider",
    "workspace_id",
    "workspace_name",
    "api_key_id",
    "api_key_name",
    "model",
    "basis",
    "amount_usd",
    `amount_${currency.toLowerCase()}`,
    ...dimensions,
  ];
  return [
    header.join(","),
    ...rows.map((r) =>
      [
        ...header.slice(0, 8).map((k) => r[k]),
        Number(r.amount_micros) / 1e6,
        convert(
          Number(r.amount_micros),
          String(r.day),
          currency,
          rates,
          deps.config.fx.markupPercent,
          p.tax === "1" && deps.config.display.tax.enabled
            ? deps.config.display.tax.ratePercent
            : 0,
        ).amount,
        ...dimensions.map(
          (d) =>
            tags.find(
              (t) =>
                t.provider === r.provider &&
                t.workspace_id === r.workspace_id &&
                t.api_key_id === r.api_key_id &&
                t.dimension === d,
            )?.value ?? "",
        ),
      ]
        .map(csvCell)
        .join(","),
    ),
  ].join("\r\n");
}
export function safeConfig(config: Config) {
  return config;
}
