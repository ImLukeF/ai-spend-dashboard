import type { z } from "zod";
import { centsDecimalStringToMicros } from "../../../shared/money";
import type { CostRow, EntityRow, Metric, UsageRow } from "../types";
import type { costPage, entityPage, usagePage } from "./schemas";
export function mapUsage(page: z.infer<typeof usagePage>, hourly: boolean): UsageRow[] {
  return page.data.flatMap((b) =>
    b.results.flatMap((r) => {
      const fields: Partial<Record<Metric, number>> = {
        input_uncached: r.uncached_input_tokens,
        input_cache_read: r.cache_read_input_tokens,
        input_cache_write_5m: r.cache_creation?.ephemeral_5m_input_tokens ?? 0,
        input_cache_write_1h: r.cache_creation?.ephemeral_1h_input_tokens ?? 0,
        output: r.output_tokens,
        web_search_requests: r.server_tool_use?.web_search_requests ?? 0,
      };
      return Object.entries(fields)
        .filter(([, q]) => q !== 0)
        .map(([metric, quantity]) => ({
          provider: "anthropic",
          bucket: hourly ? b.starting_at : b.starting_at.slice(0, 10),
          workspaceId: r.workspace_id ?? "",
          apiKeyId: r.api_key_id ?? "",
          model: r.model ?? "",
          serviceTier: r.service_tier ?? "",
          metric: metric as Metric,
          quantity,
        }));
    }),
  );
}
const tokenMetrics: Record<string, Metric> = {
  uncached_input_tokens: "input_uncached",
  cache_read_input_tokens: "input_cache_read",
  "cache_creation.ephemeral_5m_input_tokens": "input_cache_write_5m",
  "cache_creation.ephemeral_1h_input_tokens": "input_cache_write_1h",
  output_tokens: "output",
  web_search: "web_search_requests",
  code_execution: "code_execution",
  session_usage: "session_usage",
};
export function mapCost(page: z.infer<typeof costPage>): CostRow[] {
  return page.data.flatMap((b) =>
    b.results.map((r) => ({
      provider: "anthropic",
      day: b.starting_at.slice(0, 10),
      workspaceId: r.workspace_id ?? "",
      apiKeyId: "",
      model: r.model ?? "",
      serviceTier: r.service_tier ?? "",
      metric: tokenMetrics[r.token_type ?? r.cost_type ?? ""] ?? "other",
      lineItem: (r.description ?? "").slice(0, 200),
      amountMicros: centsDecimalStringToMicros(r.amount),
      quantity: null,
    })),
  );
}
export function mapEntities(
  page: z.infer<typeof entityPage>,
  kind: "api_key" | "workspace",
): EntityRow[] {
  return page.data.map((r) => ({
    provider: "anthropic",
    kind,
    id: r.id,
    name: r.name,
    workspaceId: r.scope?.workspace_id ?? r.workspace_id ?? "",
    status: r.status ?? (r.archived_at ? "archived" : "active"),
    createdAt: r.created_at,
    meta: {},
  }));
}
