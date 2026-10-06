// Shared HTTP helpers: error shape, origin check, rate limits.
import { config } from "./config.js";

// Errors go back as {code, message, retryable?, retryAfterMs?}: the shape the page's call(), sampleFailed() and
// errorMessage() already read from claude.ai capability errors.
export class ApiError extends Error {
  constructor(status, code, message, extra = {}) { super(message || code); this.status = status; this.code = code; this.extra = extra; }
}
export const fail = (status, code, message, extra) => { throw new ApiError(status, code, message, extra); };

export function errorBody(e) {
  if (e instanceof ApiError) return { status: e.status, body: { code: e.code, message: e.message, ...e.extra } };
  return { status: 500, body: { code: "server_error", message: "Something went wrong on the server." } };
}

// State-changing requests must come from our own origin, as JSON. With SameSite=Lax cookies this blocks
// cross-site form posts and fetches (a cross-site JSON POST needs a CORS preflight we never approve).
export function originGuard() {
  const allowed = new Set([new URL(config.baseUrl).origin]);
  return async (c, next) => {
    const m = c.req.method;
    if (m !== "GET" && m !== "HEAD" && m !== "OPTIONS") {
      const origin = c.req.header("origin");
      if (origin && !allowed.has(origin) && !(origin === new URL(c.req.url).origin)) return c.json({ code: "forbidden", message: "Cross-origin request refused." }, 403);
      const ct = c.req.header("content-type") || "";
      if (!/^application\/json\b/i.test(ct)) return c.json({ code: "bad_request", message: "Send JSON." }, 415);
    }
    return next();
  };
}

// a small token bucket per key, in memory (enough for one server process)
const buckets = new Map();
export function takeToken(key, capacity, refillPerSec) {
  const now = Date.now();
  // keep the map bounded: drop buckets idle for an hour (they'd be full again anyway)
  if (buckets.size > 20000) for (const [k, v] of buckets) if (now - v.at > 3600e3) buckets.delete(k);
  let b = buckets.get(key);
  if (!b) { b = { tokens: capacity, at: now }; buckets.set(key, b); }
  b.tokens = Math.min(capacity, b.tokens + ((now - b.at) / 1000) * refillPerSec);
  b.at = now;
  if (b.tokens < 1) return Math.ceil(((1 - b.tokens) / refillPerSec) * 1000);
  b.tokens -= 1;
  return 0;
}
export function rateLimit(key, capacity, refillPerSec, what = "requests") {
  const wait = takeToken(key, capacity, refillPerSec);
  if (wait) fail(429, "rate_limited", `Too many ${what}. Try again in a moment.`, { retryable: true, retryAfterMs: wait });
}
// for tests
export function resetRateLimits() { buckets.clear(); }

// the client's address: the connection's, or with TRUST_PROXY=n the address n hops from the right of X-Forwarded-For
// (each trusted proxy appends the address it saw; anything further left is whatever the client sent)
export const socketIp = (c) => c.env?.incoming?.socket?.remoteAddress || "local";
export function clientIp(c) {
  if (config.trustProxy > 0) {
    const xff = (c.req.header("x-forwarded-for") || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (xff.length >= config.trustProxy) return xff[xff.length - config.trustProxy];
  }
  return socketIp(c);
}
