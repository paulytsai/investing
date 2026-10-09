import test from "node:test";
import assert from "node:assert/strict";
import { isRunning, promotionBlock, shouldApplySubscription, checkoutBlock } from "../netlify/lib/billing.mjs";
import { subscriptionRecord } from "../netlify/lib/stripe.mjs";

const NOW = Date.parse("2026-10-10T00:00:00Z");
const future = "2026-11-10T00:00:00Z", past = "2026-09-10T00:00:00Z";

test("running subscriptions include a scheduled cancel until it ends", () => {
  assert.equal(isRunning({ id: "s", status: "active" }, NOW), true);
  assert.equal(isRunning({ id: "s", status: "on_trial" }, NOW), true);
  assert.equal(isRunning({ id: "s", status: "past_due" }, NOW), true);
  assert.equal(isRunning({ id: "s", status: "cancelled", endsAt: future }, NOW), true);
  assert.equal(isRunning({ id: "s", status: "cancelled", endsAt: past }, NOW), false);
  assert.equal(isRunning(null, NOW), false);
});

test("an ended subscription never replaces a running one", () => {
  const running = { id: "new", status: "active" };
  const oldEnded = { id: "old", status: "cancelled", endsAt: past };
  assert.equal(shouldApplySubscription(running, oldEnded, NOW), false, "old sub's final event must not lock the member out");
  assert.equal(shouldApplySubscription(oldEnded, running, NOW), true, "a new purchase replaces an ended one");
  assert.equal(shouldApplySubscription(running, { id: "new", status: "cancelled", endsAt: future }, NOW), true, "same subscription always updates");
  assert.equal(shouldApplySubscription(null, oldEnded, NOW), true);
});

test("promotion codes: monthly plan and first subscription only", () => {
  assert.equal(promotionBlock({}, "annual"), "coupon_monthly_only");
  assert.equal(promotionBlock({}, "monthly"), null);
  assert.equal(promotionBlock({ everSubscribed: true }, "monthly"), "coupon_new_only");
  assert.equal(promotionBlock({ subscription: { id: "sub_1" } }, "monthly"), "coupon_new_only");
});

test("checkout is refused while a subscription runs or for complimentary members", () => {
  assert.equal(checkoutBlock({ username: "stripetest1", plan: "free" }, NOW), "complimentary");
  assert.equal(checkoutBlock({ username: "stripetest1", subscription: { id: "s", status: "cancelled", endsAt: future } }, NOW), "already_subscribed");
  assert.equal(checkoutBlock({ username: "stripetest1", subscription: { id: "s", status: "cancelled", endsAt: past } }, NOW), null);
});

test("subscription records carry plan, interval, mode and the trial end", () => {
  const sub = { id: "sub_1", status: "trialing", livemode: false, customer: "cus_1", created: 1791500000, trial_end: 1794000000, cancel_at_period_end: false, metadata: { plan: "monthly" }, items: { data: [{ current_period_end: 1794000000, price: { id: "price_m", product: "prod_1", recurring: { interval: "month" } } }] } };
  const r = subscriptionRecord(sub);
  assert.equal(r.status, "on_trial");
  assert.equal(r.plan, "monthly");
  assert.equal(r.interval, "month");
  assert.equal(r.livemode, false);
  assert.equal(r.trialEndsAt, new Date(1794000000 * 1000).toISOString());
  assert.equal(subscriptionRecord({ ...sub, status: "active", cancel_at_period_end: true, cancel_at: 1794000000 }).status, "cancelled");
});
