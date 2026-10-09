// One billing surface for the account page and the paywall. The provider is chosen by
// configuration: Stripe when STRIPE_SECRET_KEY and STRIPE_PRICE_ID are set, otherwise
// Lemon Squeezy when its store and variant are set. Each edition's site sets its own.
import { cfg } from "./config.mjs";
import * as lemon from "./lemonsqueezy.mjs";
import * as stripe from "./stripe.mjs";
import { saveUser } from "./users.mjs";
import { isTestUser } from "./events.mjs";

// Subscription statuses (site names) that mean "this subscription is still running".
const RUNNING = new Set(["active", "on_trial", "past_due"]);

/** A subscription that still bills or still grants access (including a scheduled cancel). */
export function isRunning(sub, now = Date.now()) {
  if (!sub || !sub.id) return false;
  if (RUNNING.has(sub.status)) return true;
  return sub.status === "cancelled" && !!sub.endsAt && Date.parse(sub.endsAt) > now;
}

/** With sandbox keys only test accounts may pay (a test card must not unlock paid access). */
export function isBillingTester(user) {
  if (!user) return false;
  if (user.role === "admin") return true;
  return isTestUser(user.username) || cfg.stripe().testUsers.includes(String(user.username || "").toLowerCase());
}

/** Why this user may not start a checkout now, or null. */
export function checkoutBlock(user, now = Date.now()) {
  if (billingProvider() === "stripe" && cfg.stripe().testMode && !isBillingTester(user)) return "billing_not_live";
  if (user.plan === "free") return "complimentary";
  if (isRunning(user.subscription, now)) return "already_subscribed";
  return null;
}

/**
 * Promotion-code rules: codes are for the monthly plan only (the annual price is already
 * discounted) and for a first subscription only. Returns an error code or null.
 */
export function promotionBlock(user, plan) {
  if (plan === "annual") return "coupon_monthly_only";
  if (user && (user.everSubscribed || (user.subscription && user.subscription.id))) return "coupon_new_only";
  return null;
}

/**
 * Should a webhook's subscription overwrite the one stored on the account? A different
 * subscription that has ended must never replace a running one (an old subscription's final
 * event arriving after a new purchase); a running one replaces an ended one.
 */
export function shouldApplySubscription(current, incoming, now = Date.now()) {
  if (!current || !current.id || current.id === incoming.id) return true;
  if (isRunning(incoming, now)) return true;
  return !isRunning(current, now);
}

export function billingProvider() {
  const s = cfg.stripe();
  if (s.secretKey && s.priceId) return "stripe";
  const l = cfg.lemon();
  if (l.checkoutUrl || (l.store && l.variantId)) return "lemonsqueezy";
  return null;
}
export const billingEnabled = () => billingProvider() !== null;

/** URL that starts a subscription for this user. */
/** Validate a coupon code typed on the site; null when the provider has no such active code. */
export async function lookupCoupon(code) {
  if (billingProvider() !== "stripe") return null;
  return stripe.findPromotionCode(code);
}

export async function checkoutUrl(user, plan = "monthly", promotionCode = null, now = Date.now()) {
  const p = billingProvider();
  if (p === "stripe") {
    // One open checkout per account: a second tab's session is expired before a new one starts.
    await stripe.expireCheckoutSession(user.checkoutSessionId);
    // The remaining free trial or access-code months carry into Stripe as a trial.
    const trialEndMs = user.trialEndsAt && user.trialEndsAt > now ? user.trialEndsAt : null;
    const r = await stripe.createCheckoutSession(user, { siteUrl: cfg.siteUrl(), plan, promotionCode, allowPromotionCodes: !promotionBlock(user, plan), trialEndMs });
    user.stripeCustomerId = r.customerId; user.checkoutSessionId = r.sessionId;
    await saveUser(user);
    return r.url;
  }
  if (p === "lemonsqueezy") return lemon.checkoutUrl(user);
  return null;
}

/** The Stripe customer id on file for the user, if any. */
export const stripeCustomerOf = (user) => user.stripeCustomerId || (user.subscription && user.subscription.provider === "stripe" ? user.subscription.customerId : null) || null;

