// Test helpers: an app on an in-memory database, sign-in through the dev outbox, JSON requests with the session cookie.
// Import this before anything from server/: it sets the environment the config module reads at import time.
process.env.OWNER_EMAIL = process.env.OWNER_EMAIL || "owner@example.com";
process.env.REQUIRE_ADMIN_MFA = process.env.REQUIRE_ADMIN_MFA || "false";
process.env.CLAUDE_STUB = process.env.CLAUDE_STUB ?? "true";
process.env.FMP_API_KEY = process.env.FMP_API_KEY || "test-key";

const { openDb } = await import("../server/db.js");
const { createApp } = await import("../server/app.js");
const { resetRateLimits } = await import("../server/http.js");

export function makeApp() {
  resetRateLimits();
  const db = openDb(":memory:");
  return { db, app: createApp(db) };
}

// a client bound to one cookie jar
export function client(app) {
  let cookie = "";
  const req = async (method, path, body, headers = {}) => {
    const h = { ...headers };
    if (cookie) h.cookie = cookie;
    if (body !== undefined) h["content-type"] = h["content-type"] || "application/json";
    const res = await app.request(path, { method, headers: h, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
    const set = res.headers.get("set-cookie");
    if (set) { const m = /cm_sid=([^;]*)/.exec(set); if (m) cookie = m[1] ? "cm_sid=" + m[1] : ""; }
    return res;
  };
  return {
    req,
    get: (p) => req("GET", p),
    post: (p, b = {}) => req("POST", p, b),
    put: (p, b) => req("PUT", p, b),
    json: async (method, p, b) => { const r = await req(method, p, b); return { status: r.status, body: await r.json().catch(() => null) }; },
    get cookie() { return cookie; },
  };
}

export async function signIn(app, db, email) {
  const c = client(app);
  await c.post("/auth/start", { email });
  const row = db.get("SELECT subject FROM dev_mail WHERE to_email = ? ORDER BY id DESC LIMIT 1", email);
  if (!row) throw new Error("no code sent to " + email);
  const code = /(\d{6})/.exec(row.subject)[1];
  const r = await c.post("/auth/verify", { email, code });
  if (r.status !== 200) throw new Error("verify failed " + r.status + " " + (await r.text()));
  return c;
}

// let other accounts in: record the display licence (and the legal check) and allowlist the email
export function licenceAndInvite(db, email, role = "user") {
  db.setConfig("licences", { fmp_display: { signed_at: "2026-10-01" }, edgar_tools_display: null, legal: { signed_at: "2026-10-01" } });
  db.run("INSERT INTO allowlist (email, role, invited_at) VALUES (?, ?, ?) ON CONFLICT (email) DO NOTHING", email, role, new Date().toISOString());
}

// read a /api/sample server-sent-event stream into its events
export async function sseEvents(res) {
  const text = await res.text();
  return text.split("\n\n").map((b) => b.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("")).filter(Boolean).map((d) => JSON.parse(d));
}

// replace fetch for FMP URLs with canned payloads: handler(url) -> body (or a Response)
export function stubFmp(handler) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    if (u.hostname === "financialmodelingprep.com") {
      const out = await handler(u);
      return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
    }
    return real(url, init);
  };
  return () => { globalThis.fetch = real; };
}
