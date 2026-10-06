// Admin API: access control, the owner-only changes, audit rows, and the settings gates (licences before billing).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeApp, client, signIn } from "./helpers.js";

const { planFor, recordEvent } = await import("../server/meter.js");
const { applyVersions } = await import("../server/claude/index.js");
const here = path.dirname(fileURLToPath(import.meta.url));
const D = JSON.parse(fs.readFileSync(path.join(here, "../server/claude/prompts.default.json"), "utf8"));
const OWNER = "owner@example.com";
const A = "/api/admin";

// owner signed in, the display licence recorded through the API, and the given people invited and signed in
async function setup(invites = {}) {
  const { app, db } = makeApp();
  const owner = await signIn(app, db, OWNER);
  const lic = await owner.json("POST", A + "/settings/licences", { which: "fmp_display", signed_at: "2026-10-01", reference: "FMP-123" });
  assert.equal(lic.status, 200, JSON.stringify(lic.body));
  const out = { app, db, owner };
  for (const [name, [email, role]] of Object.entries(invites)) {
    assert.equal((await owner.json("POST", A + "/allowlist", { email, role })).status, 200);
    out[name] = await signIn(app, db, email);
    out[name + "Id"] = db.get("SELECT id FROM profiles WHERE email = ?", email).id;
  }
  return out;
}
const lastAudit = (db, action) => db.get("SELECT * FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1", action);

test("access: anonymous 401, users 403, owner and admins in; /me-admin reports MFA state", async () => {
  const { app, user, admin, owner } = await setup({ user: ["user@example.com", "user"], admin: ["admin@example.com", "admin"] });
  assert.equal((await client(app).json("GET", A + "/overview")).status, 401);
  const u = await user.json("GET", A + "/overview");
  assert.equal(u.status, 403);
  assert.equal(u.body.code, "forbidden");
  assert.equal((await user.json("GET", A + "/me-admin")).status, 403);
  assert.equal((await user.json("POST", A + "/flags/exports", { enabled: false })).status, 403);
  assert.equal((await admin.json("GET", A + "/overview")).status, 200);
  const me = await owner.json("GET", A + "/me-admin");
  assert.equal(me.status, 200);
  assert.deepEqual(me.body.mfa, { required: false, enrolled: false, aal2: false });
  assert.equal(me.body.role, "owner");
});

test("overview: counts users, Claude cost, upstream calls, dq flags, errors, revenue and MRR", async () => {
  const { db, owner, userId } = await setup({ user: ["user@example.com", "user"] });
  recordEvent(db, { userId, feature: "claude", site: "call.summary", provider: "anthropic", costUsd: 0.0123, inputTokens: 1000, outputTokens: 200 });
  recordEvent(db, { userId, feature: "fmp", provider: "fmp", ticker: "NKE", cacheHit: true });
  recordEvent(db, { userId, feature: "fmp", provider: "fmp", ticker: "NKE" });
  db.run("INSERT INTO dq_flags (fingerprint, at, ticker, kind) VALUES ('f1', ?, 'NKE', 'sec_mismatch')", new Date().toISOString());
  db.logError("fmp", "fetch", "boom", { ticker: "NKE" });
  db.run("INSERT INTO invoices (id, user_id, status, currency, amount_due, amount_paid, created_at) VALUES ('in_1', ?, 'paid', 'usd', 2400, 2400, ?)", userId, new Date().toISOString());
  db.run("INSERT INTO subscriptions (id, user_id, status, plan_id, currency, interval, unit_amount, livemode, synced_at) VALUES ('sub_1', ?, 'active', 'plus', 'usd', 'year', 24000, 0, ?)", userId, new Date().toISOString());
  const o = await owner.json("GET", A + "/overview");
  assert.equal(o.status, 200);
  assert.equal(o.body.users.total, 2);
  assert.equal(o.body.users.active7, 2); // just signed in: seen through their sessions
  assert.equal(o.body.claude.today.cost_usd, 0.0123);
  assert.equal(o.body.claude.today.calls, 1);
  assert.equal(o.body.fmp.calls, 2);
  assert.equal(o.body.fmp.hit_rate, 0.5);
  assert.equal(o.body.dq_open, 1);
  assert.equal(o.body.errors_24h, 1);
  assert.deepEqual(o.body.revenue_month, [{ currency: "usd", amount: 2400, invoices: 1 }]);
  assert.equal(o.body.mrr.by_currency.usd, 2000);
  assert.equal(o.body.state.licensed_for_others, true);
  assert.equal(o.body.state.billing.enabled, false);
});

