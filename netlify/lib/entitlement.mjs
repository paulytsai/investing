// Decides whether a user may read paid data: free trial, then Lemon Squeezy subscription.
import { getUser } from "./users.mjs";
import { sessionFromRequest } from "./session.mjs";
import { HttpError } from "./http.mjs";

const ACTIVE_STATUSES = new Set(["active", "on_trial", "past_due"]);

export function entitlement(user, now = Date.now()) {
  if (user?.role === "admin") return { access: true, state: "admin" };
  if (user?.plan === "free") return { access: true, state: "complimentary" };
  const sub = user?.subscription;
  if (sub) {
    if (ACTIVE_STATUSES.has(sub.status)) {
      return { access: true, state: "subscribed", status: sub.status, renewsAt: sub.renewsAt || null, endsAt: sub.endsAt || null };
    }
    if (sub.status === "cancelled" && sub.endsAt && Date.parse(sub.endsAt) > now) {
      return { access: true, state: "cancelled_grace", status: sub.status, endsAt: sub.endsAt };
    }
  }
  if (user?.trialEndsAt && user.trialEndsAt > now) {
    const daysLeft = Math.ceil((user.trialEndsAt - now) / 86400000);
    return { access: true, state: "trial", trialEndsAt: user.trialEndsAt, daysLeft };
  }
  return { access: false, state: sub ? "lapsed" : "trial_expired", status: sub?.status || null, trialEndsAt: user?.trialEndsAt || null };
}

/** Resolve the logged-in user from the request cookie, or null. */
export async function currentUser(req) {
  const session = sessionFromRequest(req);
  if (!session?.uid) return null;
  return getUser(session.uid);
}

/** Throw 401/402 unless the request belongs to an entitled user. */
export async function requireEntitled(req) {
  const user = await currentUser(req);
  if (!user) throw new HttpError(401, "unauthenticated");
  const ent = entitlement(user);
  if (!ent.access) throw new HttpError(402, "subscription_required", "Subscription required", { entitlement: ent });
  return { user, entitlement: ent };
}

export async function requireAdmin(req) {
  const user = await currentUser(req);
  if (!user) throw new HttpError(401, "unauthenticated");
  if (user.role !== "admin") throw new HttpError(403, "forbidden");
  return user;
}
