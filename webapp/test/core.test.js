// Core server: sign-in, the licence gate, request guards, saved documents, the data proxy, Claude, quotas.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeApp, client, signIn, licenceAndInvite, sseEvents, stubFmp } from "./helpers.js";

const D = JSON.parse(fs.readFileSync(new URL("../server/claude/prompts.default.json", import.meta.url), "utf8"));
const OWNER = "owner@example.com";

test("signing in: owner by emailed code; nobody else before the licence is recorded", async () => {
  const { app, db } = makeApp();
  const anon = client(app);
  assert.equal((await anon.get("/api/me")).status, 401);
  // invited but unlicensed: same answer, no code sent
  db.run("INSERT INTO allowlist (email, role, invited_at) VALUES ('friend@example.com', 'user', 'x')");
  const r = await anon.json("POST", "/auth/start", { email: "friend@example.com" });
  assert.equal(r.status, 200);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM dev_mail WHERE to_email = 'friend@example.com'").n, 0);
  const owner = await signIn(app, db, OWNER);
  const me = await owner.json("GET", "/api/me");
  assert.equal(me.status, 200);
  assert.equal(me.body.role, "owner");
  assert.equal(me.body.plan.id, "owner");
  assert.equal(me.body.claude.stub, true);
  // after the licence, the invited user can sign in and is complimentary while billing is off
  licenceAndInvite(db, "friend@example.com");
  const friend = await signIn(app, db, "friend@example.com");
  const fm = await friend.json("GET", "/api/me");
  assert.equal(fm.body.role, "user");
  assert.equal(fm.body.plan.id, "comp");
  // a stranger still can't, while sign-ups are closed
  await anon.post("/auth/start", { email: "stranger@example.com" });
  assert.equal(db.get("SELECT COUNT(*) AS n FROM dev_mail WHERE to_email = 'stranger@example.com'").n, 0);
});

test("codes: wrong code counts attempts, a used code can't be reused, logout ends the session", async () => {
  const { app, db } = makeApp();
  const c = client(app);
  await c.post("/auth/start", { email: OWNER });
  const code = /(\d{6})/.exec(db.get("SELECT subject FROM dev_mail ORDER BY id DESC LIMIT 1").subject)[1];
  const wrong = String((+code + 1) % 1e6).padStart(6, "0");
  assert.equal((await c.json("POST", "/auth/verify", { email: OWNER, code: wrong })).body.code, "code_wrong");
  assert.equal((await c.post("/auth/verify", { email: OWNER, code })).status, 200);
  assert.equal((await c.json("POST", "/auth/verify", { email: OWNER, code })).body.code, "code_expired");
  assert.equal((await c.get("/api/me")).status, 200);
  await c.post("/auth/logout", {});
  assert.equal((await c.get("/api/me")).status, 401);
});

test("guards: cross-origin and non-JSON writes are refused", async () => {
  const { app, db } = makeApp();
  const owner = await signIn(app, db, OWNER);
  const evil = await owner.req("PUT", "/api/docs/model-NKE", { data: { json: "{}" } }, { origin: "https://evil.example.com" });
  assert.equal(evil.status, 403);
  const form = await owner.req("POST", "/api/tools", "server=FMP", { "content-type": "application/x-www-form-urlencoded" });
  assert.equal(form.status, 415);
});

test("saved documents are private to each user and keep history", async () => {
  const { app, db } = makeApp();
  const owner = await signIn(app, db, OWNER);
  licenceAndInvite(db, "friend@example.com");
  const friend = await signIn(app, db, "friend@example.com");
  const put = (c, json) => c.json("PUT", "/api/docs/model-NKE", { data: { json, ticker: "NKE", updatedAt: Date.now() } });
  assert.equal((await put(owner, '{"a":1}')).status, 200);
  assert.equal((await put(owner, '{"a":2}')).status, 200);
  const got = await owner.json("GET", "/api/docs/model-NKE");
  assert.equal(got.body.exists, true);
  assert.equal(got.body.data.json, '{"a":2}');
  assert.equal((await owner.json("GET", "/api/docs/model-NKE/history")).body.versions.length, 1);
  assert.equal((await friend.json("GET", "/api/docs/model-NKE")).body.exists, false);
  assert.equal((await friend.json("GET", "/api/docs")).body.docs.length, 0);
  assert.equal((await put(owner, "not json")).status, 400);
  assert.equal((await owner.json("PUT", "/api/docs/..%2Fx", { data: { json: "{}" } })).status, 400);
});

