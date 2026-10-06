// Billing: Stripe Checkout for the paid plans, the customer portal, and the webhook that keeps subscriptions in step.
// Off until the owner switches it on in the admin settings (after the display licence and the legal check); the webhook
// verifies and records events either way, so test mode can be exercised. In development without a Stripe key, a mock
// checkout stands in so the whole flow can be tried; it can't run in production.
import crypto from "node:crypto";
import { Hono } from "hono";
import { config } from "../config.js";
import { nowIso } from "../db.js";
import { fail, rateLimit, ApiError } from "../http.js";
import { requireUser, requireOwner } from "../auth.js";
import { billingEnabled, planFor } from "../meter.js";
import { stripe, verifyWebhook, keyIsLive, StripeError } from "./stripe.js";

const DAY = 864e5;
const GRACE_DAYS = 7, TRIAL_DAYS = 14;
const PAID_PLANS = ["plus", "pro"], INTERVALS = ["month", "year"], CURRENCIES = ["usd", "jpy", "twd"];
const SHOWN_PLANS = ["free", "trial", "plus", "pro"];
// statuses that grant a plan (meter.js applies the past_due grace) and so count towards MRR movements
const LIVE = new Set(["active", "trialing", "past_due"]);
// statuses Stripe still bills or can revive: a second checkout would double up, so these go to the portal instead
const OPEN = ["active", "trialing", "past_due", "unpaid", "paused"];
const OPEN_SQL = OPEN.map((s) => `'${s}'`).join(", ");

// What we sell, by Stripe lookup key. Minor units: JPY has none; TWD has two in Stripe's API (NT$590 = 59000).
export const PRICE_CATALOG = [
  { lookup_key: "plus_month", plan_id: "plus", interval: "month", currency_options: { usd: 1900, jpy: 2900, twd: 59000 } },
  { lookup_key: "plus_year", plan_id: "plus", interval: "year", currency_options: { usd: 19000, jpy: 29000, twd: 590000 } },
  { lookup_key: "pro_month", plan_id: "pro", interval: "month", currency_options: { usd: 4900, jpy: 7400, twd: 149000 } },
  { lookup_key: "pro_year", plan_id: "pro", interval: "year", currency_options: { usd: 49000, jpy: 74000, twd: 1490000 } },
];
export const PRODUCTS = [
  { id: "cm_plus", plan_id: "plus", name: "Plus", description: "Company model: Plus plan" },
  { id: "cm_pro", plan_id: "pro", name: "Pro", description: "Company model: Pro plan" },
];
export const LOOKUP_KEYS = PRICE_CATALOG.map((p) => p.lookup_key);
// marks the customer portal configuration that scripts/stripe-setup.js creates
export const PORTAL_TAG = "company-model";

const idOf = (x) => (x && typeof x === "object" ? x.id : x) || null;
const safeJson = (s) => { try { return JSON.parse(s); } catch (e) { return null; } };
const isoOf = (sec) => (Number.isFinite(sec) && sec > 0 ? new Date(sec * 1000).toISOString() : null);
const billingCfg = (db) => db.getConfig("billing") || { enabled: false, live: false };

// mock checkout: development only, and only while no Stripe key is set
export const mockMode = () => !config.production && !config.stripeSecretKey;
// Which Stripe mode's events and subscriptions count: live only once billing is on and switched to live. While
// billing is off, live events are ignored and test events still run, so the test flow can be tried end to end.
const acceptLive = (db) => { const b = billingCfg(db); return !!(b.enabled && b.live); };

// ---------- prices ----------
const parsePrice = (r) => ({ ...r, currency_options: safeJson(r.currency_options) || {} });
function priceRows(db) {
  const rows = db.all("SELECT * FROM plan_prices WHERE active = 1 ORDER BY plan_id, interval, rowid").map(parsePrice);
  if (rows.length || !mockMode()) return rows;
  // mock mode before any prices are synced: the catalogue under made-up ids
  return PRICE_CATALOG.map((p) => ({ id: "price_mock_" + p.lookup_key, active: 1, ...p }));
}
const priceFor = (db, planId, interval) => priceRows(db).filter((r) => r.plan_id === planId && r.interval === interval).at(-1) || null;

// upsert price rows {id, plan_id, interval, lookup_key, currency_options}; a lookup key points at one active price
export function seedPlanPrices(db, rows) {
  db.tx(() => {
    for (const r of rows) {
      db.run(`INSERT INTO plan_prices (id, plan_id, interval, lookup_key, currency_options, active) VALUES (?, ?, ?, ?, ?, 1)
              ON CONFLICT (id) DO UPDATE SET plan_id = excluded.plan_id, interval = excluded.interval, lookup_key = excluded.lookup_key,
              currency_options = excluded.currency_options, active = 1`, r.id, r.plan_id, r.interval, r.lookup_key || null, JSON.stringify(r.currency_options));
      if (r.lookup_key) db.run("UPDATE plan_prices SET active = 0 WHERE lookup_key = ? AND id <> ?", r.lookup_key, r.id);
    }
  });
}

