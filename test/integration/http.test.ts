import { beforeEach, expect, it } from "vitest";
import {
  BudgetsResponseSchema,
  SpendResponseSchema,
  SummaryResponseSchema,
  UsageResponseSchema,
} from "../../src/shared/api-types";
import { createApp } from "../../src/worker/http/app";
import { csvCell } from "../../src/worker/http/read";
import { createSession } from "../../src/worker/http/auth";
import { deps, NOW, resetDb } from "../helpers";

const token = "test-dashboard-token-0123456789abcdef0123";
const read = "test-read-api-token-0123456789abcdef0123";
const config = {
  budgets: [{ id: "example", name: "Example", period: "day", amount: 10 }],
  channels: [{ id: "example", type: "slack", webhookUrlSecret: "SLACK_WEBHOOK_URL" }],
};
const routes = [
  "summary",
  "spend",
  "usage",
  "budgets",
  "budgets/example",
  "entities",
  "events",
  "status",
  "config",
  "me",
  "export/spend.csv",
];
beforeEach(resetDb);
it.each(routes)("auth matrix for GET /%s", async (path) => {
  const c = deps(config, {
    DASHBOARD_TOKEN: token,
    READ_API_TOKEN: read,
    SLACK_WEBHOOK_URL: "https://example.com/test-secret-url",
  });
  const app = createApp(c);
  const url = `https://example.com/api/v1/${path}`;
  expect((await app.request(url)).status).toBe(401);
  expect(
    (
      await app.request(url, {
        headers: { cookie: `asd_session=${await createSession(token, NOW)}` },
      })
    ).status,
  ).toBe(200);
  const response = await app.request(url, { headers: { Authorization: `Bearer ${read}` } });
  expect(response.status).toBe(/^(summary|spend|budgets)/.test(path) ? 200 : 403);
});
it("health is minimal and auth misconfiguration returns 503 even with a read token", async () => {
  const app = createApp(deps(config, { DASHBOARD_TOKEN: "short", READ_API_TOKEN: read }));
  expect(await (await app.request("https://example.com/api/v1/health")).json()).toEqual({
    ok: true,
  });
  expect(
    (
      await app.request("https://example.com/api/v1/summary", {
        headers: { authorization: `Bearer ${read}` },
      })
    ).status,
  ).toBe(503);
});
it("login/logout cookies, CSRF, request limits, and generic failures", async () => {
  const app = createApp(deps(config, { DASHBOARD_TOKEN: token }));
  const url = "https://example.com/api/v1/session";
  const headers = { "content-type": "application/json", "x-asd-csrf": "1" };
  expect(
    (await app.request(url, { method: "POST", headers, body: JSON.stringify({ token: "wrong" }) }))
      .status,
  ).toBe(401);
  const login = await app.request(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ token }),
  });
  expect(login.status).toBe(200);
  expect(login.headers.get("set-cookie")).toContain("HttpOnly; Secure; SameSite=Strict");
  const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  const admin = "https://example.com/api/v1/admin/test-alert";
  for (const h of [{ cookie }, { cookie, ...headers, origin: "https://other.example.com" }])
    expect((await app.request(admin, { method: "POST", headers: h, body: "{}" })).status).toBe(403);
  expect(
    (
      await app.request(admin, {
        method: "POST",
        headers: { cookie, ...headers },
        body: JSON.stringify({ channelId: "example" }),
      })
    ).status,
  ).toBe(202);
  expect(
    (
      await app.request(admin, {
        method: "POST",
        headers: { cookie, ...headers },
        body: JSON.stringify({ channelId: "example" }),
      })
    ).status,
  ).toBe(429);
  expect(
    (
      await app.request(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ token: "x".repeat(17000) }),
      })
    ).status,
  ).toBe(400);
  const out = await app.request(url, { method: "DELETE", headers: { cookie, ...headers } });
  expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
});
it("validates queries and response contracts without leaking secrets and adds security headers", async () => {
  const c = deps(config, {
    DASHBOARD_TOKEN: token,
    READ_API_TOKEN: read,
    SLACK_WEBHOOK_URL: "https://example.com/private-channel",
  });
  const app = createApp(c);
  const headers = { cookie: `asd_session=${await createSession(token, NOW)}` };
  for (const [path, schema] of [
    ["summary", SummaryResponseSchema],
    ["spend", SpendResponseSchema],
    ["budgets", BudgetsResponseSchema],
    ["usage", UsageResponseSchema],
  ] as const) {
    const response = await app.request(`https://example.com/api/v1/${path}`, { headers });
    expect(schema.safeParse(await response.json()).success).toBe(true);
    expect(response.headers.get("Content-Security-Policy")).toContain("script-src 'self'");
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
  for (const path of [
    "spend?from=2026-02-30",
    "spend?from=2025-01-01&to=2026-11-04",
    "spend?groupBy=invalid",
    "spend?currency=XYZ",
    "events?limit=500",
    "usage?granularity=hour&from=2026-01-01",
  ])
    expect((await app.request(`https://example.com/api/v1/${path}`, { headers })).status).toBe(400);
  for (const path of ["status", "config"]) {
    const response = await app.request(`https://example.com/api/v1/${path}`, { headers });
    const body = await response.text();
    for (const value of [token, read, "https://example.com/private-channel"])
      expect(body).not.toContain(value);
  }
  const csv = await app.request("https://example.com/api/v1/export/spend.csv", { headers });
  expect(await csv.text()).toMatch(
    /^day,provider,workspace_id,workspace_name,api_key_id,api_key_name,model,basis,amount_usd,amount_usd/,
  );
});
it.each(["sync", "test-alert"])("rejects read tokens from admin %s", async (path) => {
  const app = createApp(deps(config, { DASHBOARD_TOKEN: token, READ_API_TOKEN: read }));
  expect(
    (
      await app.request(`https://example.com/api/v1/admin/${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${read}`,
          "content-type": "application/json",
          "x-asd-csrf": "1",
        },
        body: "{}",
      })
    ).status,
  ).toBe(403);
});

