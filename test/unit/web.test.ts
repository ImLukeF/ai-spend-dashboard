import { expect, it } from "vitest";
import { valueAxis } from "../../src/web/chart";
import { freshnessState, jobStatus, tagLabels } from "../../src/web/format";

it.each([{}, null, undefined, []])("renders empty or missing tags without raw JSON: %j", (tags) => {
  expect(tagLabels(tags)).toEqual([]);
});
it("formats real tags as readable key=value labels", () => {
  expect(tagLabels({ team: "engineering", purpose: "support bot" })).toEqual([
    "team=engineering",
    "purpose=support bot",
  ]);
});

it.each(["USD", "AUD"])("labels spend and formats dollar ticks for %s", (currency) => {
  const axis = valueAxis(currency);
  expect(axis.title).toEqual({ display: true, text: `Spend (${currency})` });
  expect(axis.ticks.callback(14)).toMatch(/\$14\.00$/);
  expect(axis.ticks.callback("0")).toMatch(/\$0\.00$/);
  expect(axis.ticks.callback(-2.5)).toMatch(/-.*\$2\.50$/);
  expect(axis.ticks.callback(0.005)).toMatch(/\$0\.005$/);
});
it("uses the returned currency rather than assuming dollars", () => {
  expect(valueAxis("EUR").ticks.callback(14)).toContain("€");
});
it("keeps hourly token usage free of currency units", () => {
  const axis = valueAxis();
  expect(axis.title).toEqual({ display: true, text: "Tokens" });
  expect(axis.ticks.callback(14000)).toBe("14,000");
});
it.each([
  [{ job: "openai.backfill", provider: "openai", cursor: "done" }, "Complete"],
  [{ job: "openai.cost_daily", provider: "openai", consecutive_failures: 3 }, "Failing (3)"],
  [{ job: "openrouter.cost_daily", provider: "openrouter" }, "Paused"],
  [{ job: "openai.cost_daily", provider: "openai", consecutive_failures: 0 }, "OK"],
])("shows the real state of sync job %j", (job, expected) => {
  const providers = [
    { provider: "openai", status: "configured" },
    { provider: "openrouter", status: "disabled" },
  ];
  expect(jobStatus(job, providers)).toBe(expected);
});
it.each([
  [[], "none"],
  [[{ lastSuccessAt: "2026-11-04T03:00:00Z", stale: false }], "fresh"],
  [[{ lastSuccessAt: "2026-11-04T02:00:00Z", stale: true }], "stale"],
  [[{ lastSuccessAt: null, stale: true }], "old"],
  [[{ lastSuccessAt: "2026-11-03T23:00:00Z", stale: true }], "old"],
])("header freshness for %j is %s", (freshness, expected) => {
  expect(freshnessState(freshness, Date.parse("2026-11-04T03:15:00Z"))).toBe(expected);
});
