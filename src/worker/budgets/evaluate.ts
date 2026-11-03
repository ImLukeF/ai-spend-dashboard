import type { Budget } from "../../shared/config-schema";
import { iso, period } from "../../shared/periods";
import { emit } from "../alerts/events";
import type { Deps } from "../deps";
import { convert, type FxRate } from "../fx/convert";
import { hash } from "../lib/hash";
import { forecast, forecastTriggered } from "./forecast";
export interface SpendDay {
  day: string;
  amount_micros: number;
  basis: string;
}
export function evaluate(
  budget: Budget,
  rows: SpendDay[],
  rates: FxRate[],
  now: Date,
  markup: number,
  tax: number,
) {
  const p = period(now, budget.period);
  let spent = 0;
  let micros = 0;
  const basis = { billed: 0, allocated: 0, estimated: 0 };
  let missing = false;
  for (const row of rows) {
    const value = convert(
      row.amount_micros,
      row.day,
      budget.currency,
      rates,
      markup,
      budget.includeTax ? tax : 0,
    );
    spent += value.amount;
    micros += row.amount_micros;
    missing ||= value.missing;
    basis[row.basis as keyof typeof basis] += row.amount_micros;
  }
  const percent = (spent / budget.amount) * 100;
  const projected = forecast(spent, p.elapsedHours, p.hours, budget.period);
  return {
    ...p,
    spent,
    spentUsdMicros: micros,
    limit: budget.amount,
    currency: missing ? "USD" : budget.currency,
    taxIncluded: budget.includeTax,
    percent,
    forecast: projected,
    status:
      percent >= 100 ? "exceeded" : percent >= (budget.thresholds[0] ?? 100) ? "warning" : "ok",
    basisMix: basis,
    warnings: missing ? ["Missing FX; enforcement blocked"] : [],
    canEnforce: !missing,
    thresholdsHit: budget.thresholds.filter((t) => t <= percent),
    forecastTriggered:
      budget.forecast && forecastTriggered(projected, budget.amount, p.elapsedHours, p.hours),
  };
}
export function scopeSql(budget: Budget, alias = "s") {
  const clauses: string[] = [];
  const params: unknown[] = [];
  for (const [field, values] of [
    ["provider", budget.scope.providers],
    ["workspace_id", budget.scope.workspaceIds],
    ["api_key_id", budget.scope.apiKeyIds],
  ] as const) {
    if (values.length) {
      clauses.push(`${alias}.${field} IN (SELECT value FROM json_each(?))`);
      params.push(JSON.stringify(values));
    }
  }
  if (budget.scope.models.length) {
    clauses.push(
      `EXISTS (SELECT 1 FROM json_each(?) WHERE lower(${alias}.model) GLOB lower(value))`,
    );
    params.push(JSON.stringify(budget.scope.models));
  }
  for (const [dim, values] of Object.entries(budget.scope.tags)) {
    clauses.push(
      `EXISTS (SELECT 1 FROM entity_tags t WHERE t.provider=${alias}.provider AND t.workspace_id=${alias}.workspace_id AND t.api_key_id=${alias}.api_key_id AND t.dimension=? AND t.value IN (SELECT value FROM json_each(?)))`,
    );
    params.push(dim, JSON.stringify(values));
  }
  return { sql: clauses.length ? ` AND ${clauses.join(" AND ")}` : "", params };
}
export async function evaluateBudgets(deps: Deps) {
  const db = deps.env.DB;
  const rates = (await db.prepare("SELECT * FROM fx_rates").all<FxRate>()).results;
  const results = [];
  for (const budget of deps.config.budgets) {
    const definitionHash = await hash(budget);
    const current = period(deps.now(), budget.period);
    const prevNow = new Date(Date.parse(current.start) - 1);
    const previous = period(prevNow, budget.period);
    for (const at of [prevNow, deps.now()]) {
      const p = period(at, budget.period);
      const closed = p.start === previous.start;
      const existing = closed
        ? await db
            .prepare("SELECT period_start FROM budget_periods WHERE budget_id=? AND period_start=?")
            .bind(budget.id, p.start)
            .first()
        : null;
      // Evaluate just-ended once after rollover; late data can still update current periods.
      if (closed && existing) continue;
      const filter = scopeSql(budget);
      const rows = await db
        .prepare(
          `SELECT day,basis,SUM(amount_micros) amount_micros FROM spend_daily s WHERE day>=? AND day<?${filter.sql} GROUP BY day,basis`,
        )
        .bind(p.start.slice(0, 10), p.end.slice(0, 10), ...filter.params)
        .all<SpendDay>();
      const result = evaluate(
        budget,
        rows.results,
        rates,
        at,
        deps.config.fx.markupPercent,
        deps.config.display.tax.ratePercent,
      );
      await db
        .prepare(
          `INSERT INTO budget_periods(budget_id,period_start,period_end,definition_hash,spent_usd_micros,spent,limit_amount,currency,tax_included,percent,forecast,status,basis_mix,evaluated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(budget_id,period_start) DO UPDATE SET definition_hash=excluded.definition_hash,spent_usd_micros=excluded.spent_usd_micros,spent=excluded.spent,limit_amount=excluded.limit_amount,currency=excluded.currency,tax_included=excluded.tax_included,percent=excluded.percent,forecast=excluded.forecast,status=excluded.status,basis_mix=excluded.basis_mix,evaluated_at=excluded.evaluated_at`,
        )
        .bind(
          budget.id,
          p.start,
          p.end,
          definitionHash,
          result.spentUsdMicros,
          result.spent,
          budget.amount,
          result.currency,
          Number(budget.includeTax),
          result.percent,
          result.forecast,
          result.status,
          JSON.stringify(result.basisMix),
          iso(deps.now()),
        )
        .run();
      const data = {
        budget: {
          id: budget.id,
          name: budget.name,
          period: budget.period,
          periodStart: p.start,
          periodEnd: p.end,
        },
        ...result,
        basis: result.basisMix,
        dataAsOf: iso(deps.now()),
        dashboardUrl: deps.config.publicUrl || null,
      };
      for (const threshold of result.thresholdsHit)
        await emit(deps, {
          type: "budget.threshold",
          severity: threshold >= 100 ? "critical" : "warning",
          dedupeKey: `budget:${budget.id}:${p.start}:t${threshold}:${definitionHash.slice(0, 8)}`,
          budgetId: budget.id,
          periodStart: p.start,
          data: { ...data, threshold },
          channels: budget.channels,
        });
      if (result.forecastTriggered)
        await emit(deps, {
          type: "budget.forecast",
          severity: "warning",
          dedupeKey: `budget:${budget.id}:${p.start}:forecast:${definitionHash.slice(0, 8)}`,
          budgetId: budget.id,
          periodStart: p.start,
          data,
          channels: budget.channels,
        });
      if (closed) {
        await emit(deps, {
          type: "budget.period_closed",
          severity: "info",
          dedupeKey: `budget:${budget.id}:${p.start}:closed`,
          budgetId: budget.id,
          periodStart: p.start,
          data,
          channels: budget.notifyOnClose ? budget.channels : [],
        });
      } else results.push({ budget, result });
    }
  }
  return results;
}