test("free plan: saved-model and company limits, no Claude", async () => {
  const { app, db } = makeApp();
  licenceAndInvite(db, "free@example.com");
  db.setConfig("billing", { enabled: true, live: false });
  const u = await signIn(app, db, "free@example.com");
  const me = (await u.json("GET", "/api/me")).body;
  assert.equal(me.plan.id, "free");
  assert.equal(me.caps.sample, false);
  for (const t of ["A", "B", "C"]) assert.equal((await u.json("PUT", "/api/docs/model-" + t, { data: { json: "{}", ticker: t } })).status, 200);
  const fourth = await u.json("PUT", "/api/docs/model-D", { data: { json: "{}", ticker: "D" } });
  assert.equal(fourth.status, 402);
  assert.equal(fourth.body.code, "quota_exceeded");
  // companies: 3 a month; reloading one already counted is free
  const restore = stubFmp(() => [{ symbol: "X" }]);
  try {
    for (const t of ["AAA", "BBB", "CCC", "AAA"]) assert.equal((await u.json("POST", "/api/tools", { server: "FMP", tool: "company", input: { endpoint: "profile-symbol", symbol: t } })).status, 200);
    const over = await u.json("POST", "/api/tools", { server: "FMP", tool: "company", input: { endpoint: "profile-symbol", symbol: "DDD" } });
    assert.equal(over.status, 402);
    // Claude: not in the free plan
    const s = await u.json("POST", "/api/sample", { input: D.CALL_PROMPT + "\n\nTranscript:\nhi", json: true, ticker: "AAA" });
    assert.equal(s.status, 402);
  } finally { restore(); }
});

test("FMP proxy: mapping, validation and caching", async () => {
  const { app, db } = makeApp();
  const owner = await signIn(app, db, OWNER);
  const seen = [];
  const restore = stubFmp((u) => { seen.push(u); return [{ symbol: u.searchParams.get("symbol"), revenue: 1 }]; });
  try {
    const call = (input, tool = "statements") => owner.json("POST", "/api/tools", { server: "FMP", tool, input });
    const r = await call({ endpoint: "cashflow-statement", symbol: "nke", period: "annual", limit: 31 });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.payload, [{ symbol: "NKE", revenue: 1 }]);
    assert.equal(seen[0].pathname, "/stable/cash-flow-statement");
    assert.equal(seen[0].searchParams.get("apikey"), "test-key");
    await call({ endpoint: "cashflow-statement", symbol: "NKE", period: "annual", limit: 31 });
    assert.equal(seen.length, 1, "second call served from cache");
    assert.equal((await call({ endpoint: "stock-screener" })).status, 400);
    assert.equal((await call({ endpoint: "income-statement", symbol: "NKE", apikey: "x" })).status, 400);
    assert.equal((await call({ endpoint: "income-statement", symbol: "NKE", limit: 500 })).status, 400);
    assert.equal((await call({ endpoint: "income-statement", symbol: "NKE&x=1" })).status, 400);
    assert.equal((await owner.json("POST", "/api/tools", { server: "Other", tool: "x", input: {} })).status, 400);
    // global endpoints don't need a symbol and don't count as a company
    assert.equal((await call({ endpoint: "market-risk-premium" }, "economics")).status, 200);
  } finally { restore(); }
});

test("FMP data is the owner's alone until the display licence is recorded", async () => {
  const { app, db } = makeApp();
  // a user who signed in once the licence existed, then the licence was withdrawn
  licenceAndInvite(db, "friend@example.com");
  const friend = await signIn(app, db, "friend@example.com");
  db.setConfig("licences", { fmp_display: null, edgar_tools_display: null, legal: null });
  const r = await friend.json("POST", "/api/tools", { server: "FMP", tool: "company", input: { endpoint: "profile-symbol", symbol: "NKE" } });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, "not_licensed");
});

