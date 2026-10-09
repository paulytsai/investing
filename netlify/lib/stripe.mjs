// Stripe Billing through the REST API (no SDK): hosted Checkout for the subscription,
// the customer portal for card changes and cancellation, cancel-at-period-end, and
// webhook signature verification. Managed Payments (Stripe as merchant of record, which
// handles consumption tax, VAT and sales tax) is switched on per Checkout Session.
import crypto from "node:crypto";
import { cfg } from "./config.mjs";

const API = "https://api.stripe.com/v1";
const API_VERSION = "2025-03-31.basil"; // the minimum for Managed Payments

/** Flatten a nested object into Stripe's form encoding: a[b][0][c]=v */
export function formEncode(obj, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => (typeof item === "object" ? formEncode(item, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(item))));
    else if (typeof v === "object") formEncode(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function call(method, path, body, { idempotencyKey } = {}) {
  const { secretKey } = cfg.stripe();
  if (!secretKey) throw new Error("STRIPE_SECRET_KEY is not set");
  const headers = { authorization: `Bearer ${secretKey}`, "stripe-version": API_VERSION };
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  let url = `${API}/${path}`;
  const init = { method, headers };
  if (body && method === "GET") url += `?${formEncode(body)}`;
  else if (body) { headers["content-type"] = "application/x-www-form-urlencoded"; init.body = formEncode(body).toString(); }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Stripe ${method} ${path}: ${data?.error?.message || `HTTP ${res.status}`}`);
    err.stripeCode = data?.error?.code || null; err.status = res.status;
    throw err;
  }
  return data;
}

/** Hosted Checkout for the monthly plan. Returns the URL to send the user to. */
const CHECKOUT_LOCALES = { ja: "ja", en: "en", "zh-TW": "zh-TW" };
/**
 * Look up an active promotion code (the customer-facing string of a Stripe coupon, created in
 * the Dashboard under Product catalog → Coupons). Returns null when it does not exist, is
 * inactive, expired or used up.
 */
export async function findPromotionCode(code) {
  const c = String(code || "").trim();
  if (!c || c.length > 40) return null;
  const r = await call("GET", `promotion_codes?code=${encodeURIComponent(c)}&active=true&limit=1`);
  const p = r.data && r.data[0];
  if (!p || !p.active) return null;
  // API 2025-03-31 returns the coupon object on p.coupon; later versions moved it to
  // p.promotion.coupon (an id unless expanded). Accept both so a version bump cannot break codes.
  let coupon = p.coupon && typeof p.coupon === "object" ? p.coupon : null;
  const cid = !coupon && (typeof p.coupon === "string" ? p.coupon : p.promotion && p.promotion.coupon);
  if (!coupon && cid) coupon = typeof cid === "object" ? cid : await call("GET", `coupons/${encodeURIComponent(cid)}`).catch(() => null);
  if (!coupon || !coupon.valid) return null;
  p.coupon = coupon;
  if (p.expires_at && p.expires_at * 1000 < Date.now()) return null;
  if (p.max_redemptions && p.times_redeemed >= p.max_redemptions) return null;
  return { id: p.id, code: p.code, percentOff: p.coupon.percent_off || null, amountOff: p.coupon.amount_off || null, currency: p.coupon.currency || null, duration: p.coupon.duration, months: p.coupon.duration_in_months || null, name: p.coupon.name || null, firstTimeOnly: !!(p.restrictions && p.restrictions.first_time_transaction) };
}

/** The Stripe customer for this user: the stored one, or a new one (saved by the caller). */
export async function ensureCustomer(user) {
  const known = user.stripeCustomerId || (user.subscription && user.subscription.provider === "stripe" && user.subscription.customerId) || null;
  if (known) {
    try { const c = await call("GET", `customers/${encodeURIComponent(known)}`); if (c && !c.deleted) return c.id; }
    catch (e) { if (e.stripeCode !== "resource_missing") throw e; } // e.g. a sandbox customer after switching to live keys
  }
  const c = await call("POST", "customers", { email: user.email, name: user.username, metadata: { user_id: user.id, username: user.username } }, { idempotencyKey: `customer:${user.id}:${cfg.stripe().testMode ? "test" : "live"}:${known || "new"}` });
  return c.id;
}

/** Expire an open Checkout Session so a second tab cannot complete a second purchase. */
export async function expireCheckoutSession(id) {
  if (!id) return;
  try { await call("POST", `checkout/sessions/${encodeURIComponent(id)}/expire`); } catch { /* already completed or expired */ }
}

/**
 * Hosted Checkout. Returns { url, sessionId, customerId }.
 * trialEndMs: the end of the site's free period; when it is more than 48 hours away (Stripe's
 * minimum for Checkout) the subscription starts with a Stripe trial and the first charge is on
 * that day, so subscribing early never costs the remaining free time.
 */
export async function createCheckoutSession(user, { siteUrl, plan = "monthly", promotionCode = null, allowPromotionCodes = true, trialEndMs = null, customerId = null }) {
  const s = cfg.stripe();
  const base = siteUrl.replace(/\/$/, "");
  const price = plan === "annual" && s.priceIdAnnual ? s.priceIdAnnual : s.priceId;
  const params = {
    mode: "subscription",
    line_items: [{ price, quantity: 1 }],
    success_url: `${base}/#/account?checkout=success`,
    cancel_url: `${base}/#/account`,
    client_reference_id: user.id,
    metadata: { user_id: user.id, username: user.username, plan },
    subscription_data: { metadata: { user_id: user.id, plan, site: cfg.brand().id || "" } },
    // Managed Payments requires adaptive pricing: the price is set in the site's currency and
    // visitors abroad see their own currency with a selector to switch back.
    locale: CHECKOUT_LOCALES[user.locale] || "auto",
  };
  if (s.managedPayments) params.managed_payments = { enabled: true };
  if (trialEndMs && trialEndMs - Date.now() > 49 * 3600 * 1000) params.subscription_data.trial_end = Math.floor(trialEndMs / 1000);
  // A code applied on the site is pre-filled; otherwise Checkout shows its own promotion-code
  // field (Stripe allows one or the other, not both) when the plan allows codes at all.
  if (promotionCode) params.discounts = [{ promotion_code: promotionCode }];
  else if (allowPromotionCodes) params.allow_promotion_codes = true;
  const customer = customerId || (await ensureCustomer(user));
  params.customer = customer;
  const session = await call("POST", "checkout/sessions", params, { idempotencyKey: `checkout:${user.id}:${Date.now()}` });
  return { url: session.url, sessionId: session.id, customerId: customer };
}