test("users: list and detail show plan, usage and counts, never document contents or secrets", async () => {
  const { db, owner, userId } = await setup({ user: ["user@example.com", "user"] });
  db.run("INSERT INTO user_docs (user_id, doc_id, kind, ticker, json, bytes, created_at, updated_at) VALUES (?, 'model-NKE', 'model', 'NKE', ?, 40, 'x', 'x')", userId, JSON.stringify({ secret: "PRIVATE-THESIS-TEXT" }));
  db.run("UPDATE profiles SET totp_secret = 'JBSWY3DPEHPK3PXP' WHERE id = ?", userId);
  const list = await owner.req("GET", A + "/users?q=USER@");
  const listText = await list.text();
  assert.equal(list.status, 200);
  const users = JSON.parse(listText).users;
  assert.equal(users.length, 1);
  assert.equal(users[0].email, "user@example.com");
  assert.equal(users[0].plan.id, "comp");
  assert.equal(users[0].saved_models, 1);
  assert.ok(!listText.includes("PRIVATE-THESIS-TEXT") && !listText.includes("JBSWY3DPEHPK3PXP"));
  const det = await owner.req("GET", A + "/users/" + userId);
  const detText = await det.text();
  assert.equal(det.status, 200);
  assert.ok(!detText.includes("PRIVATE-THESIS-TEXT") && !detText.includes("JBSWY3DPEHPK3PXP"));
  const d = JSON.parse(detText);
  assert.deepEqual(d.docs.map((x) => [x.kind, x.n]), [["model", 1]]);
  assert.equal(d.sessions.n, 1);
  assert.equal((await owner.json("GET", A + "/users/nope")).status, 404);
});

test("users: role changes are the owner's; suspending ends sessions; the owner can't be demoted or suspended", async () => {
  const { db, owner, admin, user, userId, adminId } = await setup({ user: ["user@example.com", "user"], admin: ["admin@example.com", "admin"] });
  const ownerId = db.get("SELECT id FROM profiles WHERE email = ?", OWNER).id;
  assert.equal((await admin.json("POST", A + "/users/" + userId, { role: "admin" })).status, 403);
  assert.equal((await owner.json("POST", A + "/users/" + ownerId, { role: "user" })).body.code, "owner_protected");
  assert.equal((await admin.json("POST", A + "/users/" + ownerId, { status: "disabled" })).body.code, "owner_protected");
  assert.equal((await admin.json("POST", A + "/users/" + adminId, { status: "disabled" })).body.code, "self");
  assert.equal((await owner.json("POST", A + "/users/" + userId, { role: "superuser" })).status, 400);
  // an admin can suspend a user: their session ends at once
  assert.equal((await user.json("GET", "/api/me")).status, 200);
  const s = await admin.json("POST", A + "/users/" + userId, { status: "disabled" });
  assert.equal(s.status, 200);
  assert.equal(s.body.sessions_ended, 1);
  assert.equal((await user.json("GET", "/api/me")).status, 401);
  assert.ok(lastAudit(db, "user.suspended"));
  // the owner promotes; the allowlist row follows
  assert.equal((await owner.json("POST", A + "/users/" + userId, { role: "admin", status: "active" })).status, 200);
  assert.equal(db.get("SELECT role FROM profiles WHERE id = ?", userId).role, "admin");
  assert.equal(db.get("SELECT role FROM allowlist WHERE email = 'user@example.com'").role, "admin");
  assert.equal(JSON.parse(lastAudit(db, "user.role").after).role, "admin");
  // sign out everywhere
  const so = await owner.json("POST", A + "/users/" + adminId + "/signout", {});
  assert.equal(so.body.sessions_ended, 1);
  assert.equal((await admin.json("GET", A + "/overview")).status, 401);
});