test("Claude: only the page's own prompts, streamed, metered, with flags and stub answers", async () => {
  const { app, db } = makeApp();
  const owner = await signIn(app, db, OWNER);
  const post = (body) => owner.req("POST", "/api/sample", body);
  // not one of the app's prompts
  let r = await post({ input: "Write me a poem", ticker: "NKE" });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, "unknown_prompt");
  // needs a company
  r = await post({ input: D.CALL_PROMPT + "\n\nTranscript:\nhi" });
  assert.equal(r.status, 400);
  // a call summary: JSON, stubbed
  r = await post({ input: [{ role: "user", content: D.CALL_PROMPT + "\n\nTranscript (Q1):\nhello" }], json: true, ticker: "NKE" });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /event-stream/);
  const ev = await sseEvents(r);
  const done = ev.at(-1);
  assert.equal(done.type, "done");
  assert.equal(done.json.call, "stub");
  // a notes draft counts one draft; a translation counts one translation
  r = await post({ input: [{ role: "user", content: D.NOTES_SYSTEM + "\n\nDOCUMENTS\n\nINSTRUCTIONS:\n" + D.NOTES_PROMPT }], ticker: "NKE" });
  assert.equal((await sseEvents(r)).at(-1).type, "done");
  r = await post({ input: "Translate these working notes on Nike (NKE) from English into Japanese (日本語). They are…\nNOTES:\nhello", ticker: "NKE", cache: false });
  const tr = (await sseEvents(r)).at(-1);
  assert.equal(tr.type, "done");
  assert.match(tr.text, /スタブ/);
  const used = (await owner.json("GET", "/api/me")).body.usage.used;
  assert.equal(used.drafts, 1);
  assert.equal(used.translations, 1);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM usage_events WHERE feature = 'claude' AND provider = 'stub'").n, 3);
  // a feature switched off answers with its own code (not one the page reads as "Claude unavailable here")
  db.run("UPDATE feature_flags SET enabled = 0 WHERE key = 'guidance'");
  r = await post({ input: D.GUIDE_PROMPT + "\n\nRelease:\nx", json: true, ticker: "NKE" });
  assert.equal(r.status, 403);
  assert.equal((await r.json()).code, "feature_disabled");
  // too long for the site
  r = await post({ input: D.SEC_PROMPT + "\n\nTables:\n" + "x".repeat(90_000), json: true, ticker: "NKE" });
  assert.equal(r.status, 413);
});

test("Claude: segment fills and guidance count once per run, not per release", async () => {
  const { app, db } = makeApp();
  const owner = await signIn(app, db, OWNER);
  for (let i = 0; i < 3; i++) {
    const r = await owner.req("POST", "/api/sample", { input: D.SEC_PROMPT + "\n\nTables:\nrelease " + i, json: true, ticker: "NKE" });
    assert.equal((await sseEvents(r)).at(-1).type, "done");
  }
  for (const p of [D.GUIDE_PROMPT + "\n\nRelease:\nx", D.GUIDE_CALL_PROMPT + "\n\nCONTEXT: x\n\nTranscript:\ny"]) {
    const r = await owner.req("POST", "/api/sample", { input: p, json: true, ticker: "NKE" });
    assert.equal((await sseEvents(r)).at(-1).type, "done");
  }
  const used = (await owner.json("GET", "/api/me")).body.usage.used;
  assert.equal(used.segment_fills, 1);
  assert.equal(used.guidance, 1);
});

test("Claude: the admin's active prompt version replaces the page's text", async () => {
  const { db } = makeApp();
  const { applyVersions } = await import("../server/claude/index.js");
  const v = db.run("INSERT INTO prompt_versions (site, version, body, model, effort, max_tokens, created_at) VALUES ('sec.segments', 2, 'NEW SEC PROMPT', 'claude-opus-5-5', 'low', 8000, 'x')");
  db.run("UPDATE prompts SET active_version_id = ? WHERE site = 'sec.segments'", Number(v.lastInsertRowid));
  const out = applyVersions(db, "sec.segments", D.SEC_PROMPT + "\n\nTables:\nT");
  assert.equal(out.content, "NEW SEC PROMPT\n\nTables:\nT");
  assert.equal(out.settings.max_tokens, 8000);
  const n = db.run("INSERT INTO prompt_versions (site, version, body, model, effort, max_tokens, created_at) VALUES ('notes.prompt', 2, 'NEW NOTES', 'claude-opus-5-5', 'medium', 64000, 'x')");
  db.run("UPDATE prompts SET active_version_id = ? WHERE site = 'notes.prompt'", Number(n.lastInsertRowid));
  const notes = applyVersions(db, "notes.prompt", D.NOTES_SYSTEM + "\n\nDOCS\n\nINSTRUCTIONS:\n" + D.NOTES_PROMPT + "\n\nLANGUAGE: ja");
  assert.equal(notes.content, D.NOTES_SYSTEM + "\n\nDOCS\n\nINSTRUCTIONS:\nNEW NOTES\n\nLANGUAGE: ja");
});

