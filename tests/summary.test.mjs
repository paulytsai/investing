import test from "node:test";
import assert from "node:assert/strict";
import { isComplete } from "../netlify/lib/summarize.mjs";

const piece = { headline: "Headline", body: "b".repeat(150) };
const full = { feature: "f".repeat(40), longTerm: piece, recent: piece, story: piece, bull: piece, bear: piece, technical: { support: [{ level: 1, reason: "a reason of some length" }], resistance: [{ level: 2, reason: "a reason of some length" }], comment: "c".repeat(60) } };

test("complete record passes", () => assert.equal(isComplete(full), true));
test("empty piece fails", () => assert.equal(isComplete({ ...full, recent: { headline: "", body: "" } }), false));
test("missing technical levels fail", () => assert.equal(isComplete({ ...full, technical: { support: [], resistance: [], comment: "" } }), false));
test("null fails", () => assert.equal(isComplete(null), false));
test("placeholder comment fails", () => assert.equal(isComplete({ ...full, technical: { ...full.technical, comment: "x" } }), false));
test("short body fails", () => assert.equal(isComplete({ ...full, bull: { headline: "h", body: "too short" } }), false));

test("shortDescription keeps the first sentence or two and stays under 200 characters", async () => {
  const { shortDescription } = await import("../netlify/lib/sectoranalysis.mjs");
  const text = "JPMorgan Chase & Co. operates as a financial services company worldwide. It operates through four segments: Consumer & Community Banking, Corporate & Investment Bank, Commercial Banking, and Asset & Wealth Management. The company offers deposit, investment and lending products.";
  const d = shortDescription(text);
  assert.equal(d, "JPMorgan Chase & Co. operates as a financial services company worldwide.");
  assert.ok(shortDescription("Short one. Second short one. Third.").startsWith("Short one. Second short one."));
  assert.ok(d.length <= 200);
  assert.equal(shortDescription(""), null);
});
