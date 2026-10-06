// Billing: webhook signatures, idempotency and event ordering, test/live rules, checkout and the portal, plans from
// subscriptions, past_due grace, MRR changes, invoices, price sync, and the development mock checkout.
// Stripe's REST API is stubbed by replacing fetch for api.stripe.com only.
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.OWNER_EMAIL = "owner@example.com";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
process.env.CLAUDE_STUB = "true";
process.env.STRIPE_SECRET_KEY = "sk_test_dummy";

const { openDb, nowIso } = await import("../server/db.js");
const { createApp } = await import("../server/app.js");
const { config } = await import("../server/config.js");
const { resetRateLimits } = await import("../server/http.js");
const { planFor } = await import("../server/meter.js");
const { totpCode } = await import("../server/auth.js");
const { signWebhook, verifyWebhook, encodeForm, STRIPE_VERSION } = await import("../server/billing/stripe.js");
const { seedPlanPrices, PRICE_CATALOG } = await import("../server/billing/index.js");

// ---------- Stripe stub ----------
const stripe = { subs: new Map(), customers: [], sessions: [], portals: [], prices: [], calls: [], fail: null };
const realFetch = globalThis.fetch;
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(typeof url === "string" ? url : url.url);
  if (u.hostname !== "api.stripe.com") return realFetch(url, init);
  const method = init.method || "GET";
  const params = new URLSearchParams(method === "GET" ? u.search : init.body || "");
  stripe.calls.push({ method, path: u.pathname, params, headers: init.headers || {} });
  if (stripe.fail && stripe.fail.times > 0) { stripe.fail.times--; return json(stripe.fail.status, { error: { type: "api_error", message: "stub failure" } }); }
  let m;
  if (method === "GET" && (m = /^\/v1\/subscriptions\/(sub_\w+)$/.exec(u.pathname))) {
    const s = stripe.subs.get(m[1]);
    return s ? json(200, s) : json(404, { error: { type: "invalid_request_error", code: "resource_missing", param: "id", message: "No such subscription" } });
  }
  if (method === "POST" && u.pathname === "/v1/customers") { const id = "cus_stub" + (stripe.customers.length + 1); stripe.customers.push({ id, params }); return json(200, { id, object: "customer" }); }
  if (method === "POST" && u.pathname === "/v1/checkout/sessions") { const id = "cs_test_" + (stripe.sessions.length + 1); stripe.sessions.push({ id, params }); return json(200, { id, url: "https://checkout.stripe.com/c/pay/" + id }); }
  if (method === "GET" && u.pathname === "/v1/billing_portal/configurations") return json(200, { object: "list", data: [{ id: "bpc_1", metadata: { app: "company-model" } }] });
  if (method === "POST" && u.pathname === "/v1/billing_portal/sessions") { stripe.portals.push({ params }); return json(200, { id: "bps_1", url: "https://billing.stripe.com/p/session/test_1" }); }
  if (method === "GET" && u.pathname === "/v1/prices") return json(200, { object: "list", data: stripe.prices });
  return json(404, { error: { type: "invalid_request_error", message: `stub: unhandled ${method} ${u.pathname}` } });
};
const callsTo = (path, method = "GET") => stripe.calls.filter((c) => c.path === path && c.method === method).length;

// ---------- helpers ----------
const now = () => Math.floor(Date.now() / 1000);
const PRICE_IDS = { plus_month: "price_plus_m", plus_year: "price_plus_y", pro_month: "price_pro_m", pro_year: "price_pro_y" };
function stripeSub(id, { status = "active", lookup = "plus_month", currency = "usd", customer = null, userId = null, trialEnd = null, cancelAtPeriodEnd = false, livemode = false } = {}) {
  const t = now(), cat = PRICE_CATALOG.find((p) => p.lookup_key === lookup);
  return {
    id, object: "subscription", status, customer, currency, livemode, metadata: userId ? { user_id: userId } : {},
    cancel_at_period_end: cancelAtPeriodEnd, cancel_at: null, canceled_at: status === "canceled" ? t : null, trial_end: trialEnd,
    items: { object: "list", data: [{ id: "si_" + id, current_period_start: t, current_period_end: t + 30 * 86400,
      price: { id: PRICE_IDS[lookup], object: "price", lookup_key: lookup, currency: "usd", unit_amount: cat.currency_options.usd, recurring: { interval: cat.interval } } }] },
  };
}
let evSeq = 0;
const makeEvent = (type, object, { created = now(), livemode = false, id } = {}) => ({ id: id || `evt_test_${++evSeq}`, object: "event", api_version: STRIPE_VERSION, type, created, livemode, data: { object } });

