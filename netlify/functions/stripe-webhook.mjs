// Receives Stripe Billing events and updates the user's entitlement.
import { verifyWebhook, subscriptionRecord, retrieveSubscription, retrieveCustomer } from "../lib/stripe.mjs";
import { getUser, findUserByEmail, saveUser } from "../lib/users.mjs";
import { openStore } from "../lib/store.mjs";

const HANDLED = new Set(["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "customer.subscription.paused", "customer.subscription.resumed", "invoice.paid", "invoice.payment_failed"]);

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const raw = await req.text();
  if (!verifyWebhook(raw, req.headers.get("stripe-signature"))) return new Response("Invalid signature", { status: 401 });
  let event;
  try { event = JSON.parse(raw); } catch { return new Response("Bad JSON", { status: 400 }); }

  // Idempotency: every event once.
  const events = await openStore("billing_events");
  const stored = await events.set(`evt:${event.id}`, { eventName: event.type, receivedAt: Date.now() }, { onlyIfNew: true });
  if (!stored.modified) return new Response("Duplicate", { status: 200 });
  if (!HANDLED.has(event.type)) return new Response("Ignored", { status: 200 });

  const obj = event.data.object;
  // Find the subscription this event is about.
  let subId = null, userId = null, email = null;
  if (event.type === "checkout.session.completed") { subId = obj.subscription; userId = obj.client_reference_id || obj.metadata?.user_id; email = obj.customer_details?.email || obj.customer_email; }
  else if (event.type.startsWith("customer.subscription.")) { subId = obj.id; userId = obj.metadata?.user_id; }
  else if (event.type.startsWith("invoice.")) { subId = obj.subscription || obj.parent?.subscription_details?.subscription; userId = obj.subscription_details?.metadata?.user_id || obj.parent?.subscription_details?.metadata?.user_id; email = obj.customer_email; }
  if (!subId) return new Response("No subscription", { status: 200 });

  let sub;
  try { sub = await retrieveSubscription(subId); } catch (e) { console.warn("stripe webhook: cannot load subscription", subId, e.message); return new Response("Subscription lookup failed", { status: 500 }); }
  if (!userId) userId = sub.metadata?.user_id;
  let user = userId ? await getUser(userId) : null;
  if (!user && !email && sub.customer) { try { email = (await retrieveCustomer(sub.customer)).email; } catch {} }
  if (!user && email) user = await findUserByEmail(email);
  if (!user) { console.warn("stripe webhook: no user for subscription", subId, email); return new Response("No matching user", { status: 200 }); }

  user.subscription = { ...(user.subscription || {}), ...subscriptionRecord(sub), email: email || user.email, lastEvent: event.type };
  await saveUser(user);
  return new Response("OK", { status: 200 });
};

export const config = { path: "/api/webhooks/stripe" };
