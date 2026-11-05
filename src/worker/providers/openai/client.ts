// UNVERIFIED: numeric admin rate limits and reporting lag; bounded polling honors Retry-After. https://developers.openai.com/api/docs/guides/admin-apis
import { SchemaDriftError } from "../../../shared/money";
import { providerFetch } from "../http";
import type { JobCtx, ProviderAdapter, PullWindow } from "../types";
import { mapCost, mapEntities, mapUsage } from "./map";
import { costPage, entityPage, usagePage } from "./schemas";

async function pull(ctx: JobCtx, w: PullWindow, kind: "hour" | "day" | "cost") {
  const params = new URLSearchParams({
    start_time: String(Date.parse(w.start) / 1000),
    bucket_width: kind === "hour" ? "1h" : "1d",
    limit: kind === "hour" ? "168" : "31",
  });
  if (w.end) params.set("end_time", String(Date.parse(w.end) / 1000));
  for (const g of kind === "cost"
    ? ["project_id", "api_key_id", "line_item"]
    : ["project_id", "api_key_id", "model", "service_tier"])
    params.append("group_by", g);
  const usage = [];
  const costs = [];
  let cursor = "";
  for (let i = 0; i < 10; i++) {
    if (cursor) params.set("page", cursor);
    const path = `/v1/organization/${kind === "cost" ? "costs" : "usage/completions"}?${params}`;
    const page =
      kind === "cost"
        ? await providerFetch(ctx, "openai", path, costPage)
        : await providerFetch(ctx, "openai", path, usagePage);
    if (!page) throw new Error("Empty page");
    if (kind === "cost") costs.push(...mapCost(costPage.parse(page)));
    else usage.push(...mapUsage(usagePage.parse(page), kind === "hour"));
    if (!page.has_more) return { usage, costs };
    if (!page.next_page || page.next_page === cursor) throw new SchemaDriftError(path, "next_page");
    cursor = page.next_page;
  }
  throw new Error("OpenAI pagination cap; snapshot not applied");
}
async function list(ctx: JobCtx, path: string, kind: "workspace" | "api_key", project = "") {
  const rows = [];
  let after = "";
  for (let i = 0; i < 10; i++) {
    const p = await providerFetch(
      ctx,
      "openai",
      `${path}${after ? `&after=${encodeURIComponent(after)}` : ""}`,
      entityPage,
    );
    if (!p) throw new Error("Empty page");
    rows.push(...mapEntities(p, kind, project));
    if (!p.has_more) return rows;
    if (!p.last_id || after === p.last_id) throw new SchemaDriftError(path, "last_id");
    after = p.last_id;
  }
  throw new Error("OpenAI entity pagination cap");
}
export const openai: ProviderAdapter = {
  id: "openai",
  secretName: "OPENAI_ADMIN_KEY",
  pullUsageHourly: async (c, w) => (await pull(c, w, "hour")).usage,
  pullUsageDaily: async (c, w) => (await pull(c, w, "day")).usage,
  pullCostDaily: async (c, w) => (await pull(c, w, "cost")).costs,
  pullEntities: async (ctx, cursor) => {
    const projects = await list(
      ctx,
      "/v1/organization/projects?limit=100&include_archived=true",
      "workspace",
    );
    const active = projects
      .filter((p) => p.status !== "archived")
      .sort((a, b) => a.id.localeCompare(b.id));
    const start = cursor
      ? Math.max(
          0,
          active.findIndex((p) => p.id > cursor),
        )
      : 0;
    const selected = active.slice(
      start,
      start + (ctx.deps.config.runtime.plan === "free" ? 10 : 100),
    );
    const rows = [...projects];
    for (const project of selected)
      rows.push(
        ...(await list(
          ctx,
          `/v1/organization/projects/${encodeURIComponent(project.id)}/api_keys?limit=100`,
          "api_key",
          project.id,
        )),
      );
    const complete = start + selected.length >= active.length;
    return { rows, cursor: complete ? null : (selected.at(-1)?.id ?? null), complete };
  },
};