function harness() {
  const db = openDb(":memory:");
  const app = createApp(db);
  db.setConfig("licences", { fmp_display: { signed_at: "2026-10-01" }, legal: { signed_at: "2026-10-01" }, edgar_tools_display: null });
  const h = {
    db, app,
    billing(enabled, live = false) { db.setConfig("billing", { enabled, live }); },
    async signIn(email) {
      resetRateLimits();
      if (email !== config.ownerEmail) db.run("INSERT INTO allowlist (email, role, invited_at) VALUES (?, 'user', ?) ON CONFLICT (email) DO NOTHING", email, nowIso());
      const j = { "content-type": "application/json" };
      await app.request("/auth/start", { method: "POST", headers: j, body: JSON.stringify({ email }) });
      const code = /(\d{6})/.exec(db.get("SELECT subject FROM dev_mail ORDER BY id DESC LIMIT 1").subject)[1];
      const r = await app.request("/auth/verify", { method: "POST", headers: j, body: JSON.stringify({ email, code }) });
      assert.equal(r.status, 200, "sign-in");
      const cookie = /cm_sid=[^;]+/.exec(r.headers.get("set-cookie"))[0];
      return { cookie, user: db.get("SELECT * FROM profiles WHERE email = ?", email) };
    },
    call(method, path, cookie, body) {
      const headers = { cookie };
      if (method !== "GET") headers["content-type"] = "application/json";
      return app.request(path, { method, headers, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) });
    },
    async webhook(ev, { secret = "whsec_test", t, header } = {}) {
      const raw = JSON.stringify(ev);
      return app.request("/webhooks/stripe", { method: "POST", headers: { "content-type": "application/json", "stripe-signature": header ?? signWebhook(raw, secret, t) }, body: raw });
    },
    linkCustomer(user, cus) { db.run("INSERT INTO customers (user_id, stripe_customer_id, created_at) VALUES (?, ?, ?)", user.id, cus, nowIso()); },
    sub(id) { return db.get("SELECT * FROM subscriptions WHERE id = ?", id); },
    eventRow(id) { return db.get("SELECT * FROM stripe_events WHERE id = ?", id); },
    changes(subId) { return db.all("SELECT * FROM subscription_changes WHERE subscription_id = ? ORDER BY id", subId); },
  };
  return h;
}
const seedPrices = (db) => seedPlanPrices(db, PRICE_CATALOG.map((p) => ({ id: PRICE_IDS[p.lookup_key], plan_id: p.plan_id, interval: p.interval, lookup_key: p.lookup_key, currency_options: p.currency_options })));

const H = harness();
seedPrices(H.db);
beforeEach(() => { resetRateLimits(); stripe.fail = null; config.stripeSecretKey = "sk_test_dummy"; config.production = false; H.billing(false, false); });

// ---------- signatures ----------
describe("webhook signatures", () => {
  const ev = () => makeEvent("customer.created", { id: "cus_x", object: "customer" });

  test("a good signature is accepted and recorded", async () => {
    const e = ev();
    const r = await H.webhook(e);
    assert.equal(r.status, 200);
    assert.equal(H.eventRow(e.id).status, "ignored"); // a type we don't handle
  });
  test("a wrong secret is refused and nothing is recorded", async () => {
    const e = ev();
    const r = await H.webhook(e, { secret: "whsec_other" });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).code, "bad_signature");
    assert.equal(H.eventRow(e.id), undefined);
  });
  test("a stale timestamp is refused", async () => {
    const r = await H.webhook(ev(), { t: now() - 301 });
    assert.equal(r.status, 400);
  });
  test("a missing or malformed header is refused", async () => {
    assert.equal((await H.webhook(ev(), { header: "" })).status, 400);
    assert.equal((await H.webhook(ev(), { header: "t=abc,v1=zz" })).status, 400);
  });
  test("any matching v1 signature is enough (secret rolling)", async () => {
    const e = ev(), raw = JSON.stringify(e), t = now();
    const good = signWebhook(raw, "whsec_test", t).split("v1=")[1];
    const r = await H.webhook(e, { header: `t=${t},v1=${"0".repeat(64)},v1=${good},v0=abc` });
    assert.equal(r.status, 200);
  });
  test("verifyWebhook: tampered bodies and future timestamps fail", () => {
    const raw = '{"id":"evt_1"}', t = now();
    const header = signWebhook(raw, "whsec_test", t);
    assert.equal(verifyWebhook(raw, header, "whsec_test"), t);
    assert.throws(() => verifyWebhook(raw + " ", header, "whsec_test"));
    assert.throws(() => verifyWebhook(raw, signWebhook(raw, "whsec_test", t + 600), "whsec_test"));
    assert.equal(verifyWebhook(raw, header, "whsec_old, whsec_test"), t); // either of two configured secrets
  });
  test("form encoding uses Stripe's brackets", () => {
    assert.equal(encodeForm({ a: 1, b: { c: [true, "x y"] }, d: undefined }), "a=1&b[c][0]=true&b[c][1]=x%20y");
  });
});