/** URL of the billing portal for the user's subscription, or null. */
export async function portalUrl(user) {
  const sub = user.subscription;
  const customer = stripeCustomerOf(user);
  if (billingProvider() === "stripe" && customer) {
    try { return await stripe.createPortalSession(customer, { siteUrl: cfg.siteUrl() }); }
    catch (e) { if (e.stripeCode === "resource_missing") return null; throw e; }
  }
  if (!sub?.id) return null;
  return (await lemon.freshPortalUrl(sub.id)) || sub.portalUrl || null;
}

/** Undo a scheduled cancellation (Stripe). Returns the updated record, or null. */
export async function resumeSubscription(user) {
  const sub = user.subscription;
  if (!sub?.id || sub.provider !== "stripe") return null;
  const updated = await stripe.resumeSubscription(sub.id);
  return { ...sub, ...keepCard(sub, stripe.subscriptionRecord(updated)), lastEvent: "resumed_by_user" };
}

/** End the subscription immediately (account deletion). Returns true when Stripe confirmed it. */
export async function cancelSubscriptionNow(user) {
  const sub = user.subscription;
  if (!sub?.id) return false;
  if (sub.provider === "stripe") { await stripe.cancelNow(sub.id); return true; }
  return !!(await lemon.cancelSubscription(sub.id));
}

/** Billing history for the account page: the customer's invoices with their PDF links. */
export async function billingHistory(user) {
  const customer = stripeCustomerOf(user);
  if (billingProvider() !== "stripe" || !customer) return [];
  let invoices;
  try { invoices = await stripe.listInvoices(customer); }
  catch (e) { if (e.stripeCode === "resource_missing") return []; throw e; }
  return invoices.map((i) => {
    const line = (i.lines && i.lines.data && i.lines.data[0]) || {};
    const period = line.period || {};
    return {
      id: i.id, number: i.number || null, status: i.status, // paid | open | void | uncollectible
      date: new Date((i.status_transitions && i.status_transitions.paid_at || i.created) * 1000).toISOString(),
      periodStart: period.start ? new Date(period.start * 1000).toISOString() : null,
      periodEnd: period.end ? new Date(period.end * 1000).toISOString() : null,
      description: line.description || null,
      currency: i.currency, total: i.total, amountPaid: i.amount_paid,
      tax: Array.isArray(i.total_taxes) ? i.total_taxes.reduce((a, t) => a + (t.amount || 0), 0) : (i.tax || 0),
      discount: Array.isArray(i.total_discount_amounts) ? i.total_discount_amounts.reduce((a, d) => a + (d.amount || 0), 0) : 0,
      reason: i.billing_reason || null, // subscription_create | subscription_cycle | subscription_update
      // Who issued it: "stripe" = sold through Link (Managed Payments merchant of record); "self" = this business.
      issuer: (i.issuer && i.issuer.type) || null, accountName: i.account_name || null,
      pdf: i.invoice_pdf || null, url: i.hosted_invoice_url || null,
    };
  });
}

// Stripe's cancel/resume replies do not always carry the card; keep the one already stored.
function keepCard(prev, next) {
  return { ...next, cardBrand: next.cardBrand || (prev && prev.cardBrand) || null, cardLastFour: next.cardLastFour || (prev && prev.cardLastFour) || null };
}

/** Cancel at period end. Returns the updated subscription record, or null when the provider cannot do it from here. */
export async function cancelSubscription(user) {
  const sub = user.subscription;
  if (!sub?.id) return null;
  if (sub.provider === "stripe") {
    const updated = await stripe.cancelAtPeriodEnd(sub.id);
    return { ...sub, ...keepCard(sub, stripe.subscriptionRecord(updated)), lastEvent: "cancelled_by_user" };
  }
  const r = await lemon.cancelSubscription(sub.id);
  if (!r) return null;
  return { ...sub, status: r.status, endsAt: r.endsAt, renewsAt: r.renewsAt, lastEvent: "cancelled_by_user", updatedAt: new Date().toISOString() };
}
