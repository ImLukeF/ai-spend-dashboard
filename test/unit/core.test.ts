import { describe, expect, it } from "vitest";
import solo from "../../examples/solo-bots.config";
import team from "../../examples/team-monthly-aud.config";
import shipped from "../../spend.config";
import { ConfigSchema } from "../../src/shared/config-schema";
import { centsDecimalStringToMicros, usdToMicros } from "../../src/shared/money";
import { period } from "../../src/shared/periods";
import { evaluate } from "../../src/worker/budgets/evaluate";
import { forecast, forecastTriggered } from "../../src/worker/budgets/forecast";
import { loadConfig } from "../../src/worker/config";
import { canRestore, guard, mode } from "../../src/worker/enforcement/plan";
import { convert, rateFor } from "../../src/worker/fx/convert";
import { allocate, tierClass } from "../../src/worker/jobs/allocate";
import { estimate } from "../../src/worker/jobs/estimate";
import { canonical } from "../../src/worker/lib/hash";
import { redact } from "../../src/worker/lib/redact";
import { glob, matchTags } from "../../src/worker/tags/match";
import { NOW } from "../helpers";

describe("exact money", () => {
  it.each([
    ["123.78912", 1237891],
    ["-123.78915", -1237892],
    ["0.00005", 1],
    ["0", 0],
  ])("cents %s", (input, expected) => expect(centsDecimalStringToMicros(input)).toBe(expected));
  it.each([
    ["1.0000005", 1000001],
    ["-1.0000005", -1000001],
    [0.06, 60000],
    ["0", 0],
  ])("USD %s", (input, expected) => expect(usdToMicros(input)).toBe(expected));
  it.each(["1e2", "+1", "abc", "", Number.NaN, Infinity, 1e20])("rejects %s", (v) =>
    expect(() => usdToMicros(v)).toThrow(),
  );
});
it.each([
  ["2026-01-01T01:00:00Z", "week", "2025-12-29T00:00:00Z", "2026-01-05T00:00:00Z"],
  ["2024-02-29T12:00:00Z", "month", "2024-02-01T00:00:00Z", "2024-03-01T00:00:00Z"],
  ["2026-11-04T03:15:00Z", "day", "2026-11-04T00:00:00Z", "2026-11-05T00:00:00Z"],
] as const)("UTC periods %s", (date, kind, start, end) =>
  expect(period(new Date(date), kind)).toMatchObject({ start, end }),
);
it.each([
  [42, 72, 720, "month", 420],
  [56, 96, 720, "month", 420],
  [28, 48, 168, "week", 98],
  [0, 24, 720, "month", 0],
  [10, 0, 720, "month", null],
  [10, 12, 24, "day", null],
  [-14, 24, 720, "month", -420],
] as const)("projects spend %s over %s/%s hours (%s)", (spent, elapsed, hours, kind, expected) => {
  expect(forecast(spent, elapsed, hours, kind)).toBe(expected);
});
it.each([
  ["2026-11-04T00:31:58Z", 58.26, 578.3206060095],
  ["2026-11-04T03:15:00Z", 58.26, 557.4378737542],
  ["2026-11-04T14:15:00+11:00", 58.26, 557.4378737542],
  ["2024-02-15T00:00:00Z", 196, 406],
  ["2026-01-15T00:00:00Z", 196, 434],
] as const)("uses actual UTC month hours at %s", (at, spent, expected) => {
  const p = period(new Date(at), "month");
  expect(forecast(spent, p.elapsedHours, p.hours, "month")).toBeCloseTo(expected, 8);
});
it("has no month run rate at the UTC rollover", () => {
  const p = period(new Date("2026-12-01T11:00:00+11:00"), "month");
  expect(forecast(0, p.elapsedHours, p.hours, "month")).toBeNull();
});
it.each([shipped, solo, team])("validates examples", (c) =>
  expect(ConfigSchema.safeParse(c).success).toBe(true),
);
it.each([
  { channels: [{ id: "Bad", type: "slack", webhookUrlSecret: "SECRET_URL" }] },
  { budgets: [{ id: "b", name: "b", period: "day", amount: 1, thresholds: [80, 50] }] },
  { budgets: [{ id: "b", name: "b", period: "day", amount: 1, channels: ["missing"] }] },
  {
    tags: [
      { dimension: "agent", rules: [] },
      { dimension: "agent", rules: [] },
    ],
  },
  {
    budgets: [
      {
        id: "b",
        name: "b",
        period: "day",
        amount: 1,
        enforce: { actions: [{ type: "openrouter.disable_key", keyHash: "example" }] },
      },
    ],
  },
])("rejects bad config", (c) => expect(ConfigSchema.safeParse(c).success).toBe(false));
it("returns readable config errors", async () => {
  const c = await loadConfig({ display: { currency: "aud" } });
  expect(c.ok).toBe(false);
  if (!c.ok) expect(c.errors[0]).toContain("display.currency");
});
it("canonical hash input ignores object insertion order", () =>
  expect(canonical({ b: 1, a: { d: 2, c: 3 } })).toBe(canonical({ a: { c: 3, d: 2 }, b: 1 })));