test("comps: granting one changes planFor, ending it restores the default", async () => {
  const { db, owner, userId } = await setup({ user: ["user@example.com", "user"] });
  const prof = () => db.get("SELECT * FROM profiles WHERE id = ?", userId);
  assert.equal(planFor(db, prof()).planId, "comp");
  assert.equal((await owner.json("POST", A + "/users/" + userId + "/comp", { plan_id: "nope" })).status, 400);
  assert.equal((await owner.json("POST", A + "/users/" + userId + "/comp", { plan_id: "pro", until: "2020-01-01" })).body.code, "bad_date");
  assert.equal((await owner.json("POST", A + "/users/" + userId + "/comp", { plan_id: "pro", until: "2099-02-30" })).body.code, "bad_date");
  const g = await owner.json("POST", A + "/users/" + userId + "/comp", { plan_id: "pro", until: "2099-12-31", note: "beta tester" });
  assert.equal(g.status, 200);
  assert.deepEqual([planFor(db, prof()).planId, planFor(db, prof()).source], ["pro", "comp"]);
  assert.equal(g.body.user.plan.id, "pro");
  assert.ok(lastAudit(db, "user.comp_granted"));
  const e = await owner.json("DELETE", A + "/users/" + userId + "/comp", {});
  assert.equal(e.status, 200);
  assert.equal(planFor(db, prof()).source, "default");
  assert.equal(db.get("SELECT COUNT(*) AS n FROM comps WHERE user_id = ?", userId).n, 1); // kept as history
  assert.equal((await owner.json("DELETE", A + "/users/" + userId + "/comp", {})).status, 404);
});

test("allowlist: invites before the licence are saved but can't sign in; admin invites are the owner's", async () => {
  const { app, db } = makeApp();
  const owner = await signIn(app, db, OWNER);
  const add = await owner.json("POST", A + "/allowlist", { email: " Friend@Example.com ", role: "user", note: "college friend" });
  assert.equal(add.status, 200);
  assert.equal(add.body.email, "friend@example.com");
  assert.equal(add.body.licensed, false);
  assert.match(add.body.warning, /licence/);
  await client(app).post("/auth/start", { email: "friend@example.com" });
  assert.equal(db.get("SELECT COUNT(*) AS n FROM dev_mail WHERE to_email = 'friend@example.com'").n, 0);
  assert.equal((await owner.json("POST", A + "/allowlist", { email: "not-an-email" })).status, 400);
  assert.equal((await owner.json("DELETE", "/api/admin/allowlist/" + encodeURIComponent(OWNER), {})).body.code, "owner_protected");
  // after the licence, an admin can invite users but not admins, and can't remove an admin's invite
  await owner.post(A + "/settings/licences", { which: "fmp_display", signed_at: "2026-10-01" });
  await owner.post(A + "/allowlist", { email: "admin@example.com", role: "admin" });
  const admin = await signIn(app, db, "admin@example.com");
  assert.equal((await admin.json("POST", A + "/allowlist", { email: "boss@example.com", role: "admin" })).status, 403);
  assert.equal((await admin.json("POST", A + "/allowlist", { email: "pal@example.com", role: "user" })).status, 200);
  assert.equal((await admin.json("DELETE", A + "/allowlist/admin%40example.com", {})).status, 403);
  const list = await admin.json("GET", A + "/allowlist");
  assert.deepEqual(list.body.rows.map((r) => r.email).sort(), ["admin@example.com", "friend@example.com", OWNER, "pal@example.com"].sort());
  assert.equal(list.body.rows.find((r) => r.email === "admin@example.com").account_status, "active");
  const del = await admin.json("DELETE", A + "/allowlist/pal%40example.com", {});
  assert.equal(del.status, 200);
  assert.equal(del.body.account, null);
  assert.ok(lastAudit(db, "allowlist.removed"));
});

