import { expect, it } from "vitest";
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
