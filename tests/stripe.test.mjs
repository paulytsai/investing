import test from "node:test";
import assert from "node:assert/strict";
import { formEncode, verifyWebhook, signWebhook, subscriptionRecord } from "../netlify/lib/stripe.mjs";

test("form encoding nests objects and arrays the way Stripe expects", () => {
  const q = formEncode({ mode: "subscription", line_items: [{ price: "price_1", quantity: 1 }], metadata: { user_id: "u1" }, managed_payments: { enabled: true } }).toString();
  assert.equal(decodeURIComponent(q), "mode=subscription&line_items[0][price]=price_1&line_items[0][quantity]=1&metadata[user_id]=u1&managed_payments[enabled]=true");
});

test("webhook signatures verify with the endpoint secret and reject tampering and old timestamps", () => {
  const body = JSON.stringify({ id: "evt_1", type: "invoice.paid" });
  const header = signWebhook(body, "whsec_test");
  assert.equal(verifyWebhook(body, header, { secret: "whsec_test" }), true);
  assert.equal(verifyWebhook(body + " ", header, { secret: "whsec_test" }), false);
  assert.equal(verifyWebhook(body, header, { secret: "whsec_other" }), false);
  assert.equal(verifyWebhook(body, header, { secret: "whsec_test", now: Date.now() + 10 * 60 * 1000 }), false);
  assert.equal(verifyWebhook(body, null, { secret: "whsec_test" }), false);
});

test("subscription records map statuses, period end and cancel-at-period-end to the site's shape", () => {
  const end = 1_800_000_000;
  const active = subscriptionRecord({ id: "sub_1", status: "active", customer: "cus_1", current_period_end: end, items: { data: [{ price: { id: "price_1", product: "prod_1" } }] }, default_payment_method: { card: { brand: "visa", last4: "4242" } } });
  assert.equal(active.provider, "stripe"); assert.equal(active.status, "active"); assert.equal(active.renewsAt, new Date(end * 1000).toISOString()); assert.equal(active.cardLastFour, "4242"); assert.equal(active.variantId, "price_1");
  const cancelling = subscriptionRecord({ id: "sub_1", status: "active", cancel_at_period_end: true, cancel_at: end, customer: "cus_1" });
  assert.equal(cancelling.status, "cancelled"); assert.equal(cancelling.endsAt, new Date(end * 1000).toISOString()); assert.equal(cancelling.renewsAt, null);
  assert.equal(subscriptionRecord({ id: "s", status: "trialing", customer: "c" }).status, "on_trial");
  assert.equal(subscriptionRecord({ id: "s", status: "canceled", customer: "c", ended_at: end }).endsAt, new Date(end * 1000).toISOString());
});
