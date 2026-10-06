// Stripe over its REST API with fetch (no SDK): form-encoded requests, a pinned API version, and webhook signature
// checks with node:crypto. Everything Stripe-shaped that the rest of billing needs goes through here.
import crypto from "node:crypto";
import { config } from "../config.js";

export const STRIPE_API = "https://api.stripe.com";
// pinned so object shapes don't change under us; subscriptions carry their periods on items, invoices name their
// subscription under parent.subscription_details (index.js also reads the older shapes)
export const STRIPE_VERSION = "2026-08-26.dahlia";
export const SIGNATURE_TOLERANCE_SEC = 300;

export class StripeError extends Error {
  constructor(status, err = {}) {
    super(err.message || `Stripe request failed (${status || "network"})`);
    this.status = status; this.type = err.type; this.code = err.code; this.param = err.param;
  }
}

// Stripe's bracket encoding: {a: {b: [1, 2]}} -> a[b][0]=1&a[b][1]=2 (brackets left readable, as Stripe's own libraries do)
export function encodeForm(params) {
  const out = [];
  const walk = (v, key) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${key}[${i}]`));
    else if (typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, key ? `${key}[${k}]` : k);
    else out.push(encodeURIComponent(key).replace(/%5B/g, "[").replace(/%5D/g, "]") + "=" + encodeURIComponent(String(v)));
  };
  walk(params, "");
  return out.join("&");
}

// One call. GETs and requests with an idempotency key are retried once on a network error, 429 or 5xx.
export async function stripe(method, path, params = {}, { key = config.stripeSecretKey, idempotencyKey, timeoutMs = 20000 } = {}) {
  if (!key) throw new StripeError(0, { message: "STRIPE_SECRET_KEY is not set." });
  const form = encodeForm(params);
  const get = method === "GET" || method === "DELETE";
  const url = STRIPE_API + path + (get && form ? "?" + form : "");
  const headers = { authorization: `Bearer ${key}`, "stripe-version": STRIPE_VERSION };
  if (!get) headers["content-type"] = "application/x-www-form-urlencoded";
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  const retryable = get || !!idempotencyKey;
  for (let attempt = 0; ; attempt++) {
    let res;
    try { res = await fetch(url, { method, headers, body: get ? undefined : form, signal: AbortSignal.timeout(timeoutMs) }); }
    catch (e) {
      if (retryable && attempt === 0) { await new Promise((r) => setTimeout(r, 400)); continue; }
      throw new StripeError(0, { message: `Couldn't reach Stripe: ${e.message}` });
    }
    const data = await res.json().catch(() => null);
    if (res.ok) return data;
    if (retryable && attempt === 0 && (res.status === 429 || res.status >= 500)) { await new Promise((r) => setTimeout(r, 400)); continue; }
    throw new StripeError(res.status, data?.error);
  }
}

export const keyIsLive = (key = config.stripeSecretKey) => /^(sk|rk)_live_/.test(key || "");

// ---------- webhook signatures ----------
export class SignatureError extends Error {}

const hmac = (secret, t, raw) => crypto.createHmac("sha256", secret).update(`${t}.${raw}`, "utf8").digest();

// Stripe-Signature: t=<unix>,v1=<hex>[,v1=<hex>...][,v0=...]. Every v1 is checked (Stripe sends several while a
// secret is being rolled); secrets may be a comma-separated list for the same reason on our side.
export function verifyWebhook(raw, header, secrets, { toleranceSec = SIGNATURE_TOLERANCE_SEC, now = Math.floor(Date.now() / 1000) } = {}) {
  if (!header) throw new SignatureError("Missing Stripe-Signature header.");
  let t = null; const sigs = [];
  for (const part of String(header).split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k === "t") t = /^\d+$/.test(v) ? Number(v) : null;
    else if (k === "v1" && /^[0-9a-f]{64}$/i.test(v)) sigs.push(Buffer.from(v, "hex"));
  }
  if (t === null || !sigs.length) throw new SignatureError("Malformed Stripe-Signature header.");
  const keys = (Array.isArray(secrets) ? secrets : String(secrets || "").split(",")).map((s) => s.trim()).filter(Boolean);
  if (!keys.length) throw new SignatureError("No webhook secret configured.");
  const ok = keys.some((s) => { const want = hmac(s, t, raw); return sigs.some((g) => crypto.timingSafeEqual(g, want)); });
  if (!ok) throw new SignatureError("No signature matches.");
  if (Math.abs(now - t) > toleranceSec) throw new SignatureError("Signature timestamp is outside the tolerance.");
  return t;
}

// the header Stripe would send (tests, local replays)
export function signWebhook(raw, secret, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${hmac(secret, t, raw).toString("hex")}`;
}
