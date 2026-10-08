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
