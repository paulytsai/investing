// Site-side access codes: a code gives N months of free access with no card, by extending the
// user's free period (trialEndsAt). Stripe asks for the card only when the free period ends and
// the member subscribes. Codes live in the users store under coupon:CODE.
import { openStore } from "./store.mjs";
import { saveUser } from "./users.mjs";
import { HttpError } from "./http.mjs";

export function normalizeCode(code) {
  return String(code || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 40);
}

export async function getAccessCode(code) {
  const c = normalizeCode(code);
  if (!c) return null;
  const store = await openStore("users");
  return (await store.get(`coupon:${c}`)) || null;
}

export async function listAccessCodes() {
  const store = await openStore("users");
  const keys = await store.list("coupon:");
  return (await Promise.all(keys.map((k) => store.get(k)))).filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
}

/** Create or update a code. months: free months granted; maxUses: 0 = unlimited; expiresAt: ms or null. */
export async function createAccessCode({ code, months, maxUses = 0, expiresAt = null, note = "" }) {
  const c = normalizeCode(code);
  const m = Number(months);
  if (!c || c.length < 3) throw new HttpError(400, "invalid_code");
  if (!Number.isFinite(m) || m < 1 || m > 60) throw new HttpError(400, "invalid_months");
  const store = await openStore("users");
  const existing = await store.get(`coupon:${c}`);
  const rec = { code: c, months: Math.round(m), maxUses: Math.max(0, Math.round(Number(maxUses) || 0)), expiresAt: expiresAt ? Number(expiresAt) : null, note: String(note || "").slice(0, 120), uses: existing?.uses || 0, createdAt: existing?.createdAt || Date.now(), active: true };
  await store.set(`coupon:${c}`, rec);
  return rec;
}

export async function deactivateAccessCode(code) {
  const store = await openStore("users");
  const rec = await store.get(`coupon:${normalizeCode(code)}`);
  if (!rec) throw new HttpError(404, "not_found");
  rec.active = false;
  await store.set(`coupon:${rec.code}`, rec);
  return rec;
}

/** Why a code cannot be used right now, or null when it can. */
export function accessCodeProblem(rec, user, now = Date.now()) {
  if (!rec || !rec.active) return "invalid_coupon";
  if (rec.expiresAt && rec.expiresAt < now) return "invalid_coupon";
  if (rec.maxUses && rec.uses >= rec.maxUses) return "invalid_coupon";
  if (user && (user.coupons || []).some((x) => x.code === rec.code)) return "coupon_used";
  return null;
}

/** Add the code's months to the user's free period, counting from today or from the current end, whichever is later. */
export async function redeemAccessCode(user, code) {
  const rec = await getAccessCode(code);
  const problem = accessCodeProblem(rec, user);
  if (problem) throw new HttpError(problem === "coupon_used" ? 409 : 404, problem);
  const now = Date.now();
  const from = new Date(Math.max(now, user.trialEndsAt || 0));
  const until = new Date(from); until.setUTCMonth(until.getUTCMonth() + rec.months);
  user.trialEndsAt = until.getTime();
  user.coupons = [...(user.coupons || []), { code: rec.code, months: rec.months, at: now }];
  await saveUser(user);
  const store = await openStore("users");
  rec.uses = (rec.uses || 0) + 1; rec.lastUsedAt = now;
  await store.set(`coupon:${rec.code}`, rec);
  return { user, until: user.trialEndsAt, months: rec.months };
}