// a Stripe price (with currency_options expanded) as a plan_prices row, or null when it isn't one of ours
export function priceRowFromStripe(price) {
  const plan = /^(plus|pro)_(month|year)$/.exec(price?.lookup_key || "")?.[1] || price?.metadata?.plan_id;
  const interval = price?.recurring?.interval;
  if (!PAID_PLANS.includes(plan) || !INTERVALS.includes(interval) || !Number.isInteger(price.unit_amount)) return null;
  const opts = { [price.currency]: price.unit_amount };
  for (const [cur, o] of Object.entries(price.currency_options || {})) if (Number.isInteger(o?.unit_amount)) opts[cur] = o.unit_amount;
  return { id: price.id, plan_id: plan, interval, lookup_key: price.lookup_key || null, currency_options: opts };
}

export async function syncPricesFromStripe(db, opts = {}) {
  const list = await stripe("GET", "/v1/prices", { active: true, lookup_keys: LOOKUP_KEYS, limit: 100, expand: ["data.currency_options"] }, opts);
  const rows = (list?.data || []).map(priceRowFromStripe).filter(Boolean);
  seedPlanPrices(db, rows);
  return { prices: rows, missing: LOOKUP_KEYS.filter((k) => !rows.some((r) => r.lookup_key === k)) };
}

// price -> plan: our table first, then the lookup key, then the price's metadata
function planOfPrice(db, price) {
  if (!price) return null;
  const row = db.get("SELECT plan_id FROM plan_prices WHERE id = ?", idOf(price));
  if (row) return row.plan_id;
  const byKey = /^(plus|pro)_(month|year)$/.exec(price.lookup_key || "")?.[1];
  if (byKey) return byKey;
  const meta = price.metadata?.plan_id;
  return meta && db.get("SELECT 1 FROM plans WHERE id = ?", meta) ? meta : null;
}

// the subscription's amount in its own currency (multi-currency prices bill in one of their currency_options)
function amountFor(db, price, currency) {
  if (!price || !currency) return null;
  const opts = safeJson(db.get("SELECT currency_options FROM plan_prices WHERE id = ?", idOf(price))?.currency_options) || {};
  return opts[currency] ?? price.currency_options?.[currency]?.unit_amount ?? (price.currency === currency ? price.unit_amount : null) ?? null;
}

// MRR in US dollars from the usd option of the plan's price (yearly / 12); trials and lapsed subscriptions are 0
function usdMonthly(db, planId, interval, priceId) {
  const row = (priceId && db.get("SELECT currency_options FROM plan_prices WHERE id = ?", priceId))
    || db.get("SELECT currency_options FROM plan_prices WHERE plan_id = ? AND interval = ? ORDER BY active DESC, rowid DESC LIMIT 1", planId, interval);
  const usd = safeJson(row?.currency_options)?.usd ?? PRICE_CATALOG.find((p) => p.plan_id === planId && p.interval === interval)?.currency_options.usd;
  return usd ? Math.round((usd / 100 / (interval === "year" ? 12 : 1)) * 100) / 100 : 0;
}
const mrrOf = (db, s) => (s && (s.status === "active" || s.status === "past_due") && PAID_PLANS.includes(s.plan_id) ? usdMonthly(db, s.plan_id, s.interval, s.price_id) : 0);
const rankOf = (db, planId) => db.get("SELECT sort FROM plans WHERE id = ?", planId)?.sort ?? -1;

// new | upgrade | downgrade | churn | reactivate, or null when nothing billable moved
function changeOf(db, prev, next) {
  const was = !!prev && LIVE.has(prev.status), is = LIVE.has(next.status);
  const from = was ? mrrOf(db, prev) : 0, to = is ? mrrOf(db, next) : 0;
  let kind = null;
  if (!was && is) {
    const before = db.get("SELECT 1 FROM subscription_changes WHERE subscription_id = ? OR (user_id = ? AND kind = 'churn') LIMIT 1", next.id, next.user_id);
    kind = before ? "reactivate" : "new";
  } else if (was && !is) kind = "churn";
  else if (was && is && (prev.plan_id !== next.plan_id || from !== to)) {
    kind = to > from || (to === from && rankOf(db, next.plan_id) > rankOf(db, prev.plan_id)) ? "upgrade" : "downgrade";
  }
  return kind && { kind, from_plan: was ? prev.plan_id : null, to_plan: is ? next.plan_id : null, from_mrr_usd: from, to_mrr_usd: to };
}

