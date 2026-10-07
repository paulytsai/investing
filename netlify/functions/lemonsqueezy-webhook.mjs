// Receives Lemon Squeezy subscription events and updates the user's entitlement.
import { verifySignature, subscriptionFromPayload } from "../lib/lemonsqueezy.mjs";
import { getUser, findUserByEmail, saveUser } from "../lib/users.mjs";
import { openStore } from "../lib/store.mjs";

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-signature"))) return new Response("Invalid signature", { status: 401 });

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  const eventName = payload?.meta?.event_name || "";
  const eventId = req.headers.get("x-event-id") || `${eventName}:${payload?.data?.id}:${payload?.data?.attributes?.updated_at}`;

  // Idempotency: store every event once.
  const events = await openStore("billing_events");
  const stored = await events.set(`evt:${eventId}`, { eventName, receivedAt: Date.now() }, { onlyIfNew: true });
  if (!stored.modified) return new Response("Duplicate", { status: 200 });

  if (!eventName.startsWith("subscription_")) return new Response("Ignored", { status: 200 });

  const sub = subscriptionFromPayload(payload);
  const userId = payload?.meta?.custom_data?.user_id;
  let user = userId ? await getUser(userId) : null;
  if (!user && sub.email) user = await findUserByEmail(sub.email);
  if (!user) {
    console.warn("webhook: no user for subscription", sub.id, sub.email);
    return new Response("No matching user", { status: 200 });
  }
  // Keep the most recent state only; payment_* events carry the subscription too.
  user.subscription = { ...(user.subscription || {}), ...sub, lastEvent: eventName };
  await saveUser(user);
  return new Response("OK", { status: 200 });
};

export const config = { path: "/api/webhooks/lemonsqueezy" };
