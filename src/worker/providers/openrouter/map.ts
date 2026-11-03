import type { z } from "zod";
import { SchemaDriftError, usdToMicros } from "../../../shared/money";
import type { CostRow, EntityRow, UsageRow } from "../types";
import type { analytics, keysPage } from "./schemas";
export function mapEntities(page: z.infer<typeof keysPage>): EntityRow[] {
  return page.data.map((k) => ({
    provider: "openrouter",
    kind: "api_key",
    id: k.hash,
    name: k.name ?? k.label ?? "",
    workspaceId: k.workspace_id ?? "",
    status: k.disabled ? "disabled" : "active",
    createdAt: k.created_at,
    lastUsedAt: k.last_used_at,
    meta: {
      label: k.label ?? "",
      original_name: k.name ?? "",
      expires_at: k.expires_at ?? null,
      updated_at: k.updated_at ?? null,
      byok_usage: k.byok_usage ?? 0,
      byok_usage_daily: k.byok_usage_daily ?? 0,
      byok_usage_weekly: k.byok_usage_weekly ?? 0,
      byok_usage_monthly: k.byok_usage_monthly ?? 0,
      limit: k.limit ?? null,
      limit_remaining: k.limit_remaining ?? null,
      limit_reset: k.limit_reset ?? null,
      include_byok_in_limit: k.include_byok_in_limit ?? false,
      usage: k.usage ?? 0,
      usage_daily: k.usage_daily ?? 0,
      usage_weekly: k.usage_weekly ?? 0,
      usage_monthly: k.usage_monthly ?? 0,
    },
  }));
}
export function resolveName(value: string, keys: EntityRow[]) {
  const byName = keys.filter((k) => (k.meta?.original_name ?? k.name) === value);
  const matches = byName.length ? byName : keys.filter((k) => k.meta?.label === value);
  return matches.length === 1 ? matches[0] : undefined;
}
export function mapAnalytics(page: z.infer<typeof analytics>, keys: EntityRow[]) {
  const costs: CostRow[] = [];
  const usage: UsageRow[] = [];
  for (const r of page.data.data) {
    const d = (r.date__day ?? r.created_at__day ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(Date.parse(d)))
      throw new SchemaDriftError("analytics/query", "date__day or created_at__day");
    const key = resolveName(r.api_key_id ?? "", keys);
    const dims = {
      provider: "openrouter" as const,
      workspaceId: key?.workspaceId ?? "",
      apiKeyId: key?.id ?? `name:${r.api_key_id ?? ""}`,
      model: r.model ?? "",
      serviceTier: "",
    };
    costs.push({
      ...dims,
      day: d,
      metric: "total",
      lineItem: "",
      quantity: null,
      amountMicros: usdToMicros(r.total_usage),
    });
    for (const [metric, quantity] of [
      ["input_uncached", r.tokens_prompt],
      ["output", r.tokens_completion],
      ["requests", r.request_count],
    ] as const) {
      if (!Number.isSafeInteger(quantity) || quantity < 0)
        throw new SchemaDriftError("analytics/query", "count");
      if (quantity) usage.push({ ...dims, bucket: d, metric, quantity });
    }
  }
  return { costs, usage };
}
