import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { BudgetCounter } from "../../src/worker/jobs/budget";
import { anthropic } from "../../src/worker/providers/anthropic/client";
import {
  mapCost as antCost,
  mapEntities as antEntities,
  mapUsage as antUsage,
} from "../../src/worker/providers/anthropic/map";
import {
  costPage as antCostSchema,
  entityPage as antEntitySchema,
  usagePage as antUsageSchema,
} from "../../src/worker/providers/anthropic/schemas";
import { boundedJson, providerFetch } from "../../src/worker/providers/http";
import { openai } from "../../src/worker/providers/openai/client";
import { mapCost as aiCost, mapUsage as aiUsage } from "../../src/worker/providers/openai/map";
import {
  costPage as aiCostSchema,
  usagePage as aiUsageSchema,
} from "../../src/worker/providers/openai/schemas";
import { openrouter } from "../../src/worker/providers/openrouter/client";
import { mapAnalytics, mapEntities, resolveName } from "../../src/worker/providers/openrouter/map";
import { analytics, keysPage } from "../../src/worker/providers/openrouter/schemas";
import antKeys from "../fixtures/anthropic/api-keys.json";
import antC from "../fixtures/anthropic/cost-day.json";
import antU from "../fixtures/anthropic/usage-day.json";
import antP1 from "../fixtures/anthropic/usage-hour-page1.json";
import antP2 from "../fixtures/anthropic/usage-hour-page2.json";
import antNull from "../fixtures/anthropic/usage-null.json";
import aiC from "../fixtures/openai/cost-day.json";
import aiU from "../fixtures/openai/usage-day.json";
import orData from "../fixtures/openrouter/analytics.json";
import orTruncated from "../fixtures/openrouter/analytics-truncated.json";
import orKeys from "../fixtures/openrouter/keys-page1.json";
import orKeys2 from "../fixtures/openrouter/keys-page2.json";
import { deps, json } from "../helpers";