it("redacts every credential family, bearer, channel URL and email", () => {
  const values = [
    ...["ant-", "admin-", "proj-", "or-"].map((p) =>
      ["sk", p, "synthetic1234567890123456789"].join("-"),
    ),
    ["sk", "abcdefghijklmnopqrstuv"].join("-"),
    ["re", "abcdefghijklmno"].join("_"),
    ["whsec", "a".repeat(24)].join("_"),
    ["tk", "a".repeat(16)].join("_"),
    "Bearer example-token",
    "hooks.slack.com/services/example",
    "https://ntfy.example.com/topic",
    "reader@example.com",
  ];
  for (const value of values) expect(redact(value)).toBe("[redacted]");
  expect(redact("x".repeat(400))).toHaveLength(300);
});
it("glob and tag first-match AND semantics", () => {
  expect(glob("BOT.*", "bot.example")).toBe(true);
  expect(glob("a?", "ab")).toBe(false);
  const config = ConfigSchema.parse({
    tags: [
      {
        dimension: "agent",
        rules: [
          {
            value: "first",
            match: { provider: "anthropic", apiKeyIds: ["example"], apiKeyName: "BOT*" },
          },
          { value: "second", match: {} },
        ],
      },
    ],
  });
  expect(
    matchTags(config, {
      provider: "anthropic",
      apiKeyId: "example",
      workspaceId: "",
      workspaceName: "",
      apiKeyName: "bot-one",
    }),
  ).toEqual({ agent: "first" });
});
it("allocates exact micros deterministically including negative credits", () => {
  expect(
    allocate(10, [
      { id: "a", quantity: 1 },
      { id: "b", quantity: 1 },
      { id: "c", quantity: 1 },
    ]),
  ).toEqual([
    { id: "a", amountMicros: 4 },
    { id: "b", amountMicros: 3 },
    { id: "c", amountMicros: 3 },
  ]);
  expect(
    allocate(-10, [
      { id: "a", quantity: 1 },
      { id: "b", quantity: 2 },
    ]).reduce((s, r) => s + r.amountMicros, 0),
  ).toBe(-10);
  expect(allocate(5, [])).toEqual([{ id: "", amountMicros: 5 }]);
});
it.each([
  ["batch", "batch"],
  ["flex_discount", "standard"],
  ["priority_on_demand", "priority"],
])("classifies tiers %s", (t, result) => expect(tierClass(t)).toBe(result));
it("estimates with override then learned rate, counts unpriced tokens", () => {
  const config = ConfigSchema.parse({
    pricing: {
      overrides: [{ provider: "openai", model: "example", metric: "output", usdPerMillion: 2 }],
    },
  });
  const rates = [
    { provider: "openai", model: "example", metric: "output", micros_per_million: 1000000 },
  ];
  expect(estimate("openai", "example", "output", 1000, config, rates)).toEqual({
    amountMicros: 2000,
    unpricedTokens: 0,
  });
  expect(estimate("openai", "other", "output", 1000, config, rates)).toEqual({
    amountMicros: 0,
    unpricedTokens: 1000,
  });
});
const rates = [
  { day: "2026-10-30", quote: "AUD", rate: 1.4, source: "test" },
  { day: "2026-11-02", quote: "AUD", rate: 1.5, source: "test" },
];
it("FX uses preceding day, earliest fallback, markup and tax", () => {
  expect(rateFor(rates, "2026-11-01", "AUD")?.rate).toBe(1.4);
  expect(rateFor(rates, "2026-10-01", "AUD")?.rate).toBe(1.4);
  expect(convert(1000000, "2026-11-02", "AUD", rates, 2, 10).amount).toBeCloseTo(1.683);
  expect(convert(1000000, "2026-11-02", "EUR", rates).missing).toBe(true);
});
it("evaluates thresholds, forecast gating and FX guard", () => {
  const budget = ConfigSchema.parse({
    budgets: [{ id: "test", name: "Test", period: "month", amount: 100, currency: "AUD" }],
  }).budgets[0];
  if (!budget) throw new Error("missing test budget");
  const value = evaluate(
    budget,
    [{ day: "2026-11-03", amount_micros: 60000000, basis: "billed" }],
    rates,
    NOW,
    0,
    0,
  );
  expect(value.spent).toBe(90);
  expect(value.thresholdsHit).toEqual([50, 80]);
  expect(value.status).toBe("warning");
  expect(value.forecastTriggered).toBe(false);
  expect(forecastTriggered(110, 100, 180, 720)).toBe(true);
  expect(
    evaluate(
      budget,
      [{ day: "2026-11-03", amount_micros: 60000000, basis: "billed" }],
      [],
      NOW,
      0,
      0,
    ).canEnforce,
  ).toBe(false);
});
it("safety rails fail closed and default to dry-run", () => {
  const c = ConfigSchema.parse({ enforcement: { protectedKeyIds: ["protected"] } });
  expect(mode("")).toBe("dry_run");
  expect(mode("off")).toBe("off");
  expect(guard(c, "protected", NOW.toISOString(), NOW.toISOString(), NOW, true)).toBe("protected");
  expect(guard(c, "example", NOW.toISOString(), null, NOW, true)).toBe("stale_data");
  expect(guard(c, "example", NOW.toISOString(), NOW.toISOString(), NOW, false)).toBe("missing_fx");
  expect(canRestore({ status: "active" }, { status: "inactive" })).toBe(false);
});