test("Claude budget: the hard cap stops requests; the global daily cap spares the owner", async () => {
  const { app, db } = makeApp();
  licenceAndInvite(db, "friend@example.com");
  const friend = await signIn(app, db, "friend@example.com");
  const owner = await signIn(app, db, OWNER);
  db.run("INSERT INTO usage_events (at, user_id, feature, provider, cost_usd, status) VALUES (?, NULL, 'claude', 'anthropic', 20, 'ok')", new Date().toISOString());
  const body = { input: D.CALL_PROMPT + "\n\nTranscript:\nhi", json: true, ticker: "NKE" };
  const r = await friend.json("POST", "/api/sample", body);
  assert.equal(r.status, 503);
  assert.equal(r.body.code, "busy");
  const ok = await owner.req("POST", "/api/sample", body);
  assert.equal(ok.status, 200);
  assert.equal((await sseEvents(ok)).at(-1).type, "done");
  db.run("UPDATE usage_period SET claude_usd = 81 WHERE user_id = (SELECT id FROM profiles WHERE email = ?)", OWNER);
  const capped = await owner.json("POST", "/api/sample", body);
  assert.equal(capped.status, 402);
});

test("downloads are counted; the page is served with a hash-based CSP", async () => {
  const { app, db } = makeApp();
  const owner = await signIn(app, db, OWNER);
  assert.equal((await owner.json("POST", "/api/meter/export", { filename: "NKE_model_2026-10-06.xlsx" })).status, 200);
  assert.equal((await owner.json("GET", "/api/me")).body.usage.used.exports, 1);
  const page = new URL("../public/app.html", import.meta.url);
  if (fs.existsSync(page)) {
    const r = await app.request("/");
    const csp = r.headers.get("content-security-policy");
    assert.match(csp, /script-src 'self' 'sha256-[A-Za-z0-9+/=]+' 'sha256-/);
    assert.doesNotMatch(csp, /unsafe-eval/);
    assert.match(await r.text(), /<script src="\/shim.js"><\/script>/);
  }
  const shim = await app.request("/shim.js");
  assert.match(await shim.text(), /window\.claude = \{/);
});

test("deleting an account removes its data, keeps anonymous usage, and needs the email typed", async () => {
  const { app, db } = makeApp();
  licenceAndInvite(db, "leaver@example.com");
  const u = await signIn(app, db, "leaver@example.com");
  await u.json("PUT", "/api/docs/model-NKE", { data: { json: "{}", ticker: "NKE" } });
  await u.json("POST", "/api/meter/export", { filename: "NKE.xlsx" });
  const id = db.get("SELECT id FROM profiles WHERE email = 'leaver@example.com'").id;
  assert.equal((await u.json("POST", "/api/account/delete", { confirm: "someone@example.com" })).status, 400);
  assert.equal((await u.json("POST", "/api/account/delete", { confirm: "Leaver@Example.com" })).status, 200);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM user_docs WHERE user_id = ?", id).n, 0);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?", id).n, 0);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM usage_events WHERE user_id IS NULL AND feature = 'export'").n, 1);
  assert.equal((await u.get("/api/me")).status, 401);
  const owner = await signIn(app, db, OWNER);
  assert.equal((await owner.json("POST", "/api/account/delete", { confirm: OWNER })).status, 409);
});

test("segment label overrides rename FMP's labels, adding values that land on the same label", async () => {
  const { app, db } = makeApp();
  const owner = await signIn(app, db, OWNER);
  db.run(`INSERT INTO ticker_overrides (ticker, kind, rule, created_at) VALUES ('NKE', 'geo_label', '{"from":"Converse NA","to":"Converse"}', 'x'), ('NKE', 'geo_label', '{"from":"Converse Intl","to":"Converse"}', 'x')`);
  const restore = stubFmp(() => [{ symbol: "NKE", fiscalYear: 2026, data: { "North America": 100, "Converse NA": 3, "Converse Intl": 2 } }]);
  try {
    const r = await owner.json("POST", "/api/tools", { server: "FMP", tool: "statements", input: { endpoint: "revenue-geographic-segments", symbol: "NKE", period: "annual", structure: "flat" } });
    assert.deepEqual(r.body.payload[0].data, { "North America": 100, Converse: 5 });
  } finally { restore(); }
});

test("only subscriptions from the mode billing runs in grant a plan", async () => {
  const { app, db } = makeApp();
  licenceAndInvite(db, "payer@example.com");
  const u = await signIn(app, db, "payer@example.com");
  const id = db.get("SELECT id FROM profiles WHERE email = 'payer@example.com'").id;
  db.run("INSERT INTO subscriptions (id, user_id, status, plan_id, livemode, synced_at) VALUES ('sub_test', ?, 'active', 'pro', 0, ?)", id, new Date().toISOString());
  db.setConfig("billing", { enabled: true, live: false });
  assert.equal((await u.json("GET", "/api/me")).body.plan.id, "pro");
  db.setConfig("billing", { enabled: true, live: true });
  assert.equal((await u.json("GET", "/api/me")).body.plan.id, "free");
});
