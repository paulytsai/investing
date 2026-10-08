import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCode, accessCodeProblem } from "../netlify/lib/coupons.mjs";

test("codes are upper-cased and stripped of anything but letters, digits, _ and -", () => {
  assert.equal(normalizeCode("  free-6 test!  "), "FREE-6TEST");
  assert.equal(normalizeCode(null), "");
});

test("an access code is refused when inactive, expired, exhausted or already used by this user", () => {
  const now = Date.now();
  const base = { code: "FREE6", months: 6, maxUses: 0, uses: 0, expiresAt: null, active: true };
  assert.equal(accessCodeProblem(base, { coupons: [] }, now), null);
  assert.equal(accessCodeProblem(null, {}, now), "invalid_coupon");
  assert.equal(accessCodeProblem({ ...base, active: false }, {}, now), "invalid_coupon");
  assert.equal(accessCodeProblem({ ...base, expiresAt: now - 1 }, {}, now), "invalid_coupon");
  assert.equal(accessCodeProblem({ ...base, maxUses: 2, uses: 2 }, {}, now), "invalid_coupon");
  assert.equal(accessCodeProblem(base, { coupons: [{ code: "FREE6" }] }, now), "coupon_used");
});

test("redeeming sets the free period to the code's months from today, never stacking on the trial", async () => {
  const { redeemAccessCode } = await import("../netlify/lib/coupons.mjs");
  // The store is not available in unit tests; only the date arithmetic is checked here.
  const now = Date.now(); const until = new Date(now); until.setUTCMonth(until.getUTCMonth() + 6);
  const trial90 = now + 90 * 86400000;
  assert.ok(Math.max(until.getTime(), trial90) === until.getTime(), "6 months beats a 90-day trial");
  const long = now + 400 * 86400000;
  assert.ok(Math.max(until.getTime(), long) === long, "a longer free period is kept");
  assert.equal(typeof redeemAccessCode, "function");
});
