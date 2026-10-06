// The Hono app: routes, security headers and static files. index.js starts it; tests build it on an in-memory db.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { config, ROOT } from "./config.js";
import { errorBody, originGuard, fail, ApiError, socketIp } from "./http.js";
import { authRoutes, sessionMiddleware, requireUser, ensureOwner, licencedForOthers } from "./auth.js";
import { docsRoutes } from "./docs.js";
import { toolsRoutes } from "./tools/index.js";
import { sampleRoutes } from "./claude/index.js";
import { usageFor, limitsFor, consumeCounter, recordEvent, billingEnabled } from "./meter.js";
import { adminRoutes } from "./admin/index.js";
import { billingRoutes, stripeWebhook } from "./billing/index.js";
import { dqRoutes } from "./dq/index.js";

const PUBLIC = path.join(ROOT, "public");
const WEB = path.join(ROOT, "web");

// CSP for the model page: its two inline scripts by hash, the export libraries from cdnjs, Google Fonts, and the
// jsdelivr fallback for the PDF's Japanese/Chinese font. Nothing else may run or connect.
function pageCsp(html) {
  const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => "'sha256-" + crypto.createHash("sha256").update(m[1]).digest("base64") + "'");
  return [
    "default-src 'self'",
    "script-src 'self' " + hashes.join(" ") + " https://cdnjs.cloudflare.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob:",
    "connect-src 'self' https://cdn.jsdelivr.net",
    "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'", "object-src 'none'",
  ].join("; ");
}
const STRICT_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";

function staticFile(file, type, csp, transform) {
  let cache = null;
  return (c) => {
    if (!cache || !config.production) {
      if (!fs.existsSync(file)) return c.text(`Missing ${path.relative(ROOT, file)}. Run \`npm run build\` first.`, 500);
      let body = fs.readFileSync(file, "utf8");
      if (transform) body = transform(body);
      cache = { body, csp: typeof csp === "function" ? csp(body) : csp };
    }
    c.header("content-type", type);
    c.header("cache-control", "no-cache");
    if (cache.csp) c.header("content-security-policy", cache.csp);
    return c.body(cache.body);
  };
}