it("groups populated spend by every dimension, filters tags, and escapes CSV formulas", async () => {
  const c = deps({ tags: [{ dimension: "team", rules: [] }] }, { DASHBOARD_TOKEN: token });
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO spend_daily VALUES('openai','2026-11-03','proj_example01','key_example01','gpt-example-1','billed',60000,0,'2026-11-04T03:15:00Z')",
    ),
    c.env.DB.prepare(
      "INSERT INTO entity_tags VALUES('openai','proj_example01','key_example01','team','engineering')",
    ),
    c.env.DB.prepare(
      "INSERT INTO entities(provider,kind,id,name,workspace_id,first_seen_at,last_seen_at) VALUES('openai','api_key','key_example01','=HYPERLINK()','proj_example01','2026-11-04T03:15:00Z','2026-11-04T03:15:00Z')",
    ),
  ]);
  const app = createApp(c);
  const headers = { cookie: `asd_session=${await createSession(token, NOW)}` };
  for (const group of ["provider", "workspace", "api_key", "model", "tag:team"]) {
    const response = await app.request(
      `https://example.com/api/v1/spend?groupBy=${group}&tag=team:engineering`,
      { headers },
    );
    const data = SpendResponseSchema.parse(await response.json());
    expect(data.rows.reduce((n, r) => n + r.amountMicros, 0)).toBe(60000);
  }
  const csv = await (
    await app.request("https://example.com/api/v1/export/spend.csv", { headers })
  ).text();
  expect(csv).toContain("'=HYPERLINK()");
  expect(csv.split("\r\n")[0]).toContain("team");
});
it("keeps negative amounts numeric in CSV but guards formula-like text", () => {
  expect(csvCell(-1.25)).toBe('"-1.25"');
  expect(csvCell("-1.25")).toBe(`"'-1.25"`);
});

it("labels keys name first, keeps full key IDs and separates keys with matching names", async () => {
  const c = deps({}, { DASHBOARD_TOKEN: token });
  const ids = ["key_example_first_12345678", "key_example_second_12345678"];
  for (const id of ids) {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO entities(provider,kind,id,name,workspace_id,first_seen_at,last_seen_at) VALUES('openai','api_key',?,'Synthetic bot','workspace_example',?,?)",
      ).bind(id, NOW.toISOString(), NOW.toISOString()),
      c.env.DB.prepare(
        "INSERT INTO spend_daily VALUES('openai','2026-11-03','workspace_example',?,'model-example','billed',1000000,0,?)",
      ).bind(id, NOW.toISOString()),
    ]);
  }
  await c.env.DB.prepare(
    "INSERT INTO spend_daily VALUES('openai','2026-11-03','workspace_example','','model-example','billed',1000000,0,?)",
  )
    .bind(NOW.toISOString())
    .run();
  const response = await createApp(c).request("https://example.com/api/v1/spend?groupBy=api_key", {
    headers: { cookie: `asd_session=${await createSession(token, NOW)}` },
  });
  const data = SpendResponseSchema.parse(await response.json());
  expect(data.rows.map((r) => r.group).sort()).toEqual([
    "No key (Console) · openai",
    ...ids.map((id) => `Synthetic bot · openai · ${id}`),
  ]);
  expect(data.rows.map((r) => r.amount)).toEqual([1, 1, 1]);
});

