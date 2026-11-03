import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { upsertEntities } from "../../src/worker/db/repo/entities";
import {
  executeEnforcement,
  recoverPlanned,
  restoreEnforcement,
} from "../../src/worker/enforcement/execute";
import { BudgetCounter } from "../../src/worker/jobs/budget";
import type { EntityRow } from "../../src/worker/providers/types";
import { deps, json, resetDb } from "../helpers";

const actions = [
  { type: "anthropic.deactivate_api_key", apiKeyId: "apikey_EXAMPLE01" },
  { type: "anthropic.deactivate_workspace_keys", workspaceId: "wrkspc_EXAMPLE01", maxKeys: 20 },
  { type: "openai.set_project_spend_limit", projectId: "proj_example01" },
  { type: "openrouter.disable_key", keyHash: "example0hash01" },
];
const config = {
  providers: { openrouter: { enabled: true } },
  budgets: [
    {
      id: "daily",
      name: "Daily",
      period: "day",
      amount: 10,
      enforce: { restoreAtPeriodEnd: true, actions },
    },
  ],
};
const entities: EntityRow[] = [
  {
    provider: "anthropic",
    kind: "api_key",
    id: "apikey_EXAMPLE01",
    name: "Example one",
    workspaceId: "wrkspc_EXAMPLE01",
    status: "active",
  },
  {
    provider: "anthropic",
    kind: "api_key",
    id: "apikey_EXAMPLE02",
    name: "Example two",
    workspaceId: "wrkspc_EXAMPLE01",
    status: "active",
  },
  {
    provider: "anthropic",
    kind: "workspace",
    id: "wrkspc_EXAMPLE01",
    name: "Example workspace",
    workspaceId: "",
    status: "active",
  },
  {
    provider: "openai",
    kind: "workspace",
    id: "proj_example01",
    name: "Example project",
    workspaceId: "",
    status: "active",
  },
  {
    provider: "openrouter",
    kind: "api_key",
    id: "example0hash01",
    name: "Example key",
    workspaceId: "",
    status: "active",
  },
];
async function setup(master: string, extra: Record<string, unknown> = {}) {
  const c = deps(
    { ...config, ...extra },
    {
      ENFORCEMENT_MODE: master,
      ANTHROPIC_ADMIN_KEY: "test-anthropic-key-not-real",
      OPENAI_ADMIN_KEY: "test-openai-key-not-real",
      OPENROUTER_MANAGEMENT_KEY: "test-openrouter-key-not-real",
    },
  );
  await upsertEntities(c, entities);
  for (const p of ["anthropic", "openai", "openrouter"])
    await env.DB.prepare("INSERT INTO sync_state(job,provider,last_success_at) VALUES(?,?,?)")
      .bind(`${p}.cost_daily`, p, "2026-11-04T03:15:00Z")
      .run();
  const budget = c.config.budgets[0];
  if (!budget) throw new Error("missing budget");
  return {
    c,
    evaluated: [
      { budget, result: { percent: 100, canEnforce: true, start: "2026-11-04T00:00:00Z" } },
    ],
  };
}
beforeEach(resetDb);
it.each(["", "dry_run", "off"])("%s never performs provider writes", async (master) => {
  const { c, evaluated } = await setup(master);
  let calls = 0;
  c.fetch = async () => {
    calls++;
    throw new Error("Dry run must not fetch provider");
  };
  await executeEnforcement(c, new BudgetCounter("paid"), evaluated);
  expect(calls).toBe(0);
  expect(await env.DB.prepare("SELECT COUNT(*) n FROM enforcement_actions").first("n")).toBe(
    master === "off" ? 0 : 4,
  );
  await executeEnforcement(c, new BudgetCounter("paid"), evaluated);
  expect(await env.DB.prepare("SELECT COUNT(*) n FROM enforcement_actions").first("n")).toBe(
    master === "off" ? 0 : 4,
  );
});
it("applies all four reversible action types, snapshots, restores and respects human overrides", async () => {
  const { c, evaluated } = await setup("live");
  const current: Record<string, Record<string, unknown>> = {
    apikey_EXAMPLE01: { status: "active" },
    apikey_EXAMPLE02: { status: "active" },
    example0hash01: { disabled: false },
    proj_example01: { none: true },
  };
  const writes: { path: string; method: string; body: Record<string, unknown> }[] = [];
  c.fetch = async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname;
    const method = init?.method ?? "GET";
    let id = path.split("/").at(-1) ?? "";
    if (path.endsWith("/spend_limit")) id = path.split("/").at(-2) ?? "";
    if (path.endsWith("/api_keys") && method === "GET")
      return json({
        data: entities
          .filter(
            (e) =>
              e.provider === "anthropic" &&
              e.kind === "api_key" &&
              current[e.id]?.status === "active",
          )
          .map((e) => ({ id: e.id, name: e.name, status: "active", workspace_id: e.workspaceId })),
        has_more: false,
        last_id: null,
      });
    if (method !== "GET") {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      writes.push({ path, method, body });
      current[id] =
        method === "DELETE"
          ? { none: true }
          : path.endsWith("/spend_limit")
            ? { ...body, enforcement: "enforcing" }
            : body;
    }
    const value = current[id] ?? {};
    if (url.hostname === "api.anthropic.com")
      return json({ id, name: "Example", status: value.status, workspace_id: "wrkspc_EXAMPLE01" });
    if (url.hostname === "openrouter.ai")
      return json({ data: { hash: id, name: "Example", disabled: value.disabled } });
    if (value.none)
      return method === "DELETE" ? json({ deleted: true }) : json({ error: "none" }, 404);
    return json({ ...value, enforcement: { status: value.enforcement ?? "enforcing" } });
  };
  await executeEnforcement(c, new BudgetCounter("paid"), evaluated);
  expect(writes).toHaveLength(4);
  expect(
    await env.DB.prepare("SELECT COUNT(*) n FROM enforcement_actions WHERE status='applied'").first(
      "n",
    ),
  ).toBe(4);
  expect(writes.find((w) => w.path.endsWith("/spend_limit"))?.body).toEqual({
    threshold_amount: 1,
    currency: "USD",
    interval: "month",
  });
  expect(
    writes.filter((w) => w.path.includes("/api_keys/")).every((w) => w.body.status === "inactive"),
  ).toBe(true);
  await executeEnforcement(c, new BudgetCounter("paid"), evaluated);
  expect(writes).toHaveLength(4);
  // A human re-enables one key; neither refresh nor period restore may disable it again.
  current.apikey_EXAMPLE01 = { status: "active" };
  await upsertEntities(c, [entities[0] as EntityRow]);
  expect(
    await env.DB.prepare(
      "SELECT status FROM enforcement_actions WHERE target_id='apikey_EXAMPLE01'",
    ).first("status"),
  ).toBe("overridden");
  c.now = () => new Date("2026-11-05T00:15:00Z");
  await restoreEnforcement(c, new BudgetCounter("paid"));
  expect(current.apikey_EXAMPLE02).toEqual({ status: "active" });
  expect(current.example0hash01).toEqual({ disabled: false });
  expect(current.proj_example01).toEqual({ none: true });
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) n FROM enforcement_actions WHERE status='restored'",
    ).first("n"),
  ).toBe(3);
  expect(writes.some((w) => w.method === "DELETE" && !w.path.endsWith("/spend_limit"))).toBe(false);
});
it("protected targets, stale sync, missing FX and action caps never reach provider writes", async () => {
  const { c, evaluated } = await setup("live", {
    enforcement: {
      protectedKeyIds: ["apikey_EXAMPLE01", "apikey_EXAMPLE02"],
      maxActionsPerTick: 1,
      maxActionsPerDay: 1,
    },
  });
  await env.DB.prepare("UPDATE sync_state SET last_success_at='2026-10-01T00:00:00Z'").run();
  let writes = 0;
  c.fetch = async (_u, init) => {
    if (init?.method && init.method !== "GET") writes++;
    return json({ data: [], has_more: false, last_id: null });
  };
  await executeEnforcement(c, new BudgetCounter("paid"), evaluated);
  expect(writes).toBe(0);
  expect(
    await env.DB.prepare("SELECT count(*) n FROM enforcement_actions WHERE status='skipped'").first(
      "n",
    ),
  ).toBeGreaterThan(0);
});

