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
  if (!res.ok) throw new Error(`Stripe ${method} ${path}: ${data?.error?.message || `HTTP ${res.status}`}`);
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
  if (!p || !p.active || !p.coupon || !p.coupon.valid) return null;
  if (p.expires_at && p.expires_at * 1000 < Date.now()) return null;
  if (p.max_redemptions && p.times_redeemed >= p.max_redemptions) return null;
  return { id: p.id, code: p.code, percentOff: p.coupon.percent_off || null, amountOff: p.coupon.amount_off || null, currency: p.coupon.currency || null, duration: p.coupon.duration, months: p.coupon.duration_in_months || null, name: p.coupon.name || null, firstTimeOnly: !!(p.restrictions && p.restrictions.first_time_transaction) };
}

export async function createCheckoutSession(user, { siteUrl, plan = "monthly", promotionCode = null }) {
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
    subscription_data: { metadata: { user_id: user.id, plan } },
    // Managed Payments requires adaptive pricing: the price is set in the site's currency and
    // visitors abroad see their own currency with a selector to switch back.
    locale: CHECKOUT_LOCALES[user.locale] || "auto",
  };
  if (s.managedPayments) params.managed_payments = { enabled: true };
  // A code applied on the site is pre-filled; otherwise Checkout shows its own promotion-code
  // field (Stripe allows one or the other, not both).
  if (promotionCode) params.discounts = [{ promotion_code: promotionCode }]; else params.allow_promotion_codes = true;
  const existing = user.subscription && user.subscription.provider === "stripe" && user.subscription.customerId;
  if (existing) params.customer = existing; else params.customer_email = user.email;
  const session = await call("POST", "checkout/sessions", params, { idempotencyKey: `checkout:${user.id}:${Date.now()}` });
  return session.url;
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
  return call("POST", `subscriptions/${encodeURIComponent(id)}`, { cancel_at_period_end: true });
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