/** Customer portal: update the card, see invoices, cancel. */
export async function createPortalSession(customerId, { siteUrl }) {
  const session = await call("POST", "billing_portal/sessions", { customer: customerId, return_url: `${siteUrl.replace(/\/$/, "")}/#/account` });
  return session.url;
}

export async function retrieveSubscription(id) {
  return call("GET", `subscriptions/${encodeURIComponent(id)}`, { "expand[]": "default_payment_method" });
}
export async function retrieveCustomer(id) {
  return call("GET", `customers/${encodeURIComponent(id)}`);
}
/** Cancel at the end of the current period (the user keeps access until then). */
export async function cancelAtPeriodEnd(id) {
  return call("POST", `subscriptions/${encodeURIComponent(id)}`, { cancel_at_period_end: true, "expand[]": "default_payment_method" });
}
/** Undo a scheduled cancellation: the subscription renews again. */
export async function resumeSubscription(id) {
  return call("POST", `subscriptions/${encodeURIComponent(id)}`, { cancel_at_period_end: false, "expand[]": "default_payment_method" });
}
/** End the subscription now (account deleted, refund or dispute): no further charges. */
export async function cancelNow(id) {
  return call("DELETE", `subscriptions/${encodeURIComponent(id)}`);
}
/** The customer's invoices, newest first, for the site's billing history. */
export async function listInvoices(customerId, limit = 24) {
  const r = await call("GET", "invoices", { customer: customerId, limit });
  return (r.data || []).filter((i) => i.status !== "draft");
}
/** The subscription a payment belongs to (refund and dispute events carry only the payment). */
export async function subscriptionForPayment({ paymentIntent, invoice }) {
  let invId = invoice || null;
  if (!invId && paymentIntent) {
    const r = await call("GET", "invoice_payments", { "payment[type]": "payment_intent", "payment[payment_intent]": paymentIntent, limit: 1 }).catch(() => null);
    const ip = r && r.data && r.data[0];
    invId = ip ? (typeof ip.invoice === "string" ? ip.invoice : ip.invoice && ip.invoice.id) : null;
  }
  if (!invId) return null;
  const inv = await call("GET", `invoices/${encodeURIComponent(invId)}`);
  return inv.subscription || (inv.parent && inv.parent.subscription_details && inv.parent.subscription_details.subscription) || null;
}