test("flags: admins switch features; maintenance is the owner's", async () => {
  const { db, owner, admin } = await setup({ admin: ["admin@example.com", "admin"] });
  const off = await admin.json("POST", A + "/flags/exports", { enabled: false });
  assert.equal(off.status, 200);
  assert.equal(db.get("SELECT enabled FROM feature_flags WHERE key = 'exports'").enabled, 0);
  assert.equal((await admin.json("POST", A + "/flags/maintenance", { enabled: true })).status, 403);
  assert.equal((await owner.json("POST", A + "/flags/maintenance", { enabled: true })).status, 200);
  assert.equal((await owner.json("POST", A + "/flags/maintenance", { enabled: "yes" })).status, 400);
  assert.equal((await owner.json("POST", A + "/flags/nope", { enabled: true })).status, 404);
  const a = lastAudit(db, "flag.set");
  assert.equal(a.target, "maintenance");
  assert.deepEqual([JSON.parse(a.before).enabled, JSON.parse(a.after).enabled], [false, true]);
  const flags = (await admin.json("GET", A + "/flags")).body.flags;
  assert.equal(flags.find((f) => f.key === "exports").enabled, false);
  assert.equal(flags.find((f) => f.key === "maintenance").owner_only, true);
});

test("settings: licences, billing gate (409 without licences, 409 live without Stripe), sign-ups, budgets", async () => {
  const { app, db } = makeApp();
  const owner = await signIn(app, db, OWNER);
  const bill = await owner.json("POST", A + "/settings/billing", { enabled: true });
  assert.equal(bill.status, 409);
  assert.equal(bill.body.code, "licence_required");
  assert.equal((await owner.json("POST", A + "/settings/licences", { which: "fmp_display", signed_at: "2026-13-01" })).status, 400);
  assert.equal((await owner.json("POST", A + "/settings/licences", { which: "nope", signed_at: "2026-10-01" })).status, 400);
  const lic = await owner.json("POST", A + "/settings/licences", { which: "fmp_display", signed_at: "2026-10-01", reference: "FMP-123", note: "display licence" });
  assert.equal(lic.status, 200);
  assert.equal(db.getConfig("licences").fmp_display.signed_at, "2026-10-01");
  assert.equal(lic.body.settings.licences.fmp_display.recorded_by, OWNER);
  assert.equal(lic.body.settings.licensed_for_others, true);
  assert.equal((await owner.json("POST", A + "/settings/billing", { enabled: true })).body.code, "licence_required"); // legal still missing
  await owner.post(A + "/settings/licences", { which: "legal", signed_at: "2026-10-02" });
  const on = await owner.json("POST", A + "/settings/billing", { enabled: true });
  assert.equal(on.status, 200);
  assert.equal(db.getConfig("billing").enabled, true);
  const live = await owner.json("POST", A + "/settings/billing", { live: true });
  assert.equal(live.status, 409);
  assert.equal(live.body.code, "stripe_not_configured");
  assert.equal((await owner.json("POST", A + "/settings/licences", { which: "legal", clear: true })).body.code, "billing_enabled");
  await owner.post(A + "/settings/billing", { enabled: false });
  assert.equal((await owner.json("POST", A + "/settings/licences", { which: "legal", clear: true })).status, 200);
  assert.equal(db.getConfig("licences").legal, null);
  assert.equal((await owner.json("POST", A + "/settings/signups", { open: true })).status, 200);
  assert.equal(db.getConfig("signups").open, true);
  assert.equal((await owner.json("POST", A + "/settings/budgets", { global_claude_usd_day: 0 })).status, 400);
  assert.equal((await owner.json("POST", A + "/settings/budgets", { global_claude_usd_day: 25.5 })).status, 200);
  assert.equal(db.getConfig("budgets").global_claude_usd_day, 25.5);
  assert.ok(lastAudit(db, "settings.billing") && lastAudit(db, "settings.licence_cleared"));
  // admins read settings but can't change them
  await owner.post(A + "/allowlist", { email: "admin@example.com", role: "admin" });
  const admin = await signIn(app, db, "admin@example.com");
  const s = await admin.json("GET", A + "/settings");
  assert.equal(s.status, 200);
  assert.equal(s.body.env.stripe.configured, false);
  assert.equal((await admin.json("POST", A + "/settings/signups", { open: false })).status, 403);
});

