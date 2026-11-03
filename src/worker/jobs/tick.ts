// UNVERIFIED: Free CPU suitability; bounded work and resumable cursors cannot guarantee 10ms CPU. https://developers.cloudflare.com/workers/platform/limits/
import type { ProviderId } from "../../shared/config-schema";
import { SchemaDriftError } from "../../shared/money";
import { addDays, day, iso } from "../../shared/periods";
import { dispatchAlerts } from "../alerts/dispatch";
import { emit } from "../alerts/events";
import { evaluateBudgets } from "../budgets/evaluate";
import { ensureSchema } from "../db/migrate";
import { upsertEntities } from "../db/repo/entities";
import { type Fact, replaceWindow } from "../db/repo/facts";
import { getMeta, setMeta } from "../db/repo/state";
import type { Deps } from "../deps";
import { executeEnforcement, recoverPlanned, restoreEnforcement } from "../enforcement/execute";
import { secret } from "../env";
import { pullFx } from "../fx/frankfurter";
import { redact } from "../lib/redact";
import { PROVIDERS } from "../providers/registry";
import type { CostRow, JobCtx, UsageRow } from "../providers/types";
import { materialise } from "../tags/materialise";
import { BudgetCounter, BudgetExceeded, countedDb } from "./budget";
import { deriveDay, learnRates } from "./derive";
import { jobsFor } from "./registry";
import { retention } from "./retention";

interface SyncState {
  job: string;
  provider: string;
  next_due_at: string | null;
  cursor: string | null;
  consecutive_failures: number;
  last_success_at: string | null;
}
const usageFacts = (rows: UsageRow[], hourly: boolean): Fact[] =>
  rows.map((r) => ({
    provider: r.provider,
    [hourly ? "hour" : "day"]: r.bucket,
    workspace_id: r.workspaceId,
    api_key_id: r.apiKeyId,
    model: r.model,
    service_tier: r.serviceTier,
    metric: r.metric,
    quantity: r.quantity,
  }));
const costFacts = (rows: CostRow[]): Fact[] =>
  rows.map((r) => ({
    provider: r.provider,
    day: r.day,
    workspace_id: r.workspaceId,
    api_key_id: r.apiKeyId,
    model: r.model,
    service_tier: r.serviceTier,
    metric: r.metric,
    line_item: r.lineItem,
    amount_micros: r.amountMicros,
    quantity: r.quantity,
  }));
