import test from "node:test";
import assert from "node:assert/strict";
import { needsPolish, flaggedStrings, setPath, wantsPolish } from "../netlify/lib/polish.mjs";

test("standalone finding letters are flagged, tickers and quarters are not", () => {
  assert.equal(needsPolish("If margins fall for two years, Q tilts to weak."), true);
  assert.equal(needsPolish("Qは弱まる。"), true);
  assert.equal(needsPolish("TとVは逆方向を指している。"), true);
  assert.equal(needsPolish("Q3 2026 results, mid-October"), false);
  assert.equal(needsPolish("AT&T and T-Mobile raised prices; ASML Holding N.V. reported"), false);
  assert.equal(needsPolish("Visa (V) and Mastercard"), true, "a bare ticker is left to the model");
});

test("English assessment words count only outside English", () => {
  assert.equal(needsPolish("Vはdemandingに移る。", "ja"), true);
  assert.equal(needsPolish("利益率が低下すれば weak に傾く。", "ja"), true);
  assert.equal(needsPolish("The outlook is demanding.", "en"), false);
});

test("flagged strings skip code fields and carry their path", () => {
  const rec = { findings: { quality: { assessment: "weak", decisive: "If pricing fails, Q weakens." } }, risks: [{ risk: "Rates rise", indicator: "Spreads", finding: "V" }], checkpoints: [{ premise: "Tが改善する", finding: "T" }] };
  const f = flaggedStrings(rec, "ja");
  assert.deepEqual(f.map((x) => x.path.join(".")), ["findings.quality.decisive", "checkpoints.0.premise"]);
  setPath(rec, f[1].path, "セクターの方向性が改善する");
  assert.equal(rec.checkpoints[0].premise, "セクターの方向性が改善する");
  assert.equal(wantsPolish(rec, "ja"), true);
  rec.polishedAt = "2026-10-08T00:00:00Z";
  assert.equal(wantsPolish(rec, "ja"), false);
});