// ---- mapping ----
const iso = (sec) => (sec ? new Date(Number(sec) * 1000).toISOString() : null);
const STATUS = { active: "active", trialing: "on_trial", past_due: "past_due", canceled: "cancelled", unpaid: "unpaid", incomplete: "incomplete", incomplete_expired: "expired", paused: "paused" };

/** Map a Stripe subscription object to the record stored on the user (same shape as Lemon Squeezy's). */
export function subscriptionRecord(sub) {
  const pm = sub.default_payment_method && typeof sub.default_payment_method === "object" ? sub.default_payment_method : null;
  const card = pm && pm.card ? pm.card : null;
  // cancel_at_period_end keeps Stripe's status "active" until the period ends; the site's
  // entitlement treats "cancelled" with a future endsAt as a grace period, so map it that way.
  const status = sub.cancel_at_period_end && sub.status === "active" ? "cancelled" : STATUS[sub.status] || sub.status;
  const periodEnd = sub.current_period_end || (sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].current_period_end) || null;
  return {
    provider: "stripe",
    id: sub.id,
    status,
    statusFormatted: status.replace(/_/g, " "),
    customerId: typeof sub.customer === "string" ? sub.customer : sub.customer?.id || null,
    orderId: null,
    productId: sub.items?.data?.[0]?.price?.product || null,
    variantId: sub.items?.data?.[0]?.price?.id || null,
    email: null,
    renewsAt: status === "cancelled" ? null : iso(periodEnd),
    endsAt: sub.cancel_at ? iso(sub.cancel_at) : sub.ended_at ? iso(sub.ended_at) : status === "cancelled" ? iso(periodEnd) : null,
    trialEndsAt: iso(sub.trial_end),
    interval: sub.items?.data?.[0]?.price?.recurring?.interval || null, // "month" | "year"
    plan: sub.metadata?.plan || (sub.items?.data?.[0]?.price?.recurring?.interval === "year" ? "annual" : "monthly"),
    livemode: sub.livemode === true,
    createdAt: iso(sub.created),
    cancelAtPeriodEnd: !!sub.cancel_at_period_end,
    cardBrand: card ? card.brand : null,
    cardLastFour: card ? card.last4 : null,
    portalUrl: null,
    updatePaymentUrl: null,
    updatedAt: new Date().toISOString(),
  };
}

/** Verify a Stripe-Signature header (t=...,v1=...) against the raw body with the endpoint secret. */
export function verifyWebhook(rawBody, header, { secret = cfg.stripe().webhookSecret, toleranceSec = 300, now = Date.now() } = {}) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(String(header).split(",").map((p) => p.trim().split("=")).filter((kv) => kv.length === 2).map(([k, v]) => [k, v]));
  const sigs = String(header).split(",").map((p) => p.trim()).filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  const t = Number(parts.t);
  if (!t || !sigs.length) return false;
  if (Math.abs(now / 1000 - t) > toleranceSec) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${parts.t}.${rawBody}`).digest("hex");
  return sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

/** Build a Stripe-Signature header (tests and local webhook replay). */
export function signWebhook(rawBody, secret, now = Date.now()) {
  const t = Math.floor(now / 1000);
  const v1 = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return `t=${t},v1=${v1}`;
}