const window = { start: "2026-11-03T00:00:00Z", end: "2026-11-04T00:00:00Z" };
const ctx = () => ({
  deps: deps(),
  budget: new BudgetCounter("free"),
  secret: "test-provider-key-not-real",
});
it("maps all Anthropic metrics and exact cents, null dimensions and both key scope forms", () => {
  expect(antUsage(antUsageSchema.parse(antU), false)).toHaveLength(12);
  expect(antUsage(antUsageSchema.parse(antNull), false)[0]).toMatchObject({
    workspaceId: "",
    apiKeyId: "",
  });
  const costs = antCost(antCostSchema.parse(antC));
  expect(costs).toHaveLength(8);
  expect(costs[0]?.amountMicros).toBe(1237891);
  expect(
    antEntities(antEntitySchema.parse(antKeys), "api_key").every(
      (k) => k.workspaceId === "wrkspc_EXAMPLE01",
    ),
  ).toBe(true);
});
it("subtracts cached/write input and preserves unmatched OpenAI line items and token units", () => {
  const usage = aiUsage(aiUsageSchema.parse(aiU), false);
  expect(usage.find((r) => r.metric === "input_uncached")?.quantity).toBe(550);
  const costs = aiCost(aiCostSchema.parse(aiC));
  expect(costs[0]).toMatchObject({ quantity: 10000, amountMicros: 60000, model: "gpt-example-1" });
  expect(costs[1]).toMatchObject({
    metric: "other",
    model: "",
    quantity: null,
    lineItem: "storage unparsed",
  });
});
it("maps OpenRouter date variants, numeric strings and ambiguous key names", () => {
  const keys = mapEntities(keysPage.parse(orKeys));
  const mapped = mapAnalytics(analytics.parse(orData), keys);
  expect(mapped.costs[0]).toMatchObject({ apiKeyId: "example0hash01", amountMicros: 1234567 });
  expect(mapAnalytics(analytics.parse(orTruncated), keys).usage).toHaveLength(3);
  expect(resolveName("Example bot", [...keys, ...keys])).toBeUndefined();
  expect(mapAnalytics(analytics.parse(orData), [...keys, ...keys]).costs[0]?.apiKeyId).toBe(
    "name:Example bot",
  );
  expect(() =>
    analytics.parse({
      data: { data: [{ date__day: "2026-11-03" }], metadata: { truncated: false } },
    }),
  ).toThrow();
});
describe("bounded provider HTTP", () => {
  it.each([429, 500])("retries %s with Retry-After and counts every subrequest", async (status) => {
    const c = ctx();
    c.deps.sleep = vi.fn(async () => {});
    let n = 0;
    c.deps.fetch = vi.fn(async () =>
      ++n === 1 ? json({}, status, { "retry-after": "2" }) : json({ ok: true }),
    );
    expect(await providerFetch(c, "openai", "/v1/example", z.object({ ok: z.boolean() }))).toEqual({
      ok: true,
    });
    expect(c.budget.requests).toBe(2);
    expect(c.deps.sleep).toHaveBeenCalledWith(2000);
  });
  it.each([400, 401, 403, 404])("never retries %s", async (status) => {
    const c = ctx();
    c.deps.fetch = vi.fn(async () => json({ error: { message: "secret" } }, status));
    await expect(providerFetch(c, "openai", "/v1/example", z.unknown())).rejects.toThrow(
      `HTTP ${status}`,
    );
    expect(c.budget.requests).toBe(1);
  });
  it("refuses foreign hosts and redirects, schema drift, and oversized streaming bodies", async () => {
    const c = ctx();
    await expect(providerFetch(c, "openai", "https://example.com", z.unknown())).rejects.toThrow(
      "host",
    );
    c.deps.fetch = async () => json({ other: true });
    await expect(
      providerFetch(c, "openai", "/v1/example", z.object({ required: z.string() })),
    ).rejects.toThrow("required");
    await expect(boundedJson(new Response(new Uint8Array(11)), 10)).rejects.toThrow("size");
  });
  it("aborts a slow provider at timeout without logging request credentials", async () => {
    vi.useFakeTimers();
    try {
      const c = ctx();
      c.deps.fetch = async (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () => reject(new Error("Timed out"))),
        );
      const promise = providerFetch(c, "openai", "/v1/example", z.unknown());
      const assertion = expect(promise).rejects.toThrow("Timed out");
      await vi.advanceTimersByTimeAsync(25001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
it("follows Anthropic pages and uses group_by[]", async () => {
  const c = ctx();
  const calls: string[] = [];
  c.deps.fetch = async (url) => {
    calls.push(String(url));
    return json(calls.length === 1 ? antP1 : antP2);
  };
  const rows = await anthropic.pullUsageHourly?.(c, window);
  expect(rows).toHaveLength(12);
  expect(calls[1]).toContain("page=page_example2");
  expect(calls[0]).toContain("group_by%5B%5D");
});
it("OpenAI repeats group_by parameters", async () => {
  const c = ctx();
  let called = "";
  c.deps.fetch = async (url) => {
    called = String(url);
    return json(aiC);
  };
  await openai.pullCostDaily(c, window);
  expect(new URL(called).searchParams.getAll("group_by")).toEqual([
    "project_id",
    "api_key_id",
    "line_item",
  ]);
});
it("splits truncated OpenRouter ranges and never silently drops rows", async () => {
  const c = ctx();
  let query = 0;
  c.deps.fetch = async (url) => {
    const path = new URL(String(url));
    if (path.pathname.endsWith("/keys"))
      return json(path.searchParams.get("offset") === "0" ? orKeys : { data: [] });
    query++;
    return json(query === 1 ? orTruncated : { data: { data: [], metadata: { truncated: false } } });
  };
  const rows = await openrouter.pullCostDaily(c, {
    start: "2026-11-01T00:00:00Z",
    end: "2026-11-05T00:00:00Z",
  });
  expect(rows).toEqual([]);
  expect(query).toBe(3);
});
const orKey = (n: number) => ({ ...orKeys.data[0], hash: `example0hash1${n}` });
it.each([
  {
    stop: "an empty page",
    pages: [orKeys, orKeys2, { data: [] }],
    offsets: ["0", "1", "2"],
    hashes: ["example0hash01", "example0hash02"],
  },
  {
    stop: "a shorter page",
    pages: [[1, 2], [3, 4], [5]].map((p) => ({ data: p.map(orKey) })),
    offsets: ["0", "2", "4"],
    hashes: [11, 12, 13, 14, 15].map((n) => `example0hash${n}`),
  },
])("pages OpenRouter keys until $stop", async ({ pages, offsets, hashes }) => {
  const c = ctx();
  const seen: (string | null)[] = [];
  c.deps.fetch = async (url) => {
    seen.push(new URL(String(url)).searchParams.get("offset"));
    return json(pages[seen.length - 1] ?? { data: [] });
  };
  const result = await openrouter.pullEntities(c, null);
  expect(seen).toEqual(offsets);
  expect(result.rows.map((r) => r.id)).toEqual(hashes);
});
it("fails OpenRouter key paging after 20 full pages", async () => {
  const c = ctx();
  let calls = 0;
  c.deps.fetch = async () => {
    calls++;
    return json(orKeys);
  };
  await expect(openrouter.pullEntities(c, null)).rejects.toThrow("pagination cap");
  expect(calls).toBe(20);
});
