// One billing surface for the account page and the paywall. The provider is chosen by
// configuration: Stripe when STRIPE_SECRET_KEY and STRIPE_PRICE_ID are set, otherwise
// Lemon Squeezy when its store and variant are set. Each edition's site sets its own.
import { cfg } from "./config.mjs";
import * as lemon from "./lemonsqueezy.mjs";
import * as stripe from "./stripe.mjs";

export function billingProvider() {
  const s = cfg.stripe();
  if (s.secretKey && s.priceId) return "stripe";
  const l = cfg.lemon();
  if (l.checkoutUrl || (l.store && l.variantId)) return "lemonsqueezy";
  return null;
}
export const billingEnabled = () => billingProvider() !== null;

/** URL that starts a subscription for this user. */
export async function checkoutUrl(user) {
  const p = billingProvider();
  if (p === "stripe") return stripe.createCheckoutSession(user, { siteUrl: cfg.siteUrl() });
  if (p === "lemonsqueezy") return lemon.checkoutUrl(user);
  return null;
}

/** URL of the billing portal for the user's subscription, or null. */
export async function portalUrl(user) {
  const sub = user.subscription;
  if (!sub?.id) return null;
  if (sub.provider === "stripe" || (billingProvider() === "stripe" && sub.customerId && String(sub.customerId).startsWith("cus_"))) {
    return sub.customerId ? stripe.createPortalSession(sub.customerId, { siteUrl: cfg.siteUrl() }) : null;
  }
  return (await lemon.freshPortalUrl(sub.id)) || sub.portalUrl || null;
}

/** Cancel at period end. Returns the updated subscription record, or null when the provider cannot do it from here. */
export async function cancelSubscription(user) {
  const sub = user.subscription;
  if (!sub?.id) return null;
  if (sub.provider === "stripe") {
    const updated = await stripe.cancelAtPeriodEnd(sub.id);
    return { ...sub, ...stripe.subscriptionRecord(updated), lastEvent: "cancelled_by_user" };
  }
  const r = await lemon.cancelSubscription(sub.id);
  if (!r) return null;
  return { ...sub, status: r.status, endsAt: r.endsAt, renewsAt: r.renewsAt, lastEvent: "cancelled_by_user", updatedAt: new Date().toISOString() };
}