// ---------- customers ----------
const profileExists = (db, id) => (id && db.get("SELECT 1 FROM profiles WHERE id = ?", id) ? id : null);

function linkCustomer(db, userId, customerId) {
  if (!userId || !customerId) return;
  const other = db.get("SELECT user_id FROM customers WHERE stripe_customer_id = ?", customerId);
  if (other) { if (other.user_id !== userId) db.logError("stripe", "customer_conflict", `${customerId} belongs to another user`, { userId }); return; }
  db.run("INSERT INTO customers (user_id, stripe_customer_id, created_at) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET stripe_customer_id = excluded.stripe_customer_id",
    userId, customerId, nowIso());
}

// the customer table is authoritative; metadata (which we set at checkout) covers a webhook that beats our own write
function resolveUser(db, { customerId, prevUser, hint, metaUser }) {
  const byCustomer = customerId && db.get("SELECT user_id FROM customers WHERE stripe_customer_id = ?", customerId)?.user_id;
  return profileExists(db, byCustomer) || profileExists(db, prevUser) || profileExists(db, hint) || profileExists(db, metaUser);
}

async function ensureCustomer(db, user, { fresh = false } = {}) {
  const row = db.get("SELECT stripe_customer_id FROM customers WHERE user_id = ?", user.id);
  if (row?.stripe_customer_id && !fresh) return row.stripe_customer_id;
  // the idempotency key stops a double click from making two customers
  const cus = await stripe("POST", "/v1/customers", { email: user.email, metadata: { user_id: user.id } },
    { idempotencyKey: `cm-customer-${user.id}-${fresh ? Date.now() : keyIsLive() ? "live" : "test"}` });
  db.run("INSERT INTO customers (user_id, stripe_customer_id, created_at) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET stripe_customer_id = excluded.stripe_customer_id",
    user.id, cus.id, nowIso());
  db.audit(user.id, "billing.customer_created", cus.id);
  return cus.id;
}

