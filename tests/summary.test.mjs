import test from "node:test";
import assert from "node:assert/strict";
import { isComplete } from "../netlify/lib/summarize.mjs";

const piece = { headline: "h", body: "b" };
const full = { feature: "f", longTerm: piece, recent: piece, change: piece, bull: piece, bear: piece, technical: { support: [{ level: 1, reason: "r" }], resistance: [{ level: 2, reason: "r" }], comment: "c" } };

test("complete record passes", () => assert.equal(isComplete(full), true));
test("empty piece fails", () => assert.equal(isComplete({ ...full, recent: { headline: "", body: "" } }), false));
test("missing technical levels fail", () => assert.equal(isComplete({ ...full, technical: { support: [], resistance: [], comment: "" } }), false));
test("null fails", () => assert.equal(isComplete(null), false));
