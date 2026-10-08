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
