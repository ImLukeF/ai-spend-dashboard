import { providerFetch } from "../http";
import type { JobCtx, ProviderAdapter, PullWindow } from "../types";
import { mapAnalytics, mapEntities } from "./map";
import { analytics, keysPage } from "./schemas";
export async function listKeys(ctx: JobCtx) {
  const rows = [];
  let offset = 0;
  let last = 0;
  for (let page = 0; page < 20; page++) {
    const p = await providerFetch(
      ctx,
      "openrouter",
      `/api/v1/keys?include_disabled=true&offset=${offset}`,
      keysPage,
    );
    if (!p) throw new Error("Empty keys");
    rows.push(...mapEntities(p));
    if (p.data.length === 0 || p.data.length < last) return rows;
    last = p.data.length;
    offset += p.data.length;
  }
  throw new Error("OpenRouter pagination cap; snapshot not applied");
}
async function pull(ctx: JobCtx, w: PullWindow) {
  const keys = await listKeys(ctx);
  let splits = 0;
  async function query(start: string, end: string): Promise<ReturnType<typeof mapAnalytics>> {
    const p = await providerFetch(ctx, "openrouter", "/api/v1/analytics/query", analytics, {
      method: "POST",
      body: JSON.stringify({
        metrics: ["total_usage", "request_count", "tokens_prompt", "tokens_completion"],
        dimensions: ["api_key_id", "model"],
        granularity: "day",
        time_range: { start, end },
        limit: 1000,
      }),
    });
    if (!p) throw new Error("Empty analytics");
    if (p.data.metadata.truncated) {
      if (splits >= 3 || Date.parse(end) - Date.parse(start) <= 86400000)
        throw new Error("OpenRouter analytics still truncated; snapshot not applied");
      splits++;
      const middle = new Date(
        Math.floor((Date.parse(start) + Date.parse(end)) / 2 / 86400000) * 86400000,
      ).toISOString();
      const a = await query(start, middle);
      const b = await query(middle, end);
      return { costs: [...a.costs, ...b.costs], usage: [...a.usage, ...b.usage] };
    }
    return mapAnalytics(p, keys);
  }
  const result = await query(w.start, w.end ?? ctx.deps.now().toISOString());
  ctx.usage = result.usage;
  return result.costs;
}
// UNVERIFIED: page size, analytics retention and data lag; https://openrouter.ai/docs/cookbook/administration/analytics-cost-control.md
export const openrouter: ProviderAdapter = {
  id: "openrouter",
  secretName: "OPENROUTER_MANAGEMENT_KEY",
  pullCostDaily: pull,
  pullEntities: async (c) => ({ rows: await listKeys(c), cursor: null, complete: true }),
};
