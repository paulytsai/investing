// Lemon Squeezy helpers: hosted checkout link, customer portal, webhook verification.
import crypto from "node:crypto";
import { cfg } from "./config.mjs";

export function checkoutUrl(user) {
  const lemon = cfg.lemon();
  let base;
  if (lemon.checkoutUrl) base = lemon.checkoutUrl;
  else if (lemon.store && lemon.variantId) base = `https://${lemon.store}.lemonsqueezy.com/checkout/buy/${lemon.variantId}`;
  else return null;
  const url = new URL(base);
  url.searchParams.set("checkout[email]", user.email);
  url.searchParams.set("checkout[name]", user.username);
  url.searchParams.set("checkout[custom][user_id]", user.id);
  return url.toString();
}

export function verifySignature(rawBody, signatureHeader) {
  const secret = cfg.lemon().webhookSecret;
  if (!secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signatureHeader || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Map a subscription webhook payload to the record stored on the user. */
export function subscriptionFromPayload(payload) {
  const a = payload?.data?.attributes || {};
  return {
    id: String(payload?.data?.id || ""),
    status: a.status || null,
    statusFormatted: a.status_formatted || null,
    customerId: a.customer_id ? String(a.customer_id) : null,
    orderId: a.order_id ? String(a.order_id) : null,
    productId: a.product_id ? String(a.product_id) : null,
    variantId: a.variant_id ? String(a.variant_id) : null,
    email: a.user_email || null,
    renewsAt: a.renews_at || null,
    endsAt: a.ends_at || null,
    trialEndsAt: a.trial_ends_at || null,
    cardBrand: a.card_brand || null,
    cardLastFour: a.card_last_four || null,
    portalUrl: a.urls?.customer_portal || null,
    updatePaymentUrl: a.urls?.update_payment_method || null,
    updatedAt: new Date().toISOString(),
  };
}

/** Fresh customer-portal link via the API (signed links in webhooks expire). */
export async function freshPortalUrl(subscriptionId) {
  const { apiKey } = cfg.lemon();
  if (!apiKey || !subscriptionId) return null;
  const res = await fetch(`https://api.lemonsqueezy.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    headers: { accept: "application/vnd.api+json", authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.data?.attributes?.urls?.customer_portal || null;
}
