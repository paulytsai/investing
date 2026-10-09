// Receives Stripe Billing events and updates the user's entitlement.
//
// Rules:
// - An event is recorded as processed only after it has been applied, so Stripe's retries of an
//   event that failed half-way are processed again (a 500 makes Stripe retry).
// - Only this site's prices count; events for other editions sharing the Stripe account are ignored.
// - The account is found by the subscription's metadata user_id. The email fallback is used only
//   when no user_id exists at all: a user_id whose account is gone means the account was deleted,
//   and a subscription still billing for it is cancelled instead of being attached to whoever
//   registers the same email later.
// - A different subscription that has ended never replaces a running one on the account.
// - A full refund or a dispute ends the subscription immediately (Stripe handles the money under
//   Managed Payments; the site stops renewals and access).
import { verifyWebhook, subscriptionRecord, retrieveSubscription, retrieveCustomer, cancelNow, subscriptionForPayment } from "../lib/stripe.mjs";
import { getUser, findUserByEmail, saveUser } from "../lib/users.mjs";
import { openStore } from "../lib/store.mjs";
import { cfg } from "../lib/config.mjs";
import { logEvent } from "../lib/events.mjs";
import { shouldApplySubscription, isRunning } from "../lib/billing.mjs";

const SUBSCRIPTION_EVENTS = new Set(["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "customer.subscription.paused", "customer.subscription.resumed", "invoice.paid", "invoice.payment_failed"]);
const MONEY_BACK_EVENTS = new Set(["charge.refunded", "charge.dispute.created"]);

const done = (events, event) => events.set(`evt:${event.id}`, { eventName: event.type, processedAt: Date.now() });
const text = (body, status = 200) => new Response(body, { status });

export default async (req) => {
  if (req.method !== "POST") return text("Method not allowed", 405);
  const raw = await req.text();
  if (!verifyWebhook(raw, req.headers.get("stripe-signature"))) return text("Invalid signature", 401);
  let event;
  try { event = JSON.parse(raw); } catch { return text("Bad JSON", 400); }

  const events = await openStore("billing_events");
  if (await events.get(`evt:${event.id}`)) return text("Duplicate");
  if (!SUBSCRIPTION_EVENTS.has(event.type) && !MONEY_BACK_EVENTS.has(event.type)) { await done(events, event); return text("Ignored"); }

  try {
    const result = MONEY_BACK_EVENTS.has(event.type) ? await handleMoneyBack(event) : await handleSubscriptionEvent(event);
    await done(events, event);
    return text(result);
  } catch (e) {
    console.warn("stripe webhook failed", event.type, event.id, e.message);
    return text("Processing failed", 500); // not marked: Stripe retries
  }
};

async function handleSubscriptionEvent(event) {
  const obj = event.data.object;
  let subId = null, userId = null, email = null;
  if (event.type === "checkout.session.completed") { subId = obj.subscription; userId = obj.client_reference_id || obj.metadata?.user_id; email = obj.customer_details?.email || obj.customer_email; }
  else if (event.type.startsWith("customer.subscription.")) { subId = obj.id; userId = obj.metadata?.user_id; }
  else if (event.type.startsWith("invoice.")) { subId = obj.subscription || obj.parent?.subscription_details?.subscription; userId = obj.subscription_details?.metadata?.user_id || obj.parent?.subscription_details?.metadata?.user_id; email = obj.customer_email; }
  if (!subId) return "No subscription";

  const sub = await retrieveSubscription(subId); // throws -> 500 -> retried
  const price = sub.items?.data?.[0]?.price?.id;
  const ours = cfg.stripe().priceIds;
  if (ours.length && price && !ours.includes(price)) return "Other product";
  if (!userId) userId = sub.metadata?.user_id;

  let user = null;
  if (userId) {
    user = await getUser(userId);
    if (!user) {
      // The account was deleted. Never re-attach by email; stop any billing that is still running.
      if (["active", "trialing", "past_due", "unpaid"].includes(sub.status)) {
        await cancelNow(sub.id);
        await logEvent("billing_orphan_cancelled", { detail: sub.id });
        return "Orphan subscription cancelled";
      }
      return "Account deleted";
    }
  } else {
    if (!email && sub.customer) { try { email = (await retrieveCustomer(sub.customer)).email; } catch {} }
    if (email) user = await findUserByEmail(email);
  }
  if (!user) { await logEvent("billing_unmatched", { detail: sub.id }); return "No matching user"; }

  const record = { ...subscriptionRecord(sub), email: email || user.email, lastEvent: event.type };
  if (!shouldApplySubscription(user.subscription, record)) {
    await logEvent("billing_stale_event", { user, detail: `${event.type}_${sub.id}` });
    return "Older subscription ignored";
  }
  const prev = user.subscription && user.subscription.id === record.id ? user.subscription : null;
  user.subscription = { ...(prev || {}), ...record, cardBrand: record.cardBrand || prev?.cardBrand || null, cardLastFour: record.cardLastFour || prev?.cardLastFour || null };
  if (typeof sub.customer === "string") user.stripeCustomerId = sub.customer;
  if (isRunning(user.subscription)) user.everSubscribed = true;
  if (event.type === "checkout.session.completed") user.checkoutSessionId = null;
  await saveUser(user);

  if (event.type === "checkout.session.completed") await logEvent("subscribe", { user, detail: record.plan || "" });
  else if (event.type === "invoice.payment_failed") await logEvent("payment_failed", { user, detail: sub.id });
  else if (event.type === "customer.subscription.deleted") await logEvent("subscription_ended", { user, detail: sub.id });
  return "OK";
}

async function handleMoneyBack(event) {
  const obj = event.data.object;
  if (event.type === "charge.refunded" && !obj.refunded) return "Partial refund: no change"; // goodwill partial refunds keep the subscription
  const paymentIntent = typeof obj.payment_intent === "string" ? obj.payment_intent : obj.payment_intent?.id;
  const subId = await subscriptionForPayment({ paymentIntent, invoice: typeof obj.invoice === "string" ? obj.invoice : null });
  if (!subId) return "No subscription for payment";
  const sub = await retrieveSubscription(subId);
  const ours = cfg.stripe().priceIds;
  const price = sub.items?.data?.[0]?.price?.id;
  if (ours.length && price && !ours.includes(price)) return "Other product";
  if (sub.status !== "canceled" && sub.status !== "incomplete_expired") await cancelNow(sub.id); // customer.subscription.deleted follows and updates the account
  const user = sub.metadata?.user_id ? await getUser(sub.metadata.user_id) : null;
  await logEvent(event.type === "charge.refunded" ? "refund_cancelled" : "dispute_cancelled", { user: user || undefined, detail: sub.id });
  return "Subscription ended";
}

export const config = { path: "/api/webhooks/stripe" };
