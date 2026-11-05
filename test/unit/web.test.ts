import { expect, it } from "vitest";
import { valueAxis } from "../../src/web/chart";
import { tagLabels } from "../../src/web/format";

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