test("prompts: a new version is N+1 and validated; only the owner activates it; the Claude route then uses it", async () => {
  const { db, owner, admin } = await setup({ admin: ["admin@example.com", "admin"] });
  const list = await admin.json("GET", A + "/prompts");
  const site = list.body.sites.find((s) => s.site === "call.summary");
  assert.equal(site.json_site, true);
  assert.equal(site.versions.length, 1);
  assert.equal(site.versions[0].active, true);
  const v1 = await admin.json("GET", A + "/prompts/call.summary/versions/" + site.versions[0].id);
  assert.equal(v1.body.body, D.CALL_PROMPT);
  const base = { body: D.CALL_PROMPT.replace("Summarise", "Summarize"), model: "claude-sonnet-5-5", effort: "medium", max_tokens: 20000, note: "US spelling" };
  assert.equal((await admin.json("POST", A + "/prompts/call.summary/versions", { ...base, model: "gpt-9" })).body.code, "bad_model");
  assert.equal((await admin.json("POST", A + "/prompts/call.summary/versions", { ...base, effort: "extreme" })).body.code, "bad_effort");
  assert.equal((await admin.json("POST", A + "/prompts/call.summary/versions", { ...base, max_tokens: 500 })).body.code, "bad_max_tokens");
  assert.equal((await admin.json("POST", A + "/prompts/call.summary/versions", { ...base, body: "  " })).body.code, "bad_body");
  const created = await admin.json("POST", A + "/prompts/call.summary/versions", base);
  assert.equal(created.status, 200);
  assert.equal(created.body.version, 2);
  assert.deepEqual(created.body.warnings, []);
  const noJson = await admin.json("POST", A + "/prompts/call.summary/versions", { ...base, body: "Summarize the call in prose." });
  assert.equal(noJson.body.version, 3);
  assert.equal(noJson.body.warnings.length, 1);
  assert.equal((await admin.json("POST", A + "/prompts/call.summary/activate", { version_id: created.body.id })).status, 403);
  assert.equal((await owner.json("POST", A + "/prompts/guide.call/activate", { version_id: created.body.id })).status, 404);
  const act = await owner.json("POST", A + "/prompts/call.summary/activate", { version_id: created.body.id });
  assert.equal(act.status, 200);
  assert.equal(db.get("SELECT active_version_id FROM prompts WHERE site = 'call.summary'").active_version_id, created.body.id);
  const applied = applyVersions(db, "call.summary", D.CALL_PROMPT + "\n\nTRANSCRIPT:\n...");
  assert.ok(applied.content.startsWith(base.body));
  assert.equal(applied.settings.model, "claude-sonnet-5-5");
  assert.equal(applied.settings.max_tokens, 20000);
  const a = lastAudit(db, "prompt.activated");
  assert.deepEqual([JSON.parse(a.before).version, JSON.parse(a.after).version], [1, 2]);
  // notes.translate has no editable text: a version carries settings only
  assert.equal((await admin.json("POST", A + "/prompts/notes.translate/versions", { model: "claude-haiku-4-5", effort: "low", max_tokens: 32000 })).status, 200);
});

