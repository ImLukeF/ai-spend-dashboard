import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { ensureSchema } from "../../src/worker/db/migrate";
import { replaceWindow } from "../../src/worker/db/repo/facts";
import { NOW, resetDb } from "../helpers";

beforeEach(resetDb);
it("migrates concurrently and repeated application is safe", async () => {
  await Promise.all([ensureSchema(env.DB), ensureSchema(env.DB)]);
  expect(await env.DB.prepare("SELECT MAX(version) v FROM schema_migrations").first("v")).toBe(1);
});
it("replaces a snapshot without rewriting unchanged rows, removes late-revision omissions atomically", async () => {
  const base = {
    provider: "openai",
    day: "2026-11-03",
    workspace_id: "proj_example",
    api_key_id: "key_example",
    model: "gpt-example-1",
    service_tier: "",
    metric: "output",
    line_item: "example",
    quantity: 100,
  };
  const rows = [
    { ...base, amount_micros: 10 },
    { ...base, line_item: "removed", amount_micros: 20 },
  ];
  const write = (data: typeof rows) =>
    replaceWindow(env.DB, "cost_daily", "openai", "2026-11-03", "2026-11-04", data, NOW);
  expect(await write(rows)).toBe(2);
  expect(await write(rows)).toBe(0);
  expect(await write([{ ...base, amount_micros: 15 }])).toBe(2);
  const result = await env.DB.prepare("SELECT amount_micros FROM cost_daily").all();
  expect(result.results).toEqual([{ amount_micros: 15 }]);
});