export async function tick(input: Deps) {
  await ensureSchema(input.env.DB);
  const raw = input.env.DB;
  const now = input.now();
  const owner = input.randomId();
  const started = Date.now();
  const lock = await raw
    .prepare(
      "INSERT INTO meta(k,v) VALUES('tick_lock',?1) ON CONFLICT(k) DO UPDATE SET v=excluded.v WHERE json_extract(meta.v,'$.until')<?2",
    )
    .bind(JSON.stringify({ owner, until: iso(new Date(now.getTime() + 600000)) }), iso(now))
    .run();
  if (!lock.meta.changes) return { locked: true };
  const budget = new BudgetCounter(input.config.runtime.plan);
  const deps = { ...input, env: { ...input.env, DB: countedDb(raw, budget) } };
  const skipped: string[] = [];
  let changed = 0;
  const dirty = new Set<string>(JSON.parse((await getMeta(deps.env.DB, "dirty_days")) ?? "[]"));
  const errors: string[] = [];
  try {
    await setMeta(
      deps.env.DB,
      "first_run_at",
      (await getMeta(deps.env.DB, "first_run_at")) ?? iso(now),
    );
    const states = (await deps.env.DB.prepare("SELECT * FROM sync_state").all<SyncState>()).results;
    const jobs = PROVIDERS.filter(
      (p) => deps.config.providers[p.id].enabled && secret(deps.env, p.secretName),
    )
      .flatMap(jobsFor)
      .filter((j) => {
        const s = states.find((s) => s.job === j.id);
        return (
          (!s?.next_due_at || s.next_due_at <= iso(now)) &&
          !(j.kind === "backfill" && s?.cursor === "done")
        );
      })
      .sort(
        (a, b) =>
          Number(a.kind === "backfill") - Number(b.kind === "backfill") ||
          String(states.find((s) => s.job === a.id)?.next_due_at ?? "").localeCompare(
            String(states.find((s) => s.job === b.id)?.next_due_at ?? ""),
          ),
      );
    for (const job of jobs) {
      const tail = deps.config.budgets.length ? 18 : 10;
      if (!budget.fits(job.kind === "entities" ? 12 : job.kind === "backfill" ? 4 : 2, tail + 5)) {
        skipped.push(job.id);
        continue;
      }
      const previous = states.find((s) => s.job === job.id);
      const ctx: JobCtx = { deps, budget, secret: secret(deps.env, job.adapter.secretName) };
      let rows = 0;
      let cursor = previous?.cursor ?? null;
      let complete = true;
      const at = Date.now();
      try {
        if (job.kind === "entities") {
          const result = await job.adapter.pullEntities(ctx, cursor);
          await upsertEntities(deps, result.rows);
          rows = result.rows.length;
          cursor = result.cursor;
          complete = result.complete;
        } else {
          let start = iso(addDays(new Date(`${day(now)}T00:00:00Z`), -2));
          let end = iso(now);
          if (job.kind === "usage_hourly") {
            const d = new Date(now.getTime() - 47 * 3600000);
            d.setUTCMinutes(0, 0, 0);
            start = iso(d);
          }
          if (job.kind === "cost_daily" && now.getUTCDate() <= 8) {
            const d = new Date(`${day(now)}T00:00:00Z`);
            d.setUTCDate(1);
            d.setUTCMonth(d.getUTCMonth() - 1);
            start = iso(d);
          }
          if (job.kind === "backfill") {
            const oldest = day(addDays(now, -deps.config.sync.backfillDays));
            end = cursor && cursor !== "done" ? cursor : iso(new Date(`${day(now)}T00:00:00Z`));
            start = iso(addDays(new Date(end), -(job.adapter.id === "openrouter" ? 30 : 31)));
            if (start.slice(0, 10) < oldest) start = `${oldest}T00:00:00Z`;
            cursor = start.slice(0, 10) <= oldest ? "done" : start;
          }
          const window = { start, end };
          const pullUsage =
            job.kind === "usage_hourly" ? job.adapter.pullUsageHourly : job.adapter.pullUsageDaily;
          let usage: UsageRow[] = [];
          let costs: CostRow[] = [];
          if (job.kind.startsWith("usage") && pullUsage) usage = await pullUsage(ctx, window);
          if (job.kind === "cost_daily" || job.kind === "backfill")
            costs = await job.adapter.pullCostDaily(ctx, window);
          if (job.kind === "backfill" && job.adapter.pullUsageDaily)
            usage = await job.adapter.pullUsageDaily(ctx, window);
          if (ctx.usage) usage = ctx.usage;
          // Never accept rows outside the declared window: protects existing data against provider drift.
          for (const r of [...usage, ...costs]) {
            const d = "bucket" in r ? r.bucket : r.day;
            if (
              d < start.slice(0, d.length) ||
              d >=
                end.slice(0, d.length) + (d.length === 10 && !end.endsWith("T00:00:00Z") ? "~" : "")
            )
              throw new SchemaDriftError(job.id, "row outside requested window");
          }
          const hourly = job.kind === "usage_hourly";
          const startFact = hourly ? start : start.slice(0, 10);
          const endFact = hourly
            ? end
            : end.endsWith("T00:00:00Z")
              ? end.slice(0, 10)
              : `${end.slice(0, 10)}~`;
          const candidateDays = new Set<string>();
          let jobChanged = 0;
          if (!hourly) {
            const old = await deps.env.DB.prepare(
              "SELECT day FROM usage_daily WHERE provider=? AND day>=? AND day<? UNION SELECT day FROM cost_daily WHERE provider=? AND day>=? AND day<?",
            )
              .bind(job.adapter.id, startFact, endFact, job.adapter.id, startFact, endFact)
              .all<{ day: string }>();
            for (const d of old.results) candidateDays.add(`${job.adapter.id}:${d.day}`);
          }
          const writeUsage =
            job.kind.startsWith("usage") ||
            job.kind === "backfill" ||
            job.adapter.id === "openrouter";
          if (writeUsage)
            jobChanged += await replaceWindow(
              deps.env.DB,
              hourly ? "usage_hourly" : "usage_daily",
              job.adapter.id,
              startFact,
              endFact,
              usageFacts(usage, hourly),
              now,
            );
          if (job.kind === "cost_daily" || job.kind === "backfill")
            jobChanged += await replaceWindow(
              deps.env.DB,
              "cost_daily",
              job.adapter.id,
              startFact,
              endFact,
              costFacts(costs),
              now,
            );
          changed += jobChanged;
          if (!hourly && jobChanged) {
            for (const r of [...usage, ...costs])
              candidateDays.add(`${job.adapter.id}:${"bucket" in r ? r.bucket : r.day}`);
            for (const d of candidateDays) dirty.add(d);
          }
          rows = usage.length + costs.length;
        }
        await deps.env.DB.prepare(
          "INSERT INTO sync_state(job,provider,last_attempt_at,last_success_at,next_due_at,last_rows,cursor) VALUES(?,?,?,?,?,?,?) ON CONFLICT(job) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,last_success_at=excluded.last_success_at,next_due_at=excluded.next_due_at,consecutive_failures=0,last_error=NULL,last_rows=excluded.last_rows,cursor=excluded.cursor",
        )
          .bind(
            job.id,
            job.adapter.id,
            iso(now),
            iso(now),
            iso(new Date(now.getTime() + (complete ? job.minutes : 15) * 60000)),
            rows,
            cursor,
          )
          .run();
        if ((previous?.consecutive_failures ?? 0) >= 3)
          await emit(deps, {
            type: "sync.recovered",
            severity: "info",
            dedupeKey: `sync:${job.adapter.id}:${day(now)}:recovered`,
            data: { provider: job.adapter.id },
            channels: deps.config.channels
              .filter((c) => c.receives.includes("sync"))
              .map((c) => c.id),
          });
        deps.log({ job: job.id, rows, ms: Date.now() - at });
      } catch (e) {
        if (e instanceof BudgetExceeded) {
          skipped.push(job.id);
          continue;
        }
        const failures = (previous?.consecutive_failures ?? 0) + 1;
        errors.push(job.id);
        await deps.env.DB.prepare(
          "INSERT INTO sync_state(job,provider,last_attempt_at,next_due_at,consecutive_failures,last_error) VALUES(?,?,?,?,?,?) ON CONFLICT(job) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,next_due_at=excluded.next_due_at,consecutive_failures=excluded.consecutive_failures,last_error=excluded.last_error",
        )
          .bind(
            job.id,
            job.adapter.id,
            iso(now),
            iso(new Date(now.getTime() + Math.min(job.minutes * 2 ** failures, 360) * 60000)),
            failures,
            redact(e),
          )
          .run();
        if (failures >= 3)
          await emit(deps, {
            type: "sync.failing",
            severity: "critical",
            dedupeKey: `sync:${job.adapter.id}:${day(now)}:failing`,
            data: { provider: job.adapter.id, error: redact(e) },
            channels: deps.config.channels
              .filter((c) => c.receives.includes("sync"))
              .map((c) => c.id),
          });
      }
    }
    if (dirty.size && budget.fits(0, 10)) {
      await learnRates(deps);
      for (const item of [...dirty]) {
        if (!budget.fits(0, 10)) {
          skipped.push("derive");
          break;
        }
        const i = item.indexOf(":");
        changed += await deriveDay(deps, item.slice(0, i) as ProviderId, item.slice(i + 1));
        dirty.delete(item);
      }
    }
    if (budget.fits(0, 8)) changed += await materialise(deps);
    else skipped.push("tags");
    const fxDue = await getMeta(deps.env.DB, "fx_due");
    if ((!fxDue || fxDue < iso(now)) && budget.fits(1, 4)) {
      try {
        const earliest = await deps.env.DB.prepare(
          "SELECT MIN(day) day FROM spend_daily",
        ).first<string>("day");
        const start =
          earliest && earliest < day(addDays(now, -180))
            ? day(addDays(now, -180))
            : (earliest ?? day(addDays(now, -7)));
        const rates = await pullFx({ deps, budget, secret: "" }, start, day(now));
        if (rates.length)
          await deps.env.DB.prepare(
            `INSERT INTO fx_rates(day,quote,rate,source,fetched_at) SELECT json_extract(value,'$.day'),json_extract(value,'$.quote'),json_extract(value,'$.rate'),json_extract(value,'$.source'),?2 FROM json_each(?1) WHERE true ON CONFLICT(day,quote) DO UPDATE SET rate=excluded.rate,source=excluded.source,fetched_at=excluded.fetched_at WHERE fx_rates.rate IS NOT excluded.rate`,
          )
            .bind(JSON.stringify(rates), iso(now))
            .run();
        await setMeta(deps.env.DB, "fx_due", iso(new Date(now.getTime() + 6 * 3600000)));
      } catch (e) {
        errors.push(`fx: ${redact(e)}`);
      }
    }
    if (deps.config.budgets.length && budget.fits(0, 12)) {
      const evaluated = await evaluateBudgets(deps);
      await recoverPlanned(deps, budget);
      if (!dirty.size) await executeEnforcement(deps, budget, evaluated);
      else skipped.push("enforcement:derived_data_pending");
      await restoreEnforcement(deps, budget);
    }
    if (deps.config.channels.length && budget.fits(1, 3)) await dispatchAlerts(deps, budget);
    const retained = await getMeta(deps.env.DB, "retention_due");
    if ((!retained || retained < iso(now)) && budget.fits(0, 1)) {
      await retention(deps);
      await setMeta(deps.env.DB, "retention_due", iso(addDays(now, 1)));
    }
  } catch (e) {
    if (e instanceof BudgetExceeded) skipped.push("tick:budget");
    else {
      errors.push(redact(e));
      deps.log({ error: redact(e) });
    }
  } finally {
    await setMeta(raw, "dirty_days", [...dirty]);
    if (changed)
      await raw
        .prepare(
          "INSERT INTO meta(k,v) VALUES('data_version','1') ON CONFLICT(k) DO UPDATE SET v=CAST(CAST(v AS INTEGER)+1 AS TEXT)",
        )
        .run();
    const summary = {
      at: iso(now),
      changed,
      subrequests: budget.requests,
      d1Queries: budget.queries,
      ms: Date.now() - started,
      skipped,
      errors,
    };
    await setMeta(raw, "last_tick", summary);
    await raw
      .prepare("UPDATE meta SET v=? WHERE k='tick_lock' AND json_extract(v,'$.owner')=?")
      .bind(JSON.stringify({ owner, until: iso(new Date(now.getTime() - 1000)) }), owner)
      .run();
  }
  return { changed, skipped, errors, subrequests: budget.requests, d1Queries: budget.queries };
}