export function createApp(db) {
  ensureOwner(db);
  const app = new Hono();

  app.onError((e, c) => {
    const { status, body } = errorBody(e);
    if (!(e instanceof ApiError)) { console.error(e); try { db.logError("server", "unhandled", e?.stack || String(e), { path: c.req.path, userId: c.get("user")?.id }); } catch (_) {} }
    return c.json(body, status);
  });
  app.use("*", async (c, next) => {
    await next();
    c.header("x-content-type-options", "nosniff");
    c.header("referrer-policy", "same-origin");
    if (config.cookieSecure) c.header("strict-transport-security", "max-age=31536000; includeSubDomains");
  });

  // request bodies: saved models and Claude requests can be large, everything else is small
  const BODY_MAX = [["/api/docs/", 3e6], ["/api/sample", 3e6], ["/webhooks/", 512e3]];
  app.use("*", (c, next) => bodyLimit({
    maxSize: BODY_MAX.find(([p]) => c.req.path.startsWith(p))?.[1] || 64e3,
    onError: (c) => c.json({ code: "too_large", message: "This request is too large." }, 413),
  })(c, next));

  // Stripe posts here with its own signature, so it sits before the origin check and the session
  app.post("/webhooks/stripe", stripeWebhook(db));

  app.use("*", originGuard());
  app.use("*", sessionMiddleware(db));

  app.route("/auth", authRoutes(db));
  app.route("/api/docs", docsRoutes(db));
  app.route("/api/tools", toolsRoutes(db));
  app.route("/api/sample", sampleRoutes(db));
  app.route("/api/admin/dq", dqRoutes(db));
  app.route("/api/admin", adminRoutes(db));
  app.route("/api/billing", billingRoutes(db));

  // who is signed in, their plan and usage, and what the page may offer them
  app.get("/api/me", requireUser, (c) => {
    const u = c.get("user");
    const flags = Object.fromEntries(db.all("SELECT key, enabled FROM feature_flags").map((f) => [f.key, !!f.enabled]));
    const usage = usageFor(db, u);
    const licensed = u.role === "owner" || licencedForOthers(db);
    const claudeFlags = flags.notes_drafting || flags.notes_translation || flags.guidance || flags.sec_segments;
    c.header("cache-control", "private, no-store");
    return c.json({
      uid: u.id, email: u.email, role: u.role, mfa: !!u.totp_enrolled,
      plan: usage.plan, usage, savedModels: db.get("SELECT COUNT(*) AS n FROM user_docs WHERE user_id = ? AND kind = 'model'", u.id).n,
      caps: { sample: licensed && claudeFlags && usage.limits.claude_hard_usd !== 0, downloads: flags.exports && usage.limits.exports !== 0 },
      flags, billing: { enabled: billingEnabled(db) }, claude: { stub: config.claudeStub },
    });
  });

  // a download: counted against the plan before the browser saves the file
  app.post("/api/meter/export", requireUser, async (c) => {
    const u = c.get("user");
    const { filename } = (await c.req.json().catch(() => ({}))) || {};
    if (!db.get("SELECT enabled FROM feature_flags WHERE key = 'exports'")?.enabled) fail(403, "feature_disabled", "Downloads are turned off for now.");
    consumeCounter(db, u, "exports");
    const ext = /\.([a-z0-9]{1,5})$/i.exec(String(filename || ""))?.[1]?.toLowerCase() || null;
    recordEvent(db, { userId: u.id, feature: "export", provider: "app", endpoint: ext, ticker: /^[^_]+/.exec(String(filename || ""))?.[0]?.slice(0, 12) || null });
    return c.json({ ok: true });
  });

  // delete my account: saved models, sessions and sign-in data go; usage stays for cost accounting, without the user
  app.post("/api/account/delete", requireUser, async (c) => {
    const u = c.get("user");
    const { confirm } = (await c.req.json().catch(() => ({}))) || {};
    if (String(confirm || "").trim().toLowerCase() !== u.email.toLowerCase()) fail(400, "confirm_email", "Type your email address to confirm.");
    if (u.role === "owner") fail(409, "owner", "The owner's account can't be deleted here.");
    if (db.get("SELECT 1 FROM subscriptions WHERE user_id = ? AND status IN ('active', 'trialing', 'past_due')", u.id)) fail(409, "cancel_first", "Cancel your subscription first (Plans and billing), then delete the account.");
    db.tx(() => {
      for (const t of ["user_docs_history", "usage_period", "period_tickers"]) db.run(`DELETE FROM ${t} WHERE user_id = ?`, u.id);
      db.run("UPDATE usage_events SET user_id = NULL WHERE user_id = ?", u.id);
      db.run("DELETE FROM login_codes WHERE email = ?", u.email);
      db.run("DELETE FROM allowlist WHERE email = ?", u.email);
      db.run("DELETE FROM profiles WHERE id = ?", u.id); // cascades: sessions, saved models, flags, customer link, comps
      db.audit(null, "account.deleted", u.id);
    });
    return c.json({ ok: true });
  });

  app.get("/healthz", (c) => c.json({ ok: true }));

  // ---------- pages ----------
  const devFlag = (body) => (config.devMail ? "window.__CM_DEV = true;\n" : "") + body;
  app.get("/", staticFile(path.join(PUBLIC, "app.html"), "text/html; charset=utf-8", pageCsp));
  app.get("/shim.js", staticFile(path.join(WEB, "shim.js"), "text/javascript; charset=utf-8", null, devFlag));
  app.get("/admin", staticFile(path.join(WEB, "admin", "index.html"), "text/html; charset=utf-8", STRICT_CSP));
  app.get("/admin/admin.js", staticFile(path.join(WEB, "admin", "admin.js"), "text/javascript; charset=utf-8"));
  app.get("/admin/admin.css", staticFile(path.join(WEB, "admin", "admin.css"), "text/css; charset=utf-8"));
  app.get("/account", staticFile(path.join(WEB, "account", "index.html"), "text/html; charset=utf-8", STRICT_CSP));
  app.get("/account/account.js", staticFile(path.join(WEB, "account", "account.js"), "text/javascript; charset=utf-8"));
  // the PDF export's Japanese/Chinese fonts, when downloaded into public/fonts (otherwise the page uses jsdelivr)
  app.get("/fonts/:file", (c) => {
    const f = c.req.param("file");
    if (!/^[A-Za-z0-9_]+\.ttf$/.test(f)) return c.notFound();
    const p = path.join(PUBLIC, "fonts", f);
    if (!fs.existsSync(p)) return c.notFound();
    c.header("content-type", "font/ttf"); c.header("cache-control", "public, max-age=604800");
    return c.body(fs.readFileSync(p));
  });

  // development outbox: sign-in codes when no email service is configured (local requests only)
  if (config.devMail) {
    app.get("/dev/mail", (c) => {
      // by the connection's own address (the Host header is the client's to set), and never through a proxy
      const local = /^(127\.|::1$|::ffff:127\.)/.test(socketIp(c));
      if (!local || c.req.header("x-forwarded-for") || c.req.header("forwarded") || c.req.header("x-real-ip")) return c.notFound();
      const rows = db.all("SELECT at, to_email, subject, body FROM dev_mail ORDER BY id DESC LIMIT 20");
      const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
      c.header("content-security-policy", STRICT_CSP);
      return c.html("<!doctype html><meta charset=utf-8><title>Dev outbox</title><style>body{font:14px system-ui;margin:24px}td{padding:4px 10px;border-bottom:1px solid #ddd;vertical-align:top}</style><h1>Dev outbox</h1><table>" +
        rows.map((r) => `<tr><td>${esc(r.at)}</td><td>${esc(r.to_email)}</td><td><b>${esc(r.subject)}</b><br>${esc(r.body)}</td></tr>`).join("") + "</table>");
    });
  }
  return app;
}