// ---------- idempotency and ordering ----------
describe("event handling", () => {
  test("the same event twice is applied once", async () => {
    const { user } = await H.signIn("idem@example.com");
    H.linkCustomer(user, "cus_idem");
    stripe.subs.set("sub_idem", stripeSub("sub_idem", { customer: "cus_idem" }));
    const e = makeEvent("customer.subscription.created", stripe.subs.get("sub_idem"));
    const before = callsTo("/v1/subscriptions/sub_idem");
    assert.equal((await H.webhook(e)).status, 200);
    const r2 = await H.webhook(e);
    assert.equal(r2.status, 200);
    assert.equal((await r2.json()).duplicate, true);
    assert.equal(callsTo("/v1/subscriptions/sub_idem") - before, 1);
    assert.equal(H.eventRow(e.id).status, "processed");
    const ch = H.changes("sub_idem");
    assert.equal(ch.length, 1);
    assert.equal(ch[0].kind, "new");
    assert.equal(ch[0].to_mrr_usd, 19);
  });

  test("an older event doesn't overwrite a newer one", async () => {
    const { user } = await H.signIn("order@example.com");
    H.linkCustomer(user, "cus_order");
    const t = now();
    stripe.subs.set("sub_order", stripeSub("sub_order", { customer: "cus_order", lookup: "pro_month" }));
    await H.webhook(makeEvent("customer.subscription.updated", stripe.subs.get("sub_order"), { created: t }));
    assert.equal(H.sub("sub_order").plan_id, "pro");
    assert.equal(H.sub("sub_order").last_event_created, t);

    stripe.subs.set("sub_order", stripeSub("sub_order", { customer: "cus_order", lookup: "plus_month" }));
    const calls = callsTo("/v1/subscriptions/sub_order");
    const old = makeEvent("customer.subscription.updated", stripe.subs.get("sub_order"), { created: t - 100 });
    assert.equal((await H.webhook(old)).status, 200);
    assert.equal(H.sub("sub_order").plan_id, "pro");
    assert.equal(H.eventRow(old.id).status, "ignored");
    assert.equal(callsTo("/v1/subscriptions/sub_order"), calls, "a stale event isn't even fetched");

    await H.webhook(makeEvent("customer.subscription.updated", stripe.subs.get("sub_order"), { created: t + 10 }));
    assert.equal(H.sub("sub_order").plan_id, "plus");
    const ch = H.changes("sub_order").at(-1);
    assert.equal(ch.kind, "downgrade");
    assert.equal(ch.from_mrr_usd, 49);
    assert.equal(ch.to_mrr_usd, 19);
  });

  test("the subscription is re-fetched rather than taken from the payload", async () => {
    const { user } = await H.signIn("refetch@example.com");
    H.linkCustomer(user, "cus_refetch");
    stripe.subs.set("sub_refetch", stripeSub("sub_refetch", { customer: "cus_refetch", lookup: "pro_year" }));
    const payload = stripeSub("sub_refetch", { customer: "cus_refetch", lookup: "plus_month" }); // stale copy
    await H.webhook(makeEvent("customer.subscription.updated", payload));
    const s = H.sub("sub_refetch");
    assert.equal(s.plan_id, "pro");
    assert.equal(s.interval, "year");
    assert.equal(H.changes("sub_refetch")[0].to_mrr_usd, 40.83); // 490 / 12
  });

  test("a Stripe failure marks the event failed (500) and a retry processes it", async () => {
    const { user } = await H.signIn("retry@example.com");
    H.linkCustomer(user, "cus_retry");
    stripe.subs.set("sub_retry", stripeSub("sub_retry", { customer: "cus_retry" }));
    const e = makeEvent("customer.subscription.created", stripe.subs.get("sub_retry"));
    stripe.fail = { times: 2, status: 500 }; // the helper retries a GET once
    const r = await H.webhook(e);
    assert.equal(r.status, 500);
    assert.equal(H.eventRow(e.id).status, "failed");
    assert.match(H.eventRow(e.id).error, /stub failure/);
    assert.equal((await H.webhook(e)).status, 200);
    assert.equal(H.eventRow(e.id).status, "processed");
    assert.equal(H.sub("sub_retry").status, "active");
  });

  test("a subscription for an unknown customer is ignored, not retried", async () => {
    stripe.subs.set("sub_stranger", stripeSub("sub_stranger", { customer: "cus_nobody" }));
    const e = makeEvent("customer.subscription.created", stripe.subs.get("sub_stranger"));
    assert.equal((await H.webhook(e)).status, 200);
    assert.equal(H.eventRow(e.id).status, "ignored");
    assert.equal(H.sub("sub_stranger"), undefined);
  });
});

