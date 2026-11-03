import type { ProviderId } from "../../shared/config-schema";
import { iso } from "../../shared/periods";
import { type Fact, replaceWindow } from "../db/repo/facts";
import type { Deps } from "../deps";
import { allocate, tierClass } from "./allocate";
import { estimate, type Rate } from "./estimate";

interface Usage {
  workspace_id: string;
  api_key_id: string;
  model: string;
  service_tier: string;
  metric: string;
  quantity: number;
}
interface Cost extends Usage {
  amount_micros: number;
}
export async function deriveDay(deps: Deps, provider: ProviderId, day: string) {
  const db = deps.env.DB;
  const [costs, usage, rates] = await Promise.all([
    db
      .prepare("SELECT * FROM cost_daily WHERE provider=? AND day=?")
      .bind(provider, day)
      .all<Cost>(),
    db
      .prepare("SELECT * FROM usage_daily WHERE provider=? AND day=?")
      .bind(provider, day)
      .all<Usage>(),
    db.prepare("SELECT * FROM effective_rates WHERE provider=?").bind(provider).all<Rate>(),
  ]);
  const rows: Fact[] = [];
  const push = (c: Usage, apiKey: string, basis: string, amount: number, unpriced = 0) =>
    rows.push({
      provider,
      day,
      workspace_id: c.workspace_id,
      api_key_id: apiKey,
      model: c.model,
      basis,
      amount_micros: amount,
      unpriced_tokens: unpriced,
    });
  for (const c of costs.results) {
    if (provider !== "anthropic") {
      push(c, c.api_key_id, "billed", c.amount_micros);
      continue;
    }
    const matched = ["code_execution", "session_usage", "other"].includes(c.metric)
      ? []
      : usage.results.filter(
          (u) =>
            u.workspace_id === c.workspace_id &&
            u.model === c.model &&
            u.metric === c.metric &&
            tierClass(u.service_tier) === tierClass(c.service_tier) &&
            tierClass(u.service_tier) !== "priority",
        );
    for (const part of allocate(
      c.amount_micros,
      matched.map((u) => ({ id: u.api_key_id, quantity: u.quantity })),
    ))
      push(c, part.id, part.id ? "allocated" : "billed", part.amountMicros);
  }
  for (const u of usage.results) {
    if (
      costs.results.length &&
      !(provider === "anthropic" && tierClass(u.service_tier) === "priority")
    )
      continue;
    const e = estimate(provider, u.model, u.metric, u.quantity, deps.config, rates.results);
    if (e.amountMicros || e.unpricedTokens)
      push(u, u.api_key_id, "estimated", e.amountMicros, e.unpricedTokens);
  }
  return replaceWindow(db, "spend_daily", provider, day, `${day}~`, rows, deps.now());
}
export async function learnRates(deps: Deps) {
  const end = iso(deps.now()).slice(0, 10);
  const start = iso(new Date(deps.now().getTime() - 14 * 86400000)).slice(0, 10);
  const sql = `WITH usage AS (SELECT provider,day,workspace_id,model,metric,CASE WHEN service_tier='batch' THEN 'batch' ELSE 'standard' END tier,SUM(quantity) quantity FROM usage_daily WHERE provider='anthropic' AND service_tier NOT LIKE 'priority%' AND day>=?1 AND day<?2 GROUP BY provider,day,workspace_id,model,metric,tier), costs AS (SELECT provider,day,workspace_id,model,metric,CASE WHEN service_tier='batch' THEN 'batch' ELSE 'standard' END tier,SUM(amount_micros) amount FROM cost_daily WHERE provider='anthropic' AND day>=?1 AND day<?2 GROUP BY provider,day,workspace_id,model,metric,tier), samples AS (SELECT c.provider,c.model,c.metric,c.amount amount_micros,u.quantity FROM costs c JOIN usage u USING(provider,day,workspace_id,model,metric,tier) UNION ALL SELECT provider,model,metric,amount_micros,quantity FROM cost_daily WHERE provider='openai' AND quantity>0 AND day>=?1 AND day<?2) INSERT INTO effective_rates(provider,model,metric,micros_per_million,sample_quantity,window_start,window_end,updated_at) SELECT provider,model,metric,CAST(ROUND(SUM(amount_micros)*1000000.0/SUM(quantity)) AS INTEGER),SUM(quantity),?1,?2,?3 FROM samples WHERE quantity>0 GROUP BY provider,model,metric HAVING SUM(amount_micros)>=0 ON CONFLICT(provider,model,metric) DO UPDATE SET micros_per_million=excluded.micros_per_million,sample_quantity=excluded.sample_quantity,window_start=excluded.window_start,window_end=excluded.window_end,updated_at=excluded.updated_at WHERE effective_rates.micros_per_million IS NOT excluded.micros_per_million OR effective_rates.sample_quantity IS NOT excluded.sample_quantity OR effective_rates.window_start IS NOT excluded.window_start`;
  await deps.env.DB.prepare(sql).bind(start, end, iso(deps.now())).run();
}
