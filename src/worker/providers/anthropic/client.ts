import { SchemaDriftError } from "../../../shared/money";
import { providerFetch } from "../http";
import type { JobCtx, ProviderAdapter, PullWindow } from "../types";
import { mapCost, mapEntities, mapUsage } from "./map";
import { costPage, entityPage, usagePage } from "./schemas";
export async function listEntities(ctx: JobCtx, kind: "api_key" | "workspace", extra = "") {
  const rows = [];
  let after = "";
  for (let i = 0; i < 10; i++) {
    const path = `/v1/organizations/${kind === "api_key" ? "api_keys" : "workspaces"}?limit=1000${kind === "workspace" ? "&include_archived=true" : ""}${extra}${after ? `&after_id=${encodeURIComponent(after)}` : ""}`;
    const page = await providerFetch(ctx, "anthropic", path, entityPage);
    if (!page) throw new Error("Empty page");
    rows.push(...mapEntities(page, kind));
    if (!page.has_more) return rows;
    if (!page.last_id || page.last_id === after) throw new SchemaDriftError(path, "last_id");
    after = page.last_id;
  }
  throw new Error("Anthropic entities pagination cap; snapshot not applied");
}
async function pull(ctx: JobCtx, w: PullWindow, kind: "hour" | "day" | "cost") {
  const params = new URLSearchParams({
    starting_at: w.start,
    bucket_width: kind === "hour" ? "1h" : "1d",
    limit: kind === "hour" ? "168" : "31",
  });
  if (w.end) params.set("ending_at", w.end);
  for (const g of kind === "cost"
    ? ["workspace_id", "description"]
    : ["api_key_id", "workspace_id", "model", "service_tier"])
    params.append("group_by[]", g);
  const usage = [];
  const costs = [];
  let cursor = "";
  for (let i = 0; i < 10; i++) {
    if (cursor) params.set("page", cursor);
    const path = `/v1/organizations/${kind === "cost" ? "cost_report" : "usage_report/messages"}?${params}`;
    const page =
      kind === "cost"
        ? await providerFetch(ctx, "anthropic", path, costPage)
        : await providerFetch(ctx, "anthropic", path, usagePage);
    if (!page) throw new Error("Empty page");
    if (kind === "cost") costs.push(...mapCost(costPage.parse(page)));
    else usage.push(...mapUsage(usagePage.parse(page), kind === "hour"));
    if (!page.has_more) return { usage, costs };
    if (!page.next_page || page.next_page === cursor) throw new SchemaDriftError(path, "next_page");
    cursor = page.next_page;
  }
  throw new Error("Anthropic pagination cap; snapshot not applied");
}
export const anthropic: ProviderAdapter = {
  id: "anthropic",
  secretName: "ANTHROPIC_ADMIN_KEY",
  pullUsageHourly: async (c, w) => (await pull(c, w, "hour")).usage,
  pullUsageDaily: async (c, w) => (await pull(c, w, "day")).usage,
  pullCostDaily: async (c, w) => (await pull(c, w, "cost")).costs,
  pullEntities: async (c) => ({
    rows: [...(await listEntities(c, "workspace")), ...(await listEntities(c, "api_key"))],
    cursor: null,
    complete: true,
  }),
};
