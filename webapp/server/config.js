// Settings come from the environment (see .env.example). Secrets stay on the server; nothing here reaches the browser.
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..");

// a minimal .env loader, so the app runs with `npm start` and no extra dependency
const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const env = process.env;
const bool = (v, d) => (v === undefined || v === "" ? d : /^(1|true|yes|on)$/i.test(v));
const production = env.NODE_ENV === "production";

export const config = {
  production,
  port: +(env.PORT || 8787),
  // the public origin, used for cookies, links in emails, Stripe return URLs and the Origin check
  baseUrl: (env.BASE_URL || `http://localhost:${env.PORT || 8787}`).replace(/\/$/, ""),
  dataDir: path.resolve(ROOT, env.DATA_DIR || "data"),
  ownerEmail: (env.OWNER_EMAIL || "").trim().toLowerCase(),
  sessionDays: +(env.SESSION_DAYS || 30),
  cookieSecure: bool(env.COOKIE_SECURE, production),
  // reverse proxies in front of the app that append X-Forwarded-For (0: use the connection's address)
  trustProxy: Math.max(0, parseInt(env.TRUST_PROXY || "0", 10) || 0),
  requireAdminMfa: bool(env.REQUIRE_ADMIN_MFA, true),
  // email: Resend when a key is set, otherwise the dev outbox (codes are logged and shown at /dev/mail)
  resendApiKey: env.RESEND_API_KEY || "",
  mailFrom: env.MAIL_FROM || "Company model <no-reply@localhost>",
  devMail: bool(env.DEV_MAIL, !production),
  // data
  fmpBase: (env.FMP_BASE || "https://financialmodelingprep.com/stable").replace(/\/$/, ""),
  fmpApiKey: env.FMP_API_KEY || "",
  fmpFixtures: env.FMP_FIXTURES || "", // path to a fixtures JSON for tests: {TICKER: {"endpoint|period": payload}}
  edgarToolsUrl: env.EDGAR_TOOLS_URL || "https://app.edgar.tools/mcp",
  edgarToolsApiKey: env.EDGAR_TOOLS_API_KEY || "",
  secUserAgent: env.SEC_USER_AGENT || "",
  // Claude: without a key the app runs Claude features in a labelled stub mode
  anthropicApiKey: env.ANTHROPIC_API_KEY || "",
  // set explicitly, so the app never inherits an ANTHROPIC_BASE_URL meant for another tool on the same machine
  claudeBaseUrl: (env.CLAUDE_BASE_URL || "https://api.anthropic.com").replace(/\/$/, ""),
  claudeStub: bool(env.CLAUDE_STUB, !env.ANTHROPIC_API_KEY),
  // billing (off until a display licence and a legal check are recorded in the admin settings)
  stripeSecretKey: env.STRIPE_SECRET_KEY || "",
  stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || "",
};

// www.sec.gov refuses requests that don't identify the app and a contact; only matters without an Edgar Tools key
if (!config.secUserAgent && !config.edgarToolsApiKey && !process.env.NODE_TEST_CONTEXT) {
  console.warn("[config] SEC_USER_AGENT is not set: filings from sec.gov will be refused. Set it to \"<app name> <contact email>\".");
}
if (!config.ownerEmail && !process.env.NODE_TEST_CONTEXT) {
  console.warn("[config] OWNER_EMAIL is not set: nobody can sign in until it is.");
}
