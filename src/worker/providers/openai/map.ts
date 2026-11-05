import type { z } from "zod";
import { usdToMicros } from "../../../shared/money";
import { iso } from "../../../shared/periods";
import type { CostRow, EntityRow, Metric, UsageRow } from "../types";
import type { costPage, entityPage, usagePage } from "./schemas";
export function mapUsage(page: z.infer<typeof usagePage>, hourly: boolean): UsageRow[] {
  return page.data.flatMap((b) =>
    b.results.flatMap((r) => {
      const fields: Partial<Record<Metric, number>> = {
        input_uncached:
          r.input_uncached_tokens ??
          Math.max(0, r.input_tokens - r.input_cached_tokens - r.input_cache_write_tokens),
        input_cache_read: r.input_cached_tokens,
        input_cache_write: r.input_cache_write_tokens,
        output: r.output_tokens,
        requests: r.num_model_requests,
      };
      return Object.entries(fields)
        .filter(([, q]) => q !== 0)
        .map(([metric, quantity]) => ({
          provider: "openai",
          bucket: hourly
            ? iso(new Date(b.start_time * 1000))
            : iso(new Date(b.start_time * 1000)).slice(0, 10),
          workspaceId: r.project_id ?? "",
          apiKeyId: r.api_key_id ?? "",
          model: r.model ?? "",
          serviceTier: r.service_tier ?? "",
          metric: metric as Metric,
          quantity,
        }));
    }),
  );
}
export function mapCost(page: z.infer<typeof costPage>): CostRow[] {
  return page.data.flatMap((b) =>
    b.results.map((r) => {
      const match = /^(?<model>.+?),\s*(?<kind>[\w .-]+)$/.exec(r.line_item ?? "");
      const kind = match?.groups?.kind ?? "";
      // UNVERIFIED: dollars and line-item suffix semantics; https://developers.openai.com/api/docs/guides/admin-apis
      const metric: Metric = kind.includes("output")
        ? "output"
        : kind.includes("cache_write")
          ? "input_cache_write"
          : kind.includes("cached")
            ? "input_cache_read"
            : kind.includes("input")
              ? "input_uncached"
              : "other";
      return {
        provider: "openai",
        day: iso(new Date(b.start_time * 1000)).slice(0, 10),
        workspaceId: r.project_id ?? "",
        apiKeyId: r.api_key_id ?? "",
        model: match?.groups?.model ?? "",
        serviceTier: "",
        metric,
        lineItem: (r.line_item ?? "").slice(0, 200),
        amountMicros: usdToMicros(r.amount.value),
        quantity:
          r.quantity != null && ["tokens", "1000_tokens"].includes(r.quantity_unit ?? "")
            ? r.quantity * (r.quantity_unit === "1000_tokens" ? 1000 : 1)
            : null,
      };
    }),
  );
}
export function mapEntities(
  page: z.infer<typeof entityPage>,
  kind: "api_key" | "workspace",
  project = "",
): EntityRow[] {
  return page.data.map((r) => ({
    provider: "openai",
    kind,
    id: r.id,
    name: r.name,
    workspaceId: project,
    status: r.status ?? "active",
    createdAt: r.created_at ? iso(new Date(r.created_at * 1000)) : null,
    lastUsedAt: r.last_used_at ? iso(new Date(r.last_used_at * 1000)) : null,
    meta: {},
  }));
}