it.each([
  [true, undefined, "not_configured", false],
  [true, "", "not_configured", false],
  [true, "   ", "not_configured", false],
  [true, " - ", "not_configured", false],
  [true, " test-provider-key-not-real ", "configured", true],
  [false, "test-provider-key-not-real", "disabled", true],
  [false, undefined, "disabled", false],
] as const)(
  "reports provider configuration from sync eligibility: enabled=%s credential=%j",
  async (enabled, credential, state, configured) => {
    const c = deps(
      { providers: { openrouter: { enabled } } },
      { DASHBOARD_TOKEN: token, OPENROUTER_MANAGEMENT_KEY: credential },
    );
    const response = await createApp(c).request("https://example.com/api/v1/status", {
      headers: { cookie: `asd_session=${await createSession(token, NOW)}` },
    });
    const body = await response.json<{ providers: unknown[] }>();
    expect(body.providers).toContainEqual({
      provider: "openrouter",
      enabled,
      configured,
      status: state,
      hasData: false,
      lastSuccessAt: null,
    });
    expect(JSON.stringify(body)).not.toContain("test-provider-key-not-real");
  },
);

it("distinguishes seeded spend, entity discovery, and a successful data sync", async () => {
  const c = deps({}, { DASHBOARD_TOKEN: token });
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO spend_daily VALUES('openrouter','2026-11-03','workspace_example','key_example','model-example','billed',1000000,0,?)",
    ).bind(NOW.toISOString()),
    c.env.DB.prepare("INSERT INTO meta(k,v) VALUES('synthetic_demo','true')"),
    c.env.DB.prepare(
      "INSERT INTO sync_state(job,provider,last_success_at) VALUES('openrouter.entities','openrouter',?)",
    ).bind(NOW.toISOString()),
  ]);
  const app = createApp(c);
  const headers = { cookie: `asd_session=${await createSession(token, NOW)}` };
  const first = await (await app.request("https://example.com/api/v1/status", { headers })).json<{
    syntheticDemo: boolean;
    providers: unknown[];
  }>();
  expect(first.syntheticDemo).toBe(true);
  expect(first.providers).toContainEqual({
    provider: "openrouter",
    enabled: false,
    configured: false,
    status: "disabled",
    hasData: true,
    lastSuccessAt: null,
  });
  await c.env.DB.prepare(
    "INSERT INTO sync_state(job,provider,last_success_at) VALUES('openrouter.cost_daily','openrouter',?)",
  )
    .bind(NOW.toISOString())
    .run();
  const second = await (await app.request("https://example.com/api/v1/status", { headers })).json<{
    providers: { provider: string; lastSuccessAt: string | null }[];
  }>();
  expect(second.providers.find((p) => p.provider === "openrouter")?.lastSuccessAt).toBe(
    NOW.toISOString(),
  );
});

it("projects MTD dollars once across billed, allocated and estimated daily spend", async () => {
  const c = deps({}, { DASHBOARD_TOKEN: token });
  for (const [day, micros, basis] of [
    ["2026-11-01", 15330000, "allocated"],
    ["2026-11-02", 14820000, "billed"],
    ["2026-11-03", 14310000, "estimated"],
    ["2026-11-04", 13800000, "billed"],
  ]) {
    await c.env.DB.prepare(
      "INSERT INTO spend_daily VALUES('openai',?,'workspace_example','key_example','model-example',?,?,0,?)",
    )
      .bind(day, basis, micros, NOW.toISOString())
      .run();
  }
  const response = await createApp(c).request("https://example.com/api/v1/summary", {
    headers: { cookie: `asd_session=${await createSession(token, NOW)}` },
  });
  const { totals } = SummaryResponseSchema.parse(await response.json());
  expect(totals.today).toBeCloseTo(13.8);
  expect(totals.monthToDate).toBeCloseTo(58.26);
  expect(totals.monthForecast).toBeCloseTo(557.4378737542, 8);
});

it("reports freshness only for providers with keys and shows their sync errors", async () => {
  const c = deps(
    { providers: { openrouter: { enabled: true } } },
    { DASHBOARD_TOKEN: token, OPENAI_ADMIN_KEY: "test-key", OPENROUTER_MANAGEMENT_KEY: "test-key" },
  );
  const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60000).toISOString();
  await c.env.DB.batch(
    [
      ["openai.cost_daily", "openai", ago(10), 0, null],
      ["openai.usage_hourly", "openai", ago(20), 2, "HTTP 500"],
      ["openrouter.cost_daily", "openrouter", ago(50), 0, null],
    ].map((row) =>
      c.env.DB.prepare(
        "INSERT INTO sync_state(job,provider,last_success_at,consecutive_failures,last_error) VALUES(?,?,?,?,?)",
      ).bind(...row),
    ),
  );
  const response = await createApp(c).request("https://example.com/api/v1/summary", {
    headers: { cookie: `asd_session=${await createSession(token, NOW)}` },
  });
  const { freshness, warnings } = SummaryResponseSchema.parse(await response.json());
  expect(freshness).toEqual([
    { provider: "openai", lastSuccessAt: ago(10), lastError: "HTTP 500", stale: false },
    { provider: "openrouter", lastSuccessAt: ago(50), lastError: null, stale: false },
  ]);
  expect(warnings.join(" ")).not.toContain("anthropic");
});