// ---------- test vs live ----------
describe("livemode rules", () => {
  test("live events are ignored while billing is in test mode (or off)", async () => {
    const { user } = await H.signIn("live1@example.com");
    H.linkCustomer(user, "cus_live1");
    stripe.subs.set("sub_live1", stripeSub("sub_live1", { customer: "cus_live1", livemode: true }));
    const calls = callsTo("/v1/subscriptions/sub_live1");
    const e = makeEvent("customer.subscription.created", stripe.subs.get("sub_live1"), { livemode: true });
    assert.equal((await H.webhook(e)).status, 200);
    assert.equal(H.eventRow(e.id).status, "ignored");
    H.billing(false, true); // live chosen but billing still off: still ignored
    const e2 = makeEvent("customer.subscription.created", stripe.subs.get("sub_live1"), { livemode: true });
    await H.webhook(e2);
    assert.equal(H.eventRow(e2.id).status, "ignored");
    assert.equal(callsTo("/v1/subscriptions/sub_live1"), calls);
    assert.equal(H.sub("sub_live1"), undefined);
  });
  test("once live, test events are ignored and live ones applied", async () => {
    const { user } = await H.signIn("live2@example.com");
    H.linkCustomer(user, "cus_live2");
    H.billing(true, true);
    stripe.subs.set("sub_test2", stripeSub("sub_test2", { customer: "cus_live2" }));
    const t = makeEvent("customer.subscription.created", stripe.subs.get("sub_test2"));
    await H.webhook(t);
    assert.equal(H.eventRow(t.id).status, "ignored");
    stripe.subs.set("sub_live2", stripeSub("sub_live2", { customer: "cus_live2", livemode: true }));
    const l = makeEvent("customer.subscription.created", stripe.subs.get("sub_live2"), { livemode: true });
    await H.webhook(l);
    assert.equal(H.eventRow(l.id).status, "processed");
    assert.equal(H.sub("sub_live2").livemode, 1);
    assert.equal(planFor(H.db, user).planId, "plus");
  });
});

