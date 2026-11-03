import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { getMeta } from "../../src/worker/db/repo/state";
import { BudgetCounter, countedDb } from "../../src/worker/jobs/budget";
import { deriveDay, learnRates } from "../../src/worker/jobs/derive";
import { tick } from "../../src/worker/jobs/tick";
import { materialise } from "../../src/worker/tags/materialise";
import antK from "../fixtures/anthropic/api-keys.json";
import antC from "../fixtures/anthropic/cost-day.json";
import antU from "../fixtures/anthropic/usage-day.json";
import antW from "../fixtures/anthropic/workspaces.json";
import aiK from "../fixtures/openai/api-keys.json";
import aiC from "../fixtures/openai/cost-day.json";
import aiP from "../fixtures/openai/projects-page1.json";
import aiU from "../fixtures/openai/usage-day.json";
import orA from "../fixtures/openrouter/analytics.json";
import orK from "../fixtures/openrouter/keys-page1.json";
import { deps, json, NOW, resetDb } from "../helpers";

function mockFetch(revised = false): typeof fetch {
  return async (input, init) => {
    const u = new URL(String(input));
    if (u.hostname === "api.anthropic.com") {
      if (u.pathname.endsWith("/workspaces")) return json(antW);
      if (u.pathname.endsWith("/api_keys")) return json(antK);
      if (u.pathname.endsWith("/cost_report"))
        return json(
          revised
            ? {
                ...antC,
                data: antC.data.map((b) => ({
                  ...b,
                  results: b.results
                    .slice(0, -1)
                    .map((r, i) => (i === 0 ? { ...r, amount: "200" } : r)),
                })),
              }
            : antC,
        );
      return json(antU);
    }
    if (u.hostname === "api.openai.com") {
      if (u.pathname.endsWith("/projects")) return json({ ...aiP, has_more: false });
      if (u.pathname.endsWith("/api_keys")) return json(aiK);
      if (u.pathname.endsWith("/costs")) return json(aiC);
      return json(aiU);
    }
    if (u.hostname === "openrouter.ai") {
      if (u.pathname.endsWith("/keys"))
        return json(u.searchParams.get("offset") === "0" ? orK : { data: [] });
      if (init?.method === "POST") return json(orA);
    }
    throw new Error("Unexpected fake endpoint");
  };
}
beforeEach(resetDb);
it("syncs all providers, derives exact billed totals, materialises tags and remains idempotent", async () => {
  const c = deps(
    {
      runtime: { plan: "paid" },
      providers: { openrouter: { enabled: true } },
      sync: { backfillDays: 1 },
      tags: [
        { dimension: "agent", rules: [{ value: "support", match: { apiKeyName: "support-*" } }] },
      ],
    },
    {
      ANTHROPIC_ADMIN_KEY: "test-anthropic-admin-key-not-real",
      OPENAI_ADMIN_KEY: "test-openai-admin-key-not-real",
      OPENROUTER_MANAGEMENT_KEY: "test-openrouter-management-key-not-real",
    },
  );
  c.fetch = mockFetch();
  const result = await tick(c);
  expect(result.errors).toEqual([]);
  expect(
    Number(await env.DB.prepare("SELECT count(*) n FROM usage_daily").first("n")),
  ).toBeGreaterThan(0);
  expect(
    Number(await env.DB.prepare("SELECT count(*) n FROM entity_tags").first("n")),
  ).toBeGreaterThan(0);
  for (const p of ["anthropic", "openai", "openrouter"]) {
    const billed = await env.DB.prepare(
      "SELECT SUM(amount_micros) n FROM cost_daily WHERE provider=?",
    )
      .bind(p)
      .first("n");
    const derived = await env.DB.prepare(
      "SELECT SUM(amount_micros) n FROM spend_daily WHERE provider=? AND basis!='estimated'",
    )
      .bind(p)
      .first("n");
    expect(derived).toBe(billed);
  }
  expect(await getMeta(env.DB, "data_version")).toBeTruthy();
  const second = await tick(c);
  expect(second.changed).toBe(0);
  const version = await getMeta(env.DB, "data_version");
  await env.DB.prepare(
    "UPDATE sync_state SET next_due_at=NULL WHERE job LIKE '%.usage_daily' OR job LIKE '%.cost_daily'",
  ).run();
  expect((await tick(c)).changed).toBe(0);
  expect(await getMeta(env.DB, "data_version")).toBe(version);
});
it("late revisions remove missing rows and rebuild changed provider-days", async () => {
  const c = deps(
    {
      runtime: { plan: "paid" },
      providers: { anthropic: { enabled: true }, openai: { enabled: false } },
      sync: { backfillDays: 1 },
    },
    { ANTHROPIC_ADMIN_KEY: "test-anthropic-admin-key-not-real" },
  );
  c.fetch = mockFetch();
  expect((await tick(c)).errors).toEqual([]);
  await env.DB.prepare(
    "UPDATE sync_state SET next_due_at=NULL WHERE job LIKE '%.cost_daily'",
  ).run();
  c.fetch = mockFetch(true);
  expect((await tick(c)).errors).toEqual([]);
  expect(await env.DB.prepare("SELECT count(*) n FROM cost_daily").first("n")).toBe(7);
  expect(await env.DB.prepare("SELECT SUM(amount_micros) n FROM spend_daily").first("n")).toBe(
    await env.DB.prepare("SELECT SUM(amount_micros) n FROM cost_daily").first("n"),
  );
});
it("locks concurrent ticks and releases its own lease", async () => {
  const c = deps({ providers: { anthropic: { enabled: false }, openai: { enabled: false } } });
  const results = await Promise.all([tick(c), tick(c)]);
  expect(results.filter((r) => "locked" in r && r.locked)).toHaveLength(1);
  expect(await tick(c)).not.toHaveProperty("locked");
});
it("caps free subrequests and leaves jobs due for the next tick", async () => {
  const c = deps(
    { providers: { anthropic: { enabled: false }, openai: { enabled: true } } },
    { OPENAI_ADMIN_KEY: "test-openai-admin-key-not-real" },
  );
  let calls = 0;
  c.fetch = async (input) => {
    calls++;
    const u = new URL(String(input));
    if (u.pathname.endsWith("/projects"))
      return json({
        data: Array.from({ length: 35 }, (_, i) => ({
          id: `proj_example${String(i).padStart(3, "0")}`,
          name: "Example",
          status: "active",
        })),
        has_more: false,
        last_id: null,
      });
    if (u.pathname.endsWith("/api_keys")) return json({ data: [], has_more: false, last_id: null });
    return json({ data: [], has_more: false, next_page: null });
  };
  const first = await tick(c);
  expect(calls).toBeLessThanOrEqual(40);
  expect(first.subrequests).toBeLessThanOrEqual(40);
  const state = await env.DB.prepare(
    "SELECT cursor FROM sync_state WHERE job='openai.entities'",
  ).first<string>("cursor");
  expect(state).toBeTruthy();
  c.now = () => new Date(NOW.getTime() + 16 * 60000);
  const before = calls;
  await tick(c);
  expect(calls - before).toBeLessThanOrEqual(40);
  expect(
    await env.DB.prepare("SELECT cursor FROM sync_state WHERE job='openai.entities'").first(
      "cursor",
    ),
  ).not.toBe(state);
});
it("keeps billed amounts authoritative while priority and missing-cost usage remain estimated", async () => {
  const c = deps({
    pricing: {
      overrides: [
        { provider: "anthropic", model: "claude-example-1", metric: "output", usdPerMillion: 2 },
      ],
    },
  });
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO cost_daily VALUES('anthropic','2026-11-03','workspace_example','','claude-example-1','standard','output','example',10,NULL,'2026-11-04T03:15:00Z')",
    ),
    ...["standard", "batch", "priority"].map((tier, i) =>
      env.DB.prepare(
        "INSERT INTO usage_daily VALUES('anthropic','2026-11-03','workspace_example',?,'claude-example-1',?,'output',1000,'2026-11-04T03:15:00Z')",
      ).bind(`key_example${i}`, tier),
    ),
  ]);
  await learnRates(c);
  await deriveDay(c, "anthropic", "2026-11-03");
  expect(
    await env.DB.prepare(
      "SELECT SUM(amount_micros) n FROM spend_daily WHERE basis='allocated'",
    ).first("n"),
  ).toBe(10);
  expect(
    await env.DB.prepare(
      "SELECT SUM(amount_micros) n FROM spend_daily WHERE basis='estimated'",
    ).first("n"),
  ).toBe(2000);
  await materialise(c);
});

it("keeps all Free D1 calls including bookkeeping below platform limits", async () => {
  const counter = new BudgetCounter("paid");
  const c = deps(
    { providers: { openai: { enabled: false } }, sync: { backfillDays: 1 } },
    { ANTHROPIC_ADMIN_KEY: "test-anthropic-admin-key-not-real" },
  );
  c.env.DB = countedDb(c.env.DB, counter);
  c.fetch = mockFetch();
  await tick(c);
  expect(counter.queries).toBeLessThanOrEqual(50);
});