test("usage: per-day totals, per-site and per-user cost, CSV export", async () => {
  const { db, owner, userId } = await setup({ user: ["user@example.com", "user"] });
  recordEvent(db, { userId, feature: "claude", site: "guide.call", provider: "anthropic", costUsd: 0.02, inputTokens: 3000, outputTokens: 500 });
  recordEvent(db, { userId, feature: "claude", site: "guide.call", provider: "anthropic", costUsd: 0.04, inputTokens: 5000, outputTokens: 700 });
  recordEvent(db, { userId, feature: "claude", site: "guide.call", provider: "anthropic", cacheHit: true });
  recordEvent(db, { userId, feature: "fmp", provider: "fmp", ticker: "NKE", cacheHit: true });
  recordEvent(db, { userId, feature: "export", provider: "app", endpoint: "xlsx" });
  const u = await owner.json("GET", A + "/usage?days=7");
  assert.equal(u.status, 200);
  assert.equal(u.body.daily.length, 7);
  assert.equal(u.body.totals.claude_calls, 2);
  assert.equal(u.body.totals.claude_cached, 1);
  assert.equal(u.body.totals.claude_cost_usd, 0.06);
  assert.equal(u.body.totals.fmp_hits, 1);
  assert.equal(u.body.totals.exports, 1);
  const today = u.body.daily.at(-1);
  assert.equal(today.claude_sites["guide.call"], 2);
  const s = u.body.sites.find((x) => x.site === "guide.call");
  assert.deepEqual([s.calls, s.cached, s.avg_input_tokens, s.avg_output_tokens], [2, 1, 4000, 600]);
  assert.equal(u.body.spenders[0].email, "user@example.com");
  assert.equal(u.body.spenders[0].claude_cost_usd, 0.06);
  const csv = await owner.req("GET", A + "/usage/export.csv?days=3");
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-type"), /text\/csv/);
  assert.match(csv.headers.get("content-disposition"), /attachment; filename="usage-.*-3d\.csv"/);
  const lines = (await csv.text()).trim().split("\r\n");
  assert.equal(lines.length, 4);
  assert.ok(lines[0].startsWith("day,claude_cost_usd,claude_calls"));
  assert.ok(lines[3].includes("0.060000"));
});

test("cache: grouped by path and ticker; purge by ticker, path, all; Claude cache by site", async () => {
  const { db, owner } = await setup();
  const put = (key, p, ticker, bytes) => db.run("INSERT INTO fmp_cache (key, path, params, ticker, body, bytes, fetched_at, expires_at_ms, hits) VALUES (?, ?, '{}', ?, '[]', ?, ?, ?, 2)", key, p, ticker, bytes, new Date().toISOString(), Date.now() + 1e6);
  put("k1", "income-statement", "NKE", 100); put("k2", "profile", "NKE", 50); put("k3", "income-statement", "AAPL", 70); put("k4", "treasury-rates", null, 10);
  db.run("INSERT INTO claude_cache (key, site, response, created_at, expires_at_ms) VALUES ('c1', 'guide.call', '{\"a\":1}', ?, ?), ('c2', 'sec.segments', '{}', ?, ?)", new Date().toISOString(), Date.now() + 1e6, new Date().toISOString(), Date.now() + 1e6);
  const g = await owner.json("GET", A + "/cache");
  assert.equal(g.body.fmp.total.count, 4);
  assert.equal(g.body.fmp.by_path.find((x) => x.path === "income-statement").bytes, 170);
  assert.equal(g.body.fmp.by_ticker.find((x) => x.ticker === "NKE").hits, 4);
  assert.equal(g.body.claude.length, 2);
  assert.equal((await owner.json("POST", A + "/cache/purge", {})).status, 400);
  assert.equal((await owner.json("POST", A + "/cache/purge", { ticker: "bad ticker!" })).status, 400);
  assert.equal((await owner.json("POST", A + "/cache/purge", { ticker: "nke" })).body.deleted, 2);
  assert.equal((await owner.json("POST", A + "/cache/purge", { path: "treasury-rates" })).body.deleted, 1);
  assert.equal((await owner.json("POST", A + "/cache/purge", { all: true })).body.deleted, 1);
  assert.equal((await owner.json("POST", A + "/cache/purge-claude", { site: "guide.call" })).body.deleted, 1);
  assert.equal((await owner.json("POST", A + "/cache/purge-claude", {})).body.deleted, 1);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'cache.purged'").n, 5);
});

test("logs: audit and error log page backwards and filter", async () => {
  const { db, owner } = await setup();
  for (let i = 0; i < 5; i++) db.logError(i % 2 ? "fmp" : "claude", "e" + i, "message " + i);
  const e = await owner.json("GET", A + "/errors?limit=2");
  assert.equal(e.body.rows.length, 2);
  assert.equal(e.body.rows[0].message, "message 4");
  const more = await owner.json("GET", A + "/errors?limit=2&before=" + e.body.next);
  assert.equal(more.body.rows[0].message, "message 2");
  const fmp = await owner.json("GET", A + "/errors?source=fmp");
  assert.deepEqual(fmp.body.rows.map((r) => r.code), ["e3", "e1"]);
  assert.equal(fmp.body.next, null);
  const a = await owner.json("GET", A + "/audit?action=settings.");
  assert.ok(a.body.rows.length >= 1);
  assert.ok(a.body.rows.every((r) => r.action.startsWith("settings.")));
  assert.equal(a.body.rows[0].actor_email, OWNER);
  assert.equal(a.body.rows[0].after.signed_at, "2026-10-01");
});