it("skips every live action when FX is unavailable", async () => {
  const { c, evaluated } = await setup("live");
  for (const e of evaluated) e.result.canEnforce = false;
  let writes = 0;
  c.fetch = async (_u, init) => {
    if (init?.method && init.method !== "GET") writes++;
    return json({ data: [], has_more: false, last_id: null });
  };
  await executeEnforcement(c, new BudgetCounter("paid"), evaluated);
  expect(writes).toBe(0);
  expect(
    await env.DB.prepare(
      "SELECT count(*) n FROM enforcement_actions WHERE reason='missing_fx'",
    ).first("n"),
  ).toBeGreaterThan(0);
});

it("recovers interrupted provider mutations from the durable snapshot without applying again", async () => {
  const { c } = await setup("live");
  await env.DB.prepare(
    "INSERT INTO enforcement_actions(id,budget_id,period_start,action_type,provider,target_id,mode,status,previous_state,applied_state,created_at,updated_at) VALUES('action_example','daily','2026-11-04T00:00:00Z','anthropic.deactivate_api_key','anthropic','apikey_EXAMPLE01','live','planned',?,?,'2026-11-04T03:15:00Z','2026-11-04T03:15:00Z')",
  )
    .bind(JSON.stringify({ status: "active" }), JSON.stringify({ status: "inactive" }))
    .run();
  let writes = 0;
  c.fetch = async (_u, init) => {
    if (init?.method && init.method !== "GET") writes++;
    return json({ id: "apikey_EXAMPLE01", status: "inactive", name: "Example" });
  };
  await recoverPlanned(c, new BudgetCounter("paid"));
  expect(writes).toBe(0);
  expect(
    await env.DB.prepare("SELECT status FROM enforcement_actions WHERE id='action_example'").first(
      "status",
    ),
  ).toBe("applied");
});