// ---------- checkout and portal ----------
describe("checkout and portal", () => {
  test("refused while billing is off", async () => {
    const { cookie } = await H.signIn("off@example.com");
    const r = await H.call("POST", "/api/billing/checkout", cookie, { plan: "plus", interval: "month" });
    assert.equal(r.status, 409);
    assert.equal((await r.json()).code, "billing_off");
    const p = await H.call("POST", "/api/billing/portal", cookie, {});
    assert.equal(p.status, 409);
    assert.equal((await p.json()).code, "billing_off");
  });

  test("creates a customer once and a subscription Checkout Session", async () => {
    H.billing(true, false);
    const { cookie, user } = await H.signIn("buyer@example.com");
    const nCus = stripe.customers.length;
    const r = await H.call("POST", "/api/billing/checkout", cookie, { plan: "plus", interval: "month", currency: "jpy", lang: "ja" });
    assert.equal(r.status, 200);
    assert.match((await r.json()).url, /^https:\/\/checkout\.stripe\.com\//);
    assert.equal(stripe.customers.length, nCus + 1);
    assert.equal(stripe.customers.at(-1).params.get("metadata[user_id]"), user.id);
    assert.equal(H.db.get("SELECT stripe_customer_id FROM customers WHERE user_id = ?", user.id).stripe_customer_id, stripe.customers.at(-1).id);
    const s = stripe.sessions.at(-1).params, call = stripe.calls.findLast((c) => c.path === "/v1/checkout/sessions");
    assert.equal(call.headers.authorization, "Bearer sk_test_dummy");
    assert.equal(call.headers["stripe-version"], STRIPE_VERSION);
    assert.equal(s.get("mode"), "subscription");
    assert.equal(s.get("client_reference_id"), user.id);
    assert.equal(s.get("customer"), stripe.customers.at(-1).id);
    assert.equal(s.get("line_items[0][price]"), "price_plus_m");
    assert.equal(s.get("currency"), "jpy");
    assert.equal(s.get("success_url"), `${config.baseUrl}/account?checkout=success`);
    assert.equal(s.get("cancel_url"), `${config.baseUrl}/account?checkout=cancel`);
    assert.equal(s.get("automatic_tax[enabled]"), "true");
    assert.equal(s.get("allow_promotion_codes"), "true");
    assert.equal(s.get("customer_update[address]"), "auto");
    assert.equal(s.get("locale"), "ja");
    assert.equal(s.get("subscription_data[metadata][user_id]"), user.id);
    assert.equal(s.get("subscription_data[trial_period_days]"), null);

    // a second attempt (a trial this time) reuses the customer
    const r2 = await H.call("POST", "/api/billing/checkout", cookie, { plan: "plus", interval: "year", currency: "twd", trial: true });
    assert.equal(r2.status, 200);
    assert.equal(stripe.customers.length, nCus + 1);
    const s2 = stripe.sessions.at(-1).params;
    assert.equal(s2.get("subscription_data[trial_period_days]"), "14");
    assert.equal(s2.get("line_items[0][price]"), "price_plus_y");
  });

  test("validates input and refuses a second subscription or a second trial", async () => {
    H.billing(true, false);
    const { cookie, user } = await H.signIn("subbed@example.com");
    assert.equal((await H.call("POST", "/api/billing/checkout", cookie, { plan: "gold" })).status, 400);
    assert.equal((await H.call("POST", "/api/billing/checkout", cookie, { plan: "plus", currency: "eur" })).status, 400);
    H.db.run("UPDATE profiles SET trial_used = 1 WHERE id = ?", user.id);
    const t = await H.call("POST", "/api/billing/checkout", cookie, { plan: "pro", trial: true });
    assert.equal((await t.json()).code, "trial_used");
    H.linkCustomer(user, "cus_subbed");
    stripe.subs.set("sub_subbed", stripeSub("sub_subbed", { customer: "cus_subbed" }));
    await H.webhook(makeEvent("customer.subscription.created", stripe.subs.get("sub_subbed")));
    const r = await H.call("POST", "/api/billing/checkout", cookie, { plan: "pro", interval: "month" });
    assert.equal(r.status, 409);
    const body = await r.json();
    assert.equal(body.code, "already_subscribed");
    assert.equal(body.portal, true);
  });

  test("a test key with live billing is refused", async () => {
    H.billing(true, true);
    const { cookie } = await H.signIn("mismatch@example.com");
    const r = await H.call("POST", "/api/billing/checkout", cookie, { plan: "plus" });
    assert.equal(r.status, 503);
    assert.equal((await r.json()).code, "mode_mismatch");
  });

  test("the portal opens a Stripe session for the customer", async () => {
    H.billing(true, false);
    const { cookie, user } = await H.signIn("portal@example.com");
    const none = await H.call("POST", "/api/billing/portal", cookie, {});
    assert.equal(none.status, 404);
    H.linkCustomer(user, "cus_portal");
    const r = await H.call("POST", "/api/billing/portal", cookie, {});
    assert.equal(r.status, 200);
    assert.match((await r.json()).url, /^https:\/\/billing\.stripe\.com\//);
    const p = stripe.portals.at(-1).params;
    assert.equal(p.get("customer"), "cus_portal");
    assert.equal(p.get("return_url"), `${config.baseUrl}/account`);
    assert.equal(p.get("configuration"), "bpc_1");
  });
});

// ---------- plans from subscriptions ----------
describe("subscriptions and plans", () => {
  test("checkout.session.completed links the customer and grants the plan once billing is on", async () => {
    const { user } = await H.signIn("granted@example.com");
    stripe.subs.set("sub_granted", stripeSub("sub_granted", { customer: "cus_granted", lookup: "pro_month", userId: user.id }));
    const session = { id: "cs_test_x", object: "checkout.session", mode: "subscription", client_reference_id: user.id, customer: "cus_granted", subscription: "sub_granted", metadata: { user_id: user.id } };
    assert.equal((await H.webhook(makeEvent("checkout.session.completed", session))).status, 200);
    assert.equal(H.db.get("SELECT stripe_customer_id FROM customers WHERE user_id = ?", user.id).stripe_customer_id, "cus_granted");
    assert.equal(H.sub("sub_granted").user_id, user.id);
    assert.equal(planFor(H.db, user).planId, "comp", "billing off: invited users stay complimentary");
    H.billing(true, false);
    const p = planFor(H.db, user);
    assert.equal(p.planId, "pro");
    assert.equal(p.source, "subscription");
    assert.ok(H.db.get("SELECT 1 FROM audit_log WHERE action = 'billing.subscription' AND target = 'sub_granted'"));
  });

  test("a trial runs on the trial plan and becomes the paid plan", async () => {
    H.billing(true, false);
    const { user } = await H.signIn("trialist@example.com");
    H.linkCustomer(user, "cus_trialist");
    const t = now();
    stripe.subs.set("sub_trial", stripeSub("sub_trial", { customer: "cus_trialist", status: "trialing", trialEnd: t + 14 * 86400 }));
    await H.webhook(makeEvent("customer.subscription.created", stripe.subs.get("sub_trial"), { created: t }));
    assert.equal(planFor(H.db, user).planId, "trial");
    assert.equal(H.db.get("SELECT trial_used FROM profiles WHERE id = ?", user.id).trial_used, 1);
    assert.equal(H.changes("sub_trial")[0].to_mrr_usd, 0);
    stripe.subs.set("sub_trial", stripeSub("sub_trial", { customer: "cus_trialist", trialEnd: t }));
    await H.webhook(makeEvent("customer.subscription.updated", stripe.subs.get("sub_trial"), { created: t + 1 }));
    assert.equal(planFor(H.db, user).planId, "plus");
    const up = H.changes("sub_trial").at(-1);
    assert.deepEqual([up.kind, up.from_plan, up.to_plan, up.to_mrr_usd], ["upgrade", "trial", "plus", 19]);
  });

  test("past_due keeps the plan for a 7-day grace, then lapses", async () => {
    H.billing(true, false);
    const { user } = await H.signIn("pastdue@example.com");
    H.linkCustomer(user, "cus_pastdue");
    const t = now();
    stripe.subs.set("sub_pd", stripeSub("sub_pd", { customer: "cus_pastdue", status: "past_due" }));
    await H.webhook(makeEvent("customer.subscription.updated", stripe.subs.get("sub_pd"), { created: t }));
    const g = Date.parse(H.sub("sub_pd").grace_until);
    assert.ok(Math.abs(g - (Date.now() + 7 * 864e5)) < 60e3, "grace is a week from now");
    assert.equal(planFor(H.db, user).planId, "plus");
    // a later retry failure doesn't extend the grace
    await H.webhook(makeEvent("customer.subscription.updated", stripe.subs.get("sub_pd"), { created: t + 5 }));
    assert.equal(Date.parse(H.sub("sub_pd").grace_until), g);
    H.db.run("UPDATE subscriptions SET grace_until = ? WHERE id = 'sub_pd'", new Date(Date.now() - 1000).toISOString());
    assert.equal(planFor(H.db, user).planId, "free");
    // paid again: active, grace cleared
    stripe.subs.set("sub_pd", stripeSub("sub_pd", { customer: "cus_pastdue" }));
    await H.webhook(makeEvent("customer.subscription.updated", stripe.subs.get("sub_pd"), { created: t + 10 }));
    assert.equal(H.sub("sub_pd").grace_until, null);
    assert.equal(planFor(H.db, user).planId, "plus");
  });

  test("deletion is churn, then a new subscription is a reactivation", async () => {
    H.billing(true, false);
    const { user } = await H.signIn("churner@example.com");
    H.linkCustomer(user, "cus_churner");
    const t = now();
    stripe.subs.set("sub_churn", stripeSub("sub_churn", { customer: "cus_churner" }));
    await H.webhook(makeEvent("customer.subscription.created", stripe.subs.get("sub_churn"), { created: t }));
    assert.equal(planFor(H.db, user).planId, "plus");
    // Stripe no longer returns it: the event's own copy is used
    const gone = stripeSub("sub_churn", { customer: "cus_churner", status: "canceled" });
    stripe.subs.delete("sub_churn");
    const e = makeEvent("customer.subscription.deleted", gone, { created: t + 1 });
    assert.equal((await H.webhook(e)).status, 200);
    assert.equal(H.eventRow(e.id).status, "processed");
    assert.equal(H.sub("sub_churn").status, "canceled");
    const churn = H.changes("sub_churn").at(-1);
    assert.deepEqual([churn.kind, churn.from_plan, churn.from_mrr_usd, churn.to_mrr_usd], ["churn", "plus", 19, 0]);
    assert.equal(planFor(H.db, user).planId, "free");
    stripe.subs.set("sub_back", stripeSub("sub_back", { customer: "cus_churner", lookup: "pro_month" }));
    await H.webhook(makeEvent("customer.subscription.created", stripe.subs.get("sub_back"), { created: t + 2 }));
    assert.equal(H.changes("sub_back")[0].kind, "reactivate");
    assert.equal(planFor(H.db, user).planId, "pro");
  });
});

// ---------- invoices and status ----------
describe("invoices and status", () => {
  test("invoices are upserted, don't move backwards, and show in the status", async () => {
    H.billing(true, false);
    const { user, cookie } = await H.signIn("invoiced@example.com");
    H.linkCustomer(user, "cus_inv");
    const t = now();
    stripe.subs.set("sub_inv", stripeSub("sub_inv", { customer: "cus_inv", currency: "jpy" }));
    const inv = (status, extra = {}) => ({ id: "in_1", object: "invoice", customer: "cus_inv", status, currency: "jpy", amount_due: 2900, amount_paid: status === "paid" ? 2900 : 0,
      total_taxes: [{ amount: 264 }], created: t, hosted_invoice_url: "https://invoice.stripe.com/i/acct_1/test_1",
      parent: { type: "subscription_details", subscription_details: { subscription: "sub_inv", metadata: { user_id: user.id } } }, ...extra });
    await H.webhook(makeEvent("invoice.paid", inv("paid"), { created: t }));
    let row = H.db.get("SELECT * FROM invoices WHERE id = 'in_1'");
    assert.deepEqual([row.user_id, row.subscription_id, row.status, row.amount_paid, row.tax], [user.id, "sub_inv", "paid", 2900, 264]);
    assert.equal(H.sub("sub_inv").unit_amount, 2900, "amount in the subscription's currency");
    await H.webhook(makeEvent("invoice.finalized", inv("open"), { created: t - 5 }));
    row = H.db.get("SELECT * FROM invoices WHERE id = 'in_1'");
    assert.equal(row.status, "paid");
    assert.equal(row.amount_paid, 2900);

    const s = await (await H.call("GET", "/api/billing/status", cookie)).json();
    assert.equal(s.enabled, true);
    assert.equal(s.live, false);
    assert.deepEqual(s.plans.map((p) => p.id), ["free", "trial", "plus", "pro"]);
    assert.ok(s.plans.find((p) => p.id === "plus").prices.some((x) => x.interval === "month" && x.currency === "jpy" && x.amount === 2900));
    assert.ok(s.plans.find((p) => p.id === "pro").prices.some((x) => x.interval === "year" && x.currency === "twd" && x.amount === 1490000));
    assert.equal(s.current.plan, "plus");
    assert.equal(s.current.source, "subscription");
    assert.equal(s.current.subscription.status, "active");
    assert.equal(s.current.subscription.interval, "month");
    assert.equal(s.current.subscription.cancel_at_period_end, false);
    assert.ok(s.current.subscription.current_period_end);
    assert.equal(s.invoices.length, 1);
    assert.equal(s.invoices[0].hosted_invoice_url, "https://invoice.stripe.com/i/acct_1/test_1");
    assert.equal(s.hasPortal, true);
  });

  test("a payment failure is recorded and audited", async () => {
    H.billing(true, false);
    const { user } = await H.signIn("failed@example.com");
    H.linkCustomer(user, "cus_failed");
    stripe.subs.set("sub_failed", stripeSub("sub_failed", { customer: "cus_failed", status: "past_due" }));
    const inv = { id: "in_failed", object: "invoice", customer: "cus_failed", status: "open", currency: "usd", amount_due: 1900, amount_paid: 0, created: now(),
      hosted_invoice_url: "javascript:alert(1)", subscription: "sub_failed" }; // the older shape, and a URL that must not be kept
    await H.webhook(makeEvent("invoice.payment_failed", inv));
    const row = H.db.get("SELECT * FROM invoices WHERE id = 'in_failed'");
    assert.equal(row.user_id, user.id);
    assert.equal(row.hosted_invoice_url, null);
    assert.equal(H.sub("sub_failed").status, "past_due");
    assert.ok(H.db.get("SELECT 1 FROM audit_log WHERE action = 'billing.payment_failed' AND actor_id = ?", user.id));
  });
});

// ---------- price sync (owner) ----------
describe("price sync", () => {
  test("owner-only; upserts by lookup key and retires the old price", async () => {
    const { cookie: userCookie } = await H.signIn("notowner@example.com");
    assert.equal((await H.call("POST", "/api/billing/admin/sync-prices", userCookie, {})).status, 403);

    const { cookie } = await H.signIn("owner@example.com");
    const setup = await (await H.call("POST", "/auth/totp/setup", cookie, {})).json();
    const enable = await H.call("POST", "/auth/totp/enable", cookie, { code: totpCode(setup.secret, Math.floor(Date.now() / 30000)) });
    assert.equal(enable.status, 200);
    stripe.prices = PRICE_CATALOG.map((p) => ({ id: "price_new_" + p.lookup_key, object: "price", lookup_key: p.lookup_key, currency: "usd", unit_amount: p.currency_options.usd,
      recurring: { interval: p.interval }, currency_options: { usd: { unit_amount: p.currency_options.usd }, jpy: { unit_amount: p.currency_options.jpy }, twd: { unit_amount: p.currency_options.twd } } }));
    const r = await H.call("POST", "/api/billing/admin/sync-prices", cookie, {});
    assert.equal(r.status, 200);
    const out = await r.json();
    assert.equal(out.prices.length, 4);
    assert.deepEqual(out.missing, []);
    const q = stripe.calls.findLast((c) => c.path === "/v1/prices").params;
    assert.deepEqual(q.getAll("lookup_keys[0]").concat(q.getAll("lookup_keys[3]")), ["plus_month", "pro_year"]);
    assert.equal(q.get("expand[0]"), "data.currency_options");
    const row = H.db.get("SELECT * FROM plan_prices WHERE id = 'price_new_pro_year'");
    assert.deepEqual([row.plan_id, row.interval, row.active], ["pro", "year", 1]);
    assert.deepEqual(JSON.parse(row.currency_options), { usd: 49000, jpy: 74000, twd: 1490000 });
    assert.equal(H.db.get("SELECT active FROM plan_prices WHERE id = 'price_pro_y'").active, 0);
    assert.ok(H.db.get("SELECT 1 FROM audit_log WHERE action = 'billing.prices_synced'"));
    seedPrices(H.db); // back to the ids the other tests use
  });
});

// ---------- mock mode ----------
describe("mock checkout (development, no Stripe key)", () => {
  const M = harness(); // a fresh database with no synced prices: the catalogue stands in

  test("the whole flow: checkout, complete, portal, cancel", async () => {
    config.stripeSecretKey = "";
    M.billing(true, false);
    const { cookie, user } = await M.signIn("mocker@example.com");
    const r = await M.call("POST", "/api/billing/checkout", cookie, { plan: "plus", interval: "year", currency: "usd" });
    assert.equal(r.status, 200);
    const { url, mock } = await r.json();
    assert.equal(mock, true);
    const token = /^\/account\?mock_checkout=([\w-]+)$/.exec(url)[1];

    const other = await M.signIn("snoop@example.com");
    assert.equal((await M.call("POST", "/api/billing/mock/complete", other.cookie, { token })).status, 400);

    const done = await M.call("POST", "/api/billing/mock/complete", cookie, { token });
    assert.equal(done.status, 200);
    const subId = (await done.json()).subscription;
    assert.match(subId, /^sub_mock_/);
    const s = M.sub(subId);
    assert.deepEqual([s.status, s.plan_id, s.interval, s.livemode, s.unit_amount], ["active", "plus", "year", 0, 19000]);
    assert.equal(planFor(M.db, user).planId, "plus");
    assert.equal(M.changes(subId)[0].kind, "new");
    assert.equal(M.changes(subId)[0].to_mrr_usd, 15.83);
    assert.equal((await M.call("POST", "/api/billing/mock/complete", cookie, { token })).status, 400, "a token works once");

    const st = await (await M.call("GET", "/api/billing/status", cookie)).json();
    assert.equal(st.mock, true);
    assert.equal(st.current.subscription.mock, true);
    assert.equal(st.hasPortal, true);
    assert.equal(st.invoices.length, 1);
    assert.equal(st.invoices[0].amount_paid, 19000);
    assert.ok(st.plans.find((p) => p.id === "plus").prices.length >= 6, "catalogue prices before any sync");

    const again = await M.call("POST", "/api/billing/checkout", cookie, { plan: "pro" });
    assert.equal((await again.json()).code, "already_subscribed");
    const portal = await (await M.call("POST", "/api/billing/portal", cookie, {})).json();
    assert.equal(portal.url, "/account?mock_portal=1");

    assert.equal((await M.call("POST", "/api/billing/mock/cancel", cookie, {})).status, 200);
    assert.equal(M.sub(subId).status, "canceled");
    assert.equal(M.changes(subId).at(-1).kind, "churn");
    assert.equal(planFor(M.db, user).planId, "free");
    assert.equal(M.db.get("SELECT COUNT(*) AS n FROM stripe_events").n, 0, "no Stripe involved");
  });

  test("a mock trial uses the trial plan, once", async () => {
    config.stripeSecretKey = "";
    M.billing(true, false);
    const { cookie, user } = await M.signIn("mocktrial@example.com");
    const { url } = await (await M.call("POST", "/api/billing/checkout", cookie, { plan: "plus", trial: true, currency: "twd" })).json();
    const token = new URL(url, "http://x").searchParams.get("mock_checkout");
    assert.equal((await M.call("POST", "/api/billing/mock/complete", cookie, { token })).status, 200);
    const s = M.db.get("SELECT * FROM subscriptions WHERE user_id = ?", user.id);
    assert.deepEqual([s.status, s.plan_id, s.currency], ["trialing", "trial", "twd"]);
    assert.ok(Math.abs(Date.parse(s.trial_end) - (Date.now() + 14 * 864e5)) < 60e3);
    assert.equal(planFor(M.db, user).planId, "trial");
    await M.call("POST", "/api/billing/mock/cancel", cookie, {});
    const t2 = await M.call("POST", "/api/billing/checkout", cookie, { plan: "plus", trial: true });
    assert.equal((await t2.json()).code, "trial_used");
  });

  test("impossible in production or with a Stripe key", async () => {
    M.billing(true, false);
    const { cookie } = await M.signIn("prod@example.com");
    config.stripeSecretKey = "";
    config.production = true;
    try {
      assert.equal((await M.call("POST", "/api/billing/mock/complete", cookie, { token: "x" })).status, 404);
      assert.equal((await M.call("POST", "/api/billing/mock/cancel", cookie, {})).status, 404);
      const r = await M.call("POST", "/api/billing/checkout", cookie, { plan: "plus" });
      assert.equal(r.status, 503, "no mock URL, no Stripe: refused");
    } finally { config.production = false; }
    config.stripeSecretKey = "sk_test_dummy";
    assert.equal((await M.call("POST", "/api/billing/mock/complete", cookie, { token: "x" })).status, 404);
  });
});

// ---------- the page ----------
describe("account page", () => {
  test("served under the strict CSP with no inline script", async () => {
    const r = await H.app.request("/account");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-security-policy"), /script-src 'self';/);
    const html = await r.text();
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    assert.ok(scripts.length >= 1);
    for (const m of scripts) { assert.match(m[1], /src="\/account\/account\.js"/); assert.equal(m[2].trim(), ""); }
    assert.doesNotMatch(html, /\son[a-z]+=/i, "no inline handlers");
    assert.equal((await H.app.request("/account/account.js")).status, 200);
  });
});