// ---------- applying Stripe state ----------
// Writes one subscription as Stripe reports it. `created` is the event's timestamp: an event older than the last one
// applied is skipped, so a late delivery can't roll the row back. Returns {ignored} or {note}.
export function applySubscription(db, sub, created, userIdHint = null) {
  const item = sub.items?.data?.[0] || {};
  const price = item.price || sub.plan || null;
  const customerId = idOf(sub.customer);
  const currency = String(sub.currency || price?.currency || "").toLowerCase() || null;
  const status = String(sub.status || "");
  const pricePlan = planOfPrice(db, price);
  return db.tx(() => {
    const prev = db.get("SELECT * FROM subscriptions WHERE id = ?", sub.id);
    if (prev?.last_event_created && created < prev.last_event_created) return { ignored: "older than the last applied event" };
    const userId = resolveUser(db, { customerId, prevUser: prev?.user_id, hint: userIdHint, metaUser: sub.metadata?.user_id });
    if (!userId) return { ignored: "no user for this subscription" };
    if (customerId) linkCustomer(db, userId, customerId);
    if (!pricePlan) db.logError("stripe", "unknown_price", `No plan for price ${idOf(price)}`, { userId });
    const next = {
      id: sub.id, user_id: userId, status,
      // a trial runs on the trial plan's limits; it becomes the price's plan when Stripe moves it to active
      plan_id: status === "trialing" ? "trial" : pricePlan,
      price_id: idOf(price), currency, interval: price?.recurring?.interval || null, unit_amount: amountFor(db, price, currency),
      // periods live on the item in current API versions, on the subscription in older ones
      current_period_start: isoOf(item.current_period_start ?? sub.current_period_start),
      current_period_end: isoOf(item.current_period_end ?? sub.current_period_end),
      trial_end: isoOf(sub.trial_end),
      cancel_at_period_end: sub.cancel_at_period_end || (sub.cancel_at && status !== "canceled") ? 1 : 0,
      canceled_at: isoOf(sub.canceled_at),
      // past_due keeps the plan for a week from the first failure, not from each retry
      grace_until: status === "past_due" ? (prev?.status === "past_due" && prev.grace_until ? prev.grace_until : new Date(Date.now() + GRACE_DAYS * DAY).toISOString()) : null,
      last_event_created: Math.max(created || 0, prev?.last_event_created || 0),
      livemode: sub.livemode ? 1 : 0,
    };
    db.run(`INSERT INTO subscriptions (id, user_id, status, plan_id, price_id, currency, interval, unit_amount, current_period_start, current_period_end,
              trial_end, cancel_at_period_end, canceled_at, grace_until, last_event_created, livemode, synced_at, raw)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET user_id = excluded.user_id, status = excluded.status, plan_id = excluded.plan_id, price_id = excluded.price_id,
              currency = excluded.currency, interval = excluded.interval, unit_amount = excluded.unit_amount,
              current_period_start = excluded.current_period_start, current_period_end = excluded.current_period_end, trial_end = excluded.trial_end,
              cancel_at_period_end = excluded.cancel_at_period_end, canceled_at = excluded.canceled_at, grace_until = excluded.grace_until,
              last_event_created = excluded.last_event_created, livemode = excluded.livemode, synced_at = excluded.synced_at, raw = excluded.raw`,
      next.id, next.user_id, next.status, next.plan_id, next.price_id, next.currency, next.interval, next.unit_amount, next.current_period_start,
      next.current_period_end, next.trial_end, next.cancel_at_period_end, next.canceled_at, next.grace_until, next.last_event_created, next.livemode,
      nowIso(), JSON.stringify(sub));
    const change = changeOf(db, prev, next);
    if (change) {
      db.run("INSERT INTO subscription_changes (subscription_id, user_id, at, kind, from_plan, to_plan, from_mrr_usd, to_mrr_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        next.id, userId, nowIso(), change.kind, change.from_plan, change.to_plan, change.from_mrr_usd, change.to_mrr_usd);
    }
    if (sub.trial_end || status === "trialing") db.run("UPDATE profiles SET trial_used = 1 WHERE id = ? AND trial_used = 0", userId);
    if (!prev || prev.status !== next.status || prev.plan_id !== next.plan_id || prev.cancel_at_period_end !== next.cancel_at_period_end) {
      db.audit(userId, "billing.subscription", sub.id, prev ? { status: prev.status, plan: prev.plan_id, cancel_at_period_end: !!prev.cancel_at_period_end } : null,
        { status: next.status, plan: next.plan_id, cancel_at_period_end: !!next.cancel_at_period_end, change: change?.kind || null });
    }
    return { note: change?.kind || null };
  });
}

const INVOICE_RANK = { draft: 0, open: 1, paid: 2, uncollectible: 2, void: 2 };
// one invoice as Stripe sent it; a late, older event (finalized after paid) doesn't move it backwards
export function upsertInvoice(db, inv) {
  const lineSub = inv.lines?.data?.find((l) => l?.parent?.subscription_item_details?.subscription)?.parent.subscription_item_details.subscription;
  const subscriptionId = idOf(inv.parent?.subscription_details?.subscription) || idOf(inv.subscription) || idOf(lineSub) || null;
  const customerId = idOf(inv.customer);
  const metaUser = inv.parent?.subscription_details?.metadata?.user_id || inv.subscription_details?.metadata?.user_id;
  const subUser = subscriptionId && db.get("SELECT user_id FROM subscriptions WHERE id = ?", subscriptionId)?.user_id;
  const userId = resolveUser(db, { customerId, prevUser: subUser, metaUser });
  const tax = Number.isInteger(inv.tax) ? inv.tax
    : Array.isArray(inv.total_taxes) ? inv.total_taxes.reduce((s, t) => s + (t?.amount || 0), 0)
    : Array.isArray(inv.total_tax_amounts) ? inv.total_tax_amounts.reduce((s, t) => s + (t?.amount || 0), 0) : null;
  const url = /^https:\/\//.test(inv.hosted_invoice_url || "") ? inv.hosted_invoice_url : null;
  db.tx(() => {
    const prev = db.get("SELECT status FROM invoices WHERE id = ?", inv.id);
    if (prev && (INVOICE_RANK[prev.status] ?? 0) > (INVOICE_RANK[inv.status] ?? 0)) return;
    db.run(`INSERT INTO invoices (id, user_id, subscription_id, status, currency, amount_due, amount_paid, tax, created_at, hosted_invoice_url, raw)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET user_id = COALESCE(excluded.user_id, invoices.user_id), subscription_id = COALESCE(excluded.subscription_id, invoices.subscription_id),
              status = excluded.status, currency = excluded.currency, amount_due = excluded.amount_due, amount_paid = excluded.amount_paid, tax = excluded.tax,
              hosted_invoice_url = COALESCE(excluded.hosted_invoice_url, invoices.hosted_invoice_url), raw = excluded.raw`,
      inv.id, userId, subscriptionId, String(inv.status || "open"), inv.currency || null, inv.amount_due ?? null, inv.amount_paid ?? null, tax,
      isoOf(inv.created) || nowIso(), url, JSON.stringify(inv));
  });
  return { subscriptionId, userId };
}

// Re-reads the subscription from Stripe rather than trusting the event payload (which may be stale or out of order).
async function syncSubscription(db, subId, created, { userId = null, fallback = null } = {}) {
  if (!/^sub_[A-Za-z0-9_]+$/.test(String(subId || ""))) return { ignored: "no subscription id" };
  const prev = db.get("SELECT last_event_created FROM subscriptions WHERE id = ?", subId);
  if (prev?.last_event_created && created < prev.last_event_created) return { ignored: "older than the last applied event" };
  let sub;
  try { sub = await stripe("GET", `/v1/subscriptions/${subId}`); }
  catch (e) {
    if (!(e instanceof StripeError) || e.status !== 404) throw e;
    if (!fallback) return { ignored: "subscription not found in Stripe" };
    sub = fallback; // a deleted subscription Stripe no longer returns: the event's copy is all there is
  }
  return applySubscription(db, sub, created, userId);
}

async function dispatch(db, event) {
  const o = event.data.object, created = Number(event.created) || 0;
  switch (event.type) {
    case "checkout.session.completed": {
      if (o.mode !== "subscription") return { ignored: "not a subscription checkout" };
      const userId = profileExists(db, o.client_reference_id) || profileExists(db, o.metadata?.user_id);
      if (userId && o.customer) db.tx(() => linkCustomer(db, userId, idOf(o.customer)));
      if (userId) db.audit(userId, "billing.checkout_completed", o.id);
      return o.subscription ? syncSubscription(db, idOf(o.subscription), created, { userId }) : { note: "no subscription on the session" };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return syncSubscription(db, o.id, created, { fallback: event.type === "customer.subscription.deleted" ? o : null });
    case "invoice.paid":
    case "invoice.payment_failed":
    case "invoice.finalized": {
      const r = upsertInvoice(db, o);
      if (event.type === "invoice.payment_failed" && r.userId) db.audit(r.userId, "billing.payment_failed", o.id);
      // payment moves the subscription (past_due <-> active); the invoice is recorded even if that part is stale
      if (event.type !== "invoice.finalized" && r.subscriptionId) await syncSubscription(db, r.subscriptionId, created, { userId: r.userId });
      return r.userId ? null : { note: "invoice for an unknown customer" };
    }
    default:
      return { ignored: "event type not handled" };
  }
}

// Records, de-duplicates and applies one verified event: {status, body} for the HTTP reply (500 makes Stripe retry).
export async function processEvent(db, event, raw = JSON.stringify(event)) {
  const ins = db.run("INSERT INTO stripe_events (id, type, livemode, created, status, received_at, payload) VALUES (?, ?, ?, ?, 'received', ?, ?) ON CONFLICT (id) DO NOTHING",
    event.id, event.type, event.livemode ? 1 : 0, Number(event.created) || 0, nowIso(), raw);
  if (!ins.changes) {
    const prev = db.get("SELECT status FROM stripe_events WHERE id = ?", event.id);
    if (prev?.status === "processed" || prev?.status === "ignored") return { status: 200, body: { received: true, duplicate: true } };
    // received (an earlier attempt died) or failed: run it again
  }
  const finish = (status, error = null) => db.run("UPDATE stripe_events SET status = ?, processed_at = ?, error = ? WHERE id = ?", status, nowIso(), error, event.id);
  if (!!event.livemode !== acceptLive(db)) {
    finish("ignored", event.livemode ? "live event while billing runs in test mode" : "test event while billing is live");
    return { status: 200, body: { received: true, ignored: true } };
  }
  try {
    const r = await dispatch(db, event);
    if (r?.ignored) finish("ignored", r.ignored); else finish("processed", r?.note || null);
    return { status: 200, body: { received: true } };
  } catch (e) {
    const msg = String(e?.message || e).slice(0, 1000);
    finish("failed", msg);
    db.logError("stripe", "webhook_failed", msg, { event: event.id, type: event.type });
    return { status: 500, body: { code: "webhook_failed", message: "Couldn't process this event; Stripe will retry." } };
  }
}

// POST /webhooks/stripe: mounted before the origin check and the session, since Stripe signs its own requests
export function stripeWebhook(db) {
  return async (c) => {
    const raw = await c.req.text(); // the exact bytes Stripe signed, before any parsing
    if (!config.stripeWebhookSecret) return c.json({ code: "not_configured", message: "The Stripe webhook secret isn't set." }, 503);
    try { verifyWebhook(raw, c.req.header("stripe-signature"), config.stripeWebhookSecret); }
    catch (e) { return c.json({ code: "bad_signature", message: e.message }, 400); }
    const event = safeJson(raw);
    if (!event || typeof event.id !== "string" || typeof event.type !== "string" || !event.data?.object) return c.json({ code: "bad_request", message: "Not a Stripe event." }, 400);
    const r = await processEvent(db, event, raw);
    return c.json(r.body, r.status);
  };
}

// ---------- mock checkout (development without a Stripe key) ----------
function addInterval(sec, interval) {
  const d = new Date(sec * 1000);
  if (interval === "year") d.setUTCFullYear(d.getUTCFullYear() + 1); else d.setUTCMonth(d.getUTCMonth() + 1);
  return Math.floor(d.getTime() / 1000);
}
// a Stripe-shaped subscription, so the mock goes through the same code as the webhook
function mockSubscription(user, price, t) {
  const now = Math.floor(Date.now() / 1000), end = t.trial ? now + TRIAL_DAYS * 86400 : addInterval(now, t.interval);
  return {
    id: "sub_mock_" + crypto.randomBytes(9).toString("hex"), object: "subscription", customer: null, livemode: false,
    status: t.trial ? "trialing" : "active", currency: t.currency, metadata: { user_id: user.id },
    cancel_at_period_end: false, canceled_at: null, trial_end: t.trial ? end : null,
    items: { data: [{ current_period_start: now, current_period_end: end, price: {
      id: price.id, lookup_key: price.lookup_key, currency: "usd", unit_amount: price.currency_options.usd, recurring: { interval: t.interval },
      currency_options: Object.fromEntries(Object.entries(price.currency_options).map(([k, v]) => [k, { unit_amount: v }])),
    } }] },
  };
}

// ---------- routes ----------
const openSubscription = (db, userId) =>
  db.get(`SELECT * FROM subscriptions WHERE user_id = ? AND status IN (${OPEN_SQL}) AND livemode = ? ORDER BY synced_at DESC LIMIT 1`, userId, acceptLive(db) ? 1 : 0);
const checkoutLocale = (l) => ({ ja: "ja", zh: "zh-TW", en: "en" }[l] || "auto");

// Stripe's own messages can name account settings: users get a plain message, the error log gets the detail
function stripeFailure(db, e, userId, { detail = false } = {}) {
  if (!(e instanceof StripeError)) return e;
  db.logError("stripe", e.code || String(e.status || "network"), e.message, { userId });
  return new ApiError(502, "stripe_error", detail ? `Stripe: ${e.message}` : "Payments are unavailable right now. Try again in a few minutes.", { retryable: true });
}

export function billingRoutes(db) {
  const r = new Hono();
  const mockTokens = new Map(); // token -> {userId, plan, interval, currency, trial, exp}
  let portalCache = { id: null, at: 0 };

  // the portal configuration scripts/stripe-setup.js made (plan switching between Plus and Pro); else Stripe's default
  async function portalConfiguration() {
    if (Date.now() - portalCache.at < 3600e3) return portalCache.id;
    let id = null;
    try { id = (await stripe("GET", "/v1/billing_portal/configurations", { active: true, limit: 100 })).data?.find((x) => x.metadata?.app === PORTAL_TAG)?.id || null; }
    catch (e) { /* the default configuration still works */ }
    portalCache = { id, at: Date.now() };
    return id;
  }

  r.get("/status", requireUser, (c) => {
    const user = c.get("user"), b = billingCfg(db), live = acceptLive(db) ? 1 : 0;
    const p = planFor(db, user);
    const prices = priceRows(db);
    const plans = db.all(`SELECT id, name, limits, sort FROM plans WHERE active = 1 AND id IN (${SHOWN_PLANS.map(() => "?").join(", ")}) ORDER BY sort`, ...SHOWN_PLANS)
      .map((pl) => ({ id: pl.id, name: pl.name, limits: safeJson(pl.limits) || {},
        prices: prices.filter((x) => x.plan_id === pl.id).flatMap((x) => Object.entries(x.currency_options).map(([currency, amount]) => ({ interval: x.interval, currency, amount }))) }));
    // the subscription that matters: an open one first, else the latest
    const s = db.get(`SELECT * FROM subscriptions WHERE user_id = ? AND livemode = ? ORDER BY (status IN (${OPEN_SQL})) DESC, synced_at DESC LIMIT 1`, user.id, live);
    const raw = s && safeJson(s.raw);
    const invoices = db.all("SELECT id, status, currency, amount_due, amount_paid, tax, created_at, hosted_invoice_url FROM invoices WHERE user_id = ? ORDER BY created_at DESC LIMIT 12", user.id);
    const hasPortal = mockMode() ? !!db.get("SELECT 1 FROM subscriptions WHERE user_id = ? AND id LIKE 'sub_mock_%' LIMIT 1", user.id)
      : !!db.get("SELECT 1 FROM customers WHERE user_id = ? AND stripe_customer_id IS NOT NULL", user.id);
    c.header("cache-control", "private, no-store");
    return c.json({
      enabled: !!b.enabled, live: !!b.live, mock: mockMode(),
      trialAvailable: !db.get("SELECT trial_used FROM profiles WHERE id = ?", user.id)?.trial_used,
      hasPortal, plans,
      current: {
        plan: p.planId, planName: db.get("SELECT name FROM plans WHERE id = ?", p.planId)?.name || p.planId, source: p.source,
        subscription: s ? {
          status: s.status, plan: s.plan_id, pricePlan: planOfPrice(db, raw?.items?.data?.[0]?.price || (s.price_id && { id: s.price_id })),
          interval: s.interval, currency: s.currency, amount: s.unit_amount, current_period_end: s.current_period_end,
          cancel_at_period_end: !!s.cancel_at_period_end, trial_end: s.trial_end, grace_until: s.grace_until, mock: s.id.startsWith("sub_mock_"),
        } : null,
      },
      invoices: invoices.map((i) => ({ ...i, hosted_invoice_url: /^https:\/\//.test(i.hosted_invoice_url || "") ? i.hosted_invoice_url : null })),
    });
  });

  r.post("/checkout", requireUser, async (c) => {
    const user = c.get("user");
    rateLimit("billing:checkout:" + user.id, 5, 5 / 60, "checkout attempts");
    if (!billingEnabled(db)) fail(409, "billing_off", "Paid plans aren't available yet.");
    const body = (await c.req.json().catch(() => null)) || {};
    const plan = body.plan, interval = body.interval || "month", currency = String(body.currency || "usd").toLowerCase(), trial = body.trial === true;
    if (!PAID_PLANS.includes(plan)) fail(400, "bad_request", "plan must be plus or pro.");
    if (!INTERVALS.includes(interval)) fail(400, "bad_request", "interval must be month or year.");
    if (!CURRENCIES.includes(currency)) fail(400, "bad_request", "currency must be usd, jpy or twd.");
    if (openSubscription(db, user.id)) fail(409, "already_subscribed", "You already have a subscription. Change it under Manage billing.", { portal: true });
    if (trial && db.get("SELECT trial_used FROM profiles WHERE id = ?", user.id)?.trial_used) fail(409, "trial_used", "You've already had a free trial.");
    const price = priceFor(db, plan, interval);
    if (!price || price.currency_options[currency] == null) fail(503, "not_configured", "This plan isn't on sale in that currency yet.");

    if (mockMode()) {
      const now = Date.now();
      for (const [k, v] of mockTokens) if (v.exp < now) mockTokens.delete(k);
      const token = crypto.randomBytes(18).toString("base64url");
      mockTokens.set(token, { userId: user.id, plan, interval, currency, trial, exp: now + 30 * 60e3 });
      return c.json({ url: `/account?mock_checkout=${token}`, mock: true });
    }
    if (!config.stripeSecretKey) fail(503, "not_configured", "Billing isn't set up yet.");
    // a test key with live billing (or the reverse) would take payments whose webhooks are then ignored
    if (keyIsLive() !== !!billingCfg(db).live) fail(503, "mode_mismatch", "The Stripe key doesn't match the billing mode (test or live).");

    const params = (customer) => ({
      mode: "subscription", customer, client_reference_id: user.id,
      line_items: [{ price: price.id, quantity: 1 }], currency,
      success_url: `${config.baseUrl}/account?checkout=success`, cancel_url: `${config.baseUrl}/account?checkout=cancel`,
      automatic_tax: { enabled: true }, allow_promotion_codes: true, customer_update: { address: "auto" },
      payment_method_collection: "always", locale: checkoutLocale(body.lang), metadata: { user_id: user.id },
      subscription_data: { metadata: { user_id: user.id }, trial_period_days: trial ? TRIAL_DAYS : undefined },
    });
    let session;
    try {
      let customer = await ensureCustomer(db, user);
      try { session = await stripe("POST", "/v1/checkout/sessions", params(customer)); }
      catch (e) {
        // a customer from the other Stripe mode, or deleted in the dashboard: make a new one and try once more
        if (!(e instanceof StripeError) || e.code !== "resource_missing" || e.param !== "customer") throw e;
        customer = await ensureCustomer(db, user, { fresh: true });
        session = await stripe("POST", "/v1/checkout/sessions", params(customer));
      }
    } catch (e) { throw stripeFailure(db, e, user.id); }
    return c.json({ url: session.url });
  });

  r.post("/portal", requireUser, async (c) => {
    const user = c.get("user");
    rateLimit("billing:portal:" + user.id, 10, 10 / 60, "requests");
    if (!billingEnabled(db)) fail(409, "billing_off", "Paid plans aren't available yet.");
    if (mockMode()) {
      if (!db.get("SELECT 1 FROM subscriptions WHERE user_id = ? AND id LIKE 'sub_mock_%' LIMIT 1", user.id)) fail(404, "no_customer", "There's no billing account yet. Choose a plan first.");
      return c.json({ url: "/account?mock_portal=1", mock: true });
    }
    if (!config.stripeSecretKey) fail(503, "not_configured", "Billing isn't set up yet.");
    const customer = db.get("SELECT stripe_customer_id FROM customers WHERE user_id = ?", user.id)?.stripe_customer_id;
    if (!customer) fail(404, "no_customer", "There's no billing account yet. Choose a plan first.");
    const body = (await c.req.json().catch(() => null)) || {};
    try {
      const configuration = await portalConfiguration();
      const s = await stripe("POST", "/v1/billing_portal/sessions", { customer, return_url: `${config.baseUrl}/account`, configuration: configuration || undefined, locale: checkoutLocale(body.lang) });
      return c.json({ url: s.url });
    } catch (e) { throw stripeFailure(db, e, user.id); }
  });

  // owner: load the four prices from Stripe (by lookup key) into plan_prices
  r.post("/admin/sync-prices", requireOwner, async (c) => {
    const user = c.get("user");
    if (!config.stripeSecretKey) fail(409, "not_configured", "Set STRIPE_SECRET_KEY first.");
    let out;
    try { out = await syncPricesFromStripe(db); } catch (e) { throw stripeFailure(db, e, user.id, { detail: true }); }
    db.audit(user.id, "billing.prices_synced", null, null, { prices: out.prices.map((p) => p.id), missing: out.missing });
    return c.json(out);
  });

  // development only: complete or cancel a mock checkout as if Stripe's webhook had run
  if (!config.production) {
    const mockOnly = async (c, next) => { if (!mockMode()) return c.notFound(); return next(); };
    r.post("/mock/complete", mockOnly, requireUser, async (c) => {
      const user = c.get("user");
      if (!billingEnabled(db)) fail(409, "billing_off", "Paid plans aren't available yet.");
      const { token } = (await c.req.json().catch(() => null)) || {};
      const t = mockTokens.get(String(token || ""));
      if (!t || t.userId !== user.id || t.exp < Date.now()) fail(400, "bad_token", "That mock checkout has expired. Start again.");
      mockTokens.delete(String(token));
      if (openSubscription(db, user.id)) fail(409, "already_subscribed", "You already have a subscription.", { portal: true });
      if (t.trial && db.get("SELECT trial_used FROM profiles WHERE id = ?", user.id)?.trial_used) fail(409, "trial_used", "You've already had a free trial.");
      const price = priceFor(db, t.plan, t.interval);
      if (!price) fail(503, "not_configured", "No price for this plan.");
      const sub = mockSubscription(user, price, t);
      const now = Math.floor(Date.now() / 1000);
      applySubscription(db, sub, now, user.id);
      const amount = t.trial ? 0 : price.currency_options[t.currency];
      upsertInvoice(db, { id: "in_mock_" + crypto.randomBytes(9).toString("hex"), customer: null, status: "paid", currency: t.currency, amount_due: amount, amount_paid: amount,
        total_taxes: [], created: now, hosted_invoice_url: null, parent: { subscription_details: { subscription: sub.id, metadata: { user_id: user.id } } } });
      db.audit(user.id, "billing.mock_checkout", sub.id, null, { plan: t.plan, interval: t.interval, currency: t.currency, trial: t.trial });
      return c.json({ ok: true, subscription: sub.id });
    });
    r.post("/mock/cancel", mockOnly, requireUser, async (c) => {
      const user = c.get("user");
      const row = db.get("SELECT * FROM subscriptions WHERE user_id = ? AND id LIKE 'sub_mock_%' AND status IN ('active', 'trialing', 'past_due') ORDER BY synced_at DESC LIMIT 1", user.id);
      if (!row) fail(404, "not_found", "No mock subscription to cancel.");
      const now = Math.floor(Date.now() / 1000);
      const sub = { ...safeJson(row.raw), status: "canceled", canceled_at: now, ended_at: now };
      applySubscription(db, sub, Math.max(now, row.last_event_created || 0), user.id);
      return c.json({ ok: true });
    });
  }
  return r;
}
