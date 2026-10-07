import test from "node:test";
import assert from "node:assert/strict";
import { entitlement } from "../netlify/lib/entitlement.mjs";
import { createToken, verifyToken } from "../netlify/lib/session.mjs";
import { hashPassword, verifyPassword, validateSignup } from "../netlify/lib/users.mjs";
import { verifySignature, checkoutUrl } from "../netlify/lib/lemonsqueezy.mjs";
import crypto from "node:crypto";

const DAY = 86400000;

test("trial entitlement", () => {
  const now = Date.now();
  assert.equal(entitlement({ trialEndsAt: now + 3 * DAY }, now).state, "trial");
  assert.equal(entitlement({ trialEndsAt: now + 3 * DAY }, now).daysLeft, 3);
  assert.equal(entitlement({ trialEndsAt: now - 1 }, now).access, false);
  assert.equal(entitlement({ trialEndsAt: now - 1 }, now).state, "trial_expired");
});

test("subscription entitlement", () => {
  const now = Date.now();
  const expired = { trialEndsAt: now - DAY };
  assert.equal(entitlement({ ...expired, subscription: { status: "active" } }, now).access, true);
  assert.equal(entitlement({ ...expired, subscription: { status: "past_due" } }, now).access, true);
  assert.equal(entitlement({ ...expired, subscription: { status: "expired" } }, now).state, "lapsed");
  const grace = entitlement({ ...expired, subscription: { status: "cancelled", endsAt: new Date(now + DAY).toISOString() } }, now);
  assert.equal(grace.state, "cancelled_grace");
  const over = entitlement({ ...expired, subscription: { status: "cancelled", endsAt: new Date(now - DAY).toISOString() } }, now);
  assert.equal(over.access, false);
});

test("session tokens round-trip and reject tampering", () => {
  const tok = createToken({ uid: "u1" });
  assert.equal(verifyToken(tok).uid, "u1");
  assert.equal(verifyToken(tok.slice(0, -2) + "zz"), null);
  assert.equal(verifyToken("garbage"), null);
});

test("passwords hash with scrypt and verify", () => {
  const h = hashPassword("correct horse");
  assert.ok(h.startsWith("scrypt$"));
  assert.equal(verifyPassword("correct horse", h), true);
  assert.equal(verifyPassword("wrong", h), false);
});

test("signup validation", () => {
  assert.throws(() => validateSignup({ username: "ab", email: "a@b.co", password: "12345678" }));
  assert.throws(() => validateSignup({ username: "alice", email: "nope", password: "12345678" }));
  assert.throws(() => validateSignup({ username: "alice", email: "a@b.co", password: "short" }));
  validateSignup({ username: "alice_1", email: "a@b.co", password: "12345678" });
});

test("lemon squeezy webhook signature and checkout link", () => {
  process.env.LEMONSQUEEZY_WEBHOOK_SECRET = "s3cret";
  process.env.LEMONSQUEEZY_STORE = "shop";
  process.env.LEMONSQUEEZY_VARIANT_ID = "42";
  const body = JSON.stringify({ meta: { event_name: "subscription_created" } });
  const sig = crypto.createHmac("sha256", "s3cret").update(body).digest("hex");
  assert.equal(verifySignature(body, sig), true);
  assert.equal(verifySignature(body + " ", sig), false);
  const url = new URL(checkoutUrl({ id: "uid-1", email: "x@y.z", username: "x" }));
  assert.equal(url.hostname, "shop.lemonsqueezy.com");
  assert.equal(url.searchParams.get("checkout[custom][user_id]"), "uid-1");
  assert.equal(url.searchParams.get("checkout[email]"), "x@y.z");
});