test("plans: the owner edits limits (validated against the plan keys); prices listed", async () => {
  const { db, owner, admin } = await setup({ admin: ["admin@example.com", "admin"] });
  db.run("INSERT INTO plan_prices (id, plan_id, interval, currency_options) VALUES ('price_1', 'plus', 'month', ?)", JSON.stringify({ usd: 2400, jpy: 3600 }));
  const g = await admin.json("GET", A + "/plans");
  const plus = g.body.plans.find((p) => p.id === "plus");
  assert.equal(plus.prices[0].currency_options.jpy, 3600);
  assert.ok(g.body.limit_keys.includes("claude_hard_usd"));
  assert.equal((await admin.json("POST", A + "/plans/plus", { name: "Plus+" })).status, 403);
  assert.equal((await owner.json("POST", A + "/plans/plus", { limits: { bogus: 1 } })).status, 400);
  assert.equal((await owner.json("POST", A + "/plans/plus", { limits: { companies: 2.5 } })).status, 400);
  assert.equal((await owner.json("POST", A + "/plans/plus", { limits: { claude_soft_usd: 50 } })).status, 400); // above the hard cap
  const ok = await owner.json("POST", A + "/plans/plus", { name: "Plus", limits: { companies: 40, exports: null, claude_hard_usd: 20.5 } });
  assert.equal(ok.status, 200);
  const limits = JSON.parse(db.get("SELECT limits FROM plans WHERE id = 'plus'").limits);
  assert.deepEqual([limits.companies, limits.exports, limits.claude_hard_usd, limits.drafts], [40, null, 20.5, 6]);
  assert.equal((await owner.json("POST", A + "/plans/owner", { active: false })).status, 400);
  assert.ok(lastAudit(db, "plan.updated"));
});

// REQUIRE_ADMIN_MFA is read when config.js is imported, so the step-up runs in a fresh process
test("MFA step-up: with REQUIRE_ADMIN_MFA on, the admin API needs a TOTP check in this session", () => {
  const helpers = pathToFileURL(path.join(here, "helpers.js")).href;
  const auth = pathToFileURL(path.join(here, "../server/auth.js")).href;
  const script = `
    const { makeApp, signIn } = await import(${JSON.stringify(helpers)});
    const { totpCode } = await import(${JSON.stringify(auth)});
    const { app, db } = makeApp();
    const owner = await signIn(app, db, "owner@example.com");
    const out = {};
    out.before = await owner.json("GET", "/api/admin/overview");
    out.me1 = (await owner.json("GET", "/api/admin/me-admin")).body;
    const setup = (await owner.json("POST", "/auth/totp/setup", {})).body;
    out.otpauth = setup.otpauth.startsWith("otpauth://totp/");
    out.enable = (await owner.json("POST", "/auth/totp/enable", { code: totpCode(setup.secret, Math.floor(Date.now() / 30000)) })).status;
    out.me2 = (await owner.json("GET", "/api/admin/me-admin")).body;
    out.after = (await owner.json("GET", "/api/admin/overview")).status;
    console.log(JSON.stringify(out));
  `;
  const r = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e", script], {
    env: { ...process.env, REQUIRE_ADMIN_MFA: "true", OWNER_EMAIL: OWNER, NODE_TEST_CONTEXT: "" }, encoding: "utf8", timeout: 30000,
  });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split("\n").at(-1));
  assert.equal(out.before.status, 403);
  assert.equal(out.before.body.code, "mfa_required");
  assert.deepEqual(out.me1.mfa, { required: true, enrolled: false, aal2: false });
  assert.equal(out.otpauth, true);
  assert.equal(out.enable, 200);
  assert.deepEqual(out.me2.mfa, { required: true, enrolled: true, aal2: true });
  assert.equal(out.after, 200);
});
