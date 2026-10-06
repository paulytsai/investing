// Data quality: the FMP vs SEC cross-check, the segment-sum check, idempotent flags, the nightly run and the admin routes.
// FMP and SEC are served from synthetic payloads through a stubbed fetch; nothing here touches the network.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.CLAUDE_STUB = "true";
process.env.OWNER_EMAIL = "owner@example.com";
process.env.REQUIRE_ADMIN_MFA = "false";
process.env.FMP_FIXTURES = ""; // fetch is stubbed instead
process.env.FMP_API_KEY = "test-key";
process.env.SEC_USER_AGENT = "";
process.env.RESEND_API_KEY = "";

const { openDb } = await import("../server/db.js");
const { createApp } = await import("../server/app.js");
const { resetRateLimits } = await import("../server/http.js");
const { callFmp } = await import("../server/tools/fmp.js");
const { runDqCheck, runNightlyDq } = await import("../server/dq/index.js");
const { DEFAULT_SEC_UA } = await import("../server/dq/sec_facts.js");

// ---------- synthetic company: TST, CIK 1234567, calendar fiscal years, a 2:1 split in mid-2024 ----------
const CIK = 1234567;
const r2 = (x) => Math.round(x * 100) / 100;
function truth(y) {
  const rev = Math.round(1000e6 * 1.1 ** (y - 2019));
  const cogs = Math.round(rev * 0.4), liab = Math.round(rev * 1.2), ni = Math.round(rev * 0.15);
  return { rev, cogs, gp: rev - cogs, op: Math.round(rev * 0.2), ni, assets: 2 * rev, liab, eq: 2 * rev - liab,
    cash: Math.round(rev * 0.3), cfo: Math.round(rev * 0.18), capex: Math.round(rev * 0.05), shares: 200e6, eps: r2(ni / 200e6) };
}

// companyfacts: one 10-K per fiscal year F (filed F+1-02-15) with durations for F, F-1, F-2 and instants for F, F-1.
// Filings before the split report half the shares and twice the EPS.
function secFacts() {
  const facts = { "us-gaap": {}, dei: {} };
  const add = (ns, tag, unit, f) => (((facts[ns][tag] ||= { label: tag, units: {} }).units[unit] ||= []).push(f));
  for (let F = 2019; F <= 2025; F++) {
    const filed = `${F + 1}-02-15`, accn = `0001234567-${String(F + 1).slice(2)}-000010`, pre = filed < "2024-06-01";
    const base = { accn, fy: F, fp: "FY", form: "10-K", filed };
    for (let y = F - 2; y <= F; y++) {
      const t = truth(y), d = { ...base, start: `${y}-01-01`, end: `${y}-12-31` };
      add("us-gaap", "Revenues", "USD", { ...d, val: t.rev });
      add("us-gaap", "CostOfRevenue", "USD", { ...d, val: t.cogs });
      add("us-gaap", "GrossProfit", "USD", { ...d, val: t.gp });
      add("us-gaap", "OperatingIncomeLoss", "USD", { ...d, val: t.op });
      add("us-gaap", "NetIncomeLoss", "USD", { ...d, val: t.ni });
      add("us-gaap", "EarningsPerShareDiluted", "USD/shares", { ...d, val: pre ? r2(t.ni / 100e6) : t.eps });
      add("us-gaap", "WeightedAverageNumberOfDilutedSharesOutstanding", "shares", { ...d, val: pre ? 100e6 : 200e6 });
      add("us-gaap", "NetCashProvidedByUsedInOperatingActivities", "USD", { ...d, val: t.cfo });
      add("us-gaap", "PaymentsToAcquirePropertyPlantAndEquipment", "USD", { ...d, val: t.capex });
    }
    for (let y = F - 1; y <= F; y++) {
      const t = truth(y), i = { ...base, end: `${y}-12-31` };
      add("us-gaap", "Assets", "USD", { ...i, val: t.assets });
      add("us-gaap", "Liabilities", "USD", { ...i, val: t.liab });
      add("us-gaap", "StockholdersEquity", "USD", { ...i, val: t.eq });
      add("us-gaap", "CashAndCashEquivalentsAtCarryingValue", "USD", { ...i, val: t.cash });
    }
    add("dei", "EntityCommonStockSharesOutstanding", "shares", { ...base, end: `${F + 1}-01-31`, val: pre ? 100e6 : 200e6 });
  }
  // noise the check must ignore: a quarterly 10-Q fact and an 8-K fact for a fiscal-year period
  add("us-gaap", "Revenues", "USD", { start: "2025-01-01", end: "2025-03-31", val: 1, accn: "q", fy: 2025, fp: "Q1", form: "10-Q", filed: "2025-05-01" });
  add("us-gaap", "NetIncomeLoss", "USD", { start: "2024-01-01", end: "2024-12-31", val: 1, accn: "k", fy: 2024, fp: "FY", form: "8-K", filed: "2026-09-01" });
  return { cik: CIK, entityName: "Test Corp", facts };
}

// FMP: six fiscal years, newest first, split-adjusted. Deliberate errors: FY2024 net income 5% high (in the window),
// FY2020 revenue 10% high (outside the 5-year window), FY2023 revenue 0.4M high (under the absolute floor).
let fmp;
function makeFmp() {
  const years = [2025, 2024, 2023, 2022, 2021, 2020];
  const inc = years.map((y) => {
    const t = truth(y);
    return { date: `${y}-12-31`, symbol: "TST", reportedCurrency: "USD", cik: "0001234567", filingDate: `${y + 1}-02-15`, fiscalYear: String(y), period: "FY",
      revenue: t.rev, costOfRevenue: t.cogs, grossProfit: t.gp, operatingIncome: t.op, netIncome: t.ni, epsDiluted: t.eps, weightedAverageShsOutDil: t.shares };
  });
  inc.find((r) => r.fiscalYear === "2024").netIncome = Math.round(truth(2024).ni * 1.05);
  inc.find((r) => r.fiscalYear === "2020").revenue = Math.round(truth(2020).rev * 1.1);
  inc.find((r) => r.fiscalYear === "2023").revenue += 400000;
  const bal = years.map((y) => { const t = truth(y); return { date: `${y}-12-31`, symbol: "TST", totalAssets: t.assets, totalLiabilities: t.liab, totalStockholdersEquity: t.eq, cashAndCashEquivalents: t.cash }; });
  const cf = years.map((y) => { const t = truth(y); return { date: `${y}-12-31`, symbol: "TST", operatingCashFlow: t.cfo, capitalExpenditure: -t.capex }; });
  const product = years.map((y) => { const t = truth(y); return { symbol: "TST", fiscalYear: y, period: "FY", date: `${y}-12-31`, data: { Widgets: Math.round(t.rev * 0.6), Gadgets: Math.round(t.rev * (y === 2023 ? 0.3 : 0.4)) } }; });
  const geo = years.map((y) => { const t = truth(y); return { symbol: "TST", fiscalYear: y, period: "FY", date: `${y}-12-31`, data: { "United States": Math.round(t.rev * 0.7), "Other Americas": Math.round(t.rev * 0.3) } }; });
  const tst = { "income-statement": inc, "balance-sheet-statement": bal, "cash-flow-statement": cf, "revenue-product-segmentation": product, "revenue-geographic-segmentation": geo };
  // NOCIK: the same statements under a symbol SEC doesn't know and without FMP's cik field
  const strip = (rows) => rows.map(({ cik, ...r }) => ({ ...r, symbol: "NOCIK" }));
  const nocik = Object.fromEntries(Object.entries(tst).map(([k, v]) => [k, strip(v)]));
  return { TST: tst, NOCIK: nocik };
}

// ---------- fetch stub ----------
const realFetch = globalThis.fetch;
let calls;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  calls.push({ host: u.hostname, path: u.pathname, symbol: u.searchParams.get("symbol"), ua: headers["user-agent"], at: Date.now() });
  if (u.hostname === "financialmodelingprep.com") {
    const sym = u.searchParams.get("symbol");
    if (sym === "ERR") return new Response("busy", { status: 500 });
    return json(fmp[sym]?.[u.pathname.split("/").pop()] ?? []);
  }
  if (u.hostname === "www.sec.gov" && u.pathname === "/files/company_tickers.json") {
    return json({ 0: { cik_str: CIK, ticker: "TST", title: "Test Corp" }, 1: { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." } });
  }
  if (u.hostname === "data.sec.gov") {
    const m = /\/CIK(\d{10})\.json$/.exec(u.pathname);
    return m && Number(m[1]) === CIK ? json(secFacts()) : new Response("not found", { status: 404 });
  }
  throw new Error("unexpected fetch " + url);
};
process.on("exit", () => { globalThis.fetch = realFetch; });

beforeEach(() => { fmp = makeFmp(); calls = []; resetRateLimits(); });
const secCalls = () => calls.filter((c) => c.host.endsWith("sec.gov"));
const flagsOf = (db, t = "TST") => db.all("SELECT * FROM dq_flags WHERE ticker = ? ORDER BY id", t);
const clearFmpCache = (db) => db.run("DELETE FROM fmp_cache");

// ---------- the check ----------
test("check: one SEC mismatch and one segment-sum flag, with the filing that backs the SEC value", async () => {
  const db = openDb(":memory:");
  const s = await runDqCheck(db, "tst");
  assert.equal(s.ticker, "TST");
  assert.equal(s.cik, CIK);
  assert.deepEqual(s.years, ["FY2025", "FY2024", "FY2023", "FY2022", "FY2021"]);
  assert.deepEqual(s.skipped, []);
  assert.equal(s.checked, 5 * 12 + 5 * 2);
  assert.equal(s.flagged, 2);
  assert.equal(s.created, 2);
  const flags = flagsOf(db);
  assert.equal(flags.length, 2);
  const ni = flags.find((f) => f.kind === "sec_mismatch");
  assert.equal(ni.field, "net_income");
  assert.equal(ni.period, "FY2024");
  assert.equal(ni.status, "open");
  assert.equal(ni.fmp_value, String(Math.round(truth(2024).ni * 1.05)));
  assert.equal(ni.sec_value, String(truth(2024).ni));
  const d = JSON.parse(ni.detail);
  assert.equal(d.tag, "NetIncomeLoss");
  assert.equal(d.form, "10-K");
  assert.equal(d.accession, "0001234567-26-000010"); // the latest 10-K that reports FY2024 (the 8-K is ignored)
  assert.equal(d.filed, "2026-02-15");
  assert.equal(d.diff_pct, 5);
  const seg = flags.find((f) => f.kind === "segment_sum");
  assert.equal(seg.field, "product_segments");
  assert.equal(seg.period, "FY2023");
  assert.equal(JSON.parse(seg.detail).total_source, "sec");
  assert.equal(Math.round(JSON.parse(seg.detail).diff_pct), -10);
  // split-adjusted EPS and shares match for years whose latest filing predates the split (FY2021, FY2022)
  assert.ok(!flags.some((f) => /eps|shares/.test(f.field)));
  // SEC: the ticker map and the company facts, spaced by the limiter shared with the filings module (8 a second)
  const sc = secCalls();
  assert.equal(sc.length, 2);
  assert.ok(sc[1].at - sc[0].at >= 115, "SEC requests are spaced out");
  for (const c of sc) { assert.equal(c.ua, DEFAULT_SEC_UA); assert.ok(!c.ua.includes("@")); }
  // FMP: three statements (limit 10) and both segment endpoints
  assert.equal(calls.filter((c) => c.host === "financialmodelingprep.com").length, 5);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM usage_events").n, 0, "the check's own FMP calls don't count as loads");
});

test("check: re-running is idempotent; a wontfix flag stays closed until the values change", async () => {
  const db = openDb(":memory:");
  await runDqCheck(db, "TST");
  const again = await runDqCheck(db, "TST");
  assert.equal(again.flagged, 2);
  assert.equal(again.created, 0);
  assert.equal(flagsOf(db).length, 2);
  assert.equal(secCalls().length, 2, "SEC data comes from sec_cache on the second run");
  assert.ok(db.get("SELECT COUNT(*) AS n FROM sec_cache WHERE key LIKE 'dq:%'").n >= 2);

  const ni = flagsOf(db).find((f) => f.field === "net_income");
  db.run("UPDATE dq_flags SET status = 'wontfix', note = 'known' WHERE id = ?", ni.id);
  const third = await runDqCheck(db, "TST");
  assert.equal(third.created, 0);
  assert.equal(db.get("SELECT status FROM dq_flags WHERE id = ?", ni.id).status, "wontfix");
  assert.equal(flagsOf(db).length, 2);

  // FMP changes the (still wrong) value: a new open flag; the wontfix one is left as it was
  fmp.TST["income-statement"].find((r) => r.fiscalYear === "2024").netIncome = Math.round(truth(2024).ni * 1.08);
  clearFmpCache(db);
  const fourth = await runDqCheck(db, "TST");
  assert.equal(fourth.created, 1);
  const nis = flagsOf(db).filter((f) => f.field === "net_income");
  assert.deepEqual(nis.map((f) => f.status), ["wontfix", "open"]);
  assert.equal(nis[1].fmp_value, String(Math.round(truth(2024).ni * 1.08)));
});

test("check: open flags close themselves when the data agrees again", async () => {
  const db = openDb(":memory:");
  await runDqCheck(db, "TST");
  fmp = makeFmp();
  fmp.TST["revenue-product-segmentation"].find((r) => r.fiscalYear === 2023).data.Gadgets = Math.round(truth(2023).rev * 0.4);
  fmp.TST["income-statement"].find((r) => r.fiscalYear === "2024").netIncome = truth(2024).ni;
  clearFmpCache(db);
  const s = await runDqCheck(db, "TST");
  assert.equal(s.flagged, 0);
  assert.equal(s.resolved, 2);
  for (const f of flagsOf(db)) {
    assert.equal(f.status, "fixed");
    assert.match(f.note, /Auto-closed/);
  }
});

test("check: no CIK, unknown ticker and a non-USD filer are skipped gracefully; segments still checked", async () => {
  const db = openDb(":memory:");
  const s = await runDqCheck(db, "NOCIK");
  assert.equal(s.cik, null);
  assert.ok(s.skipped.some((x) => /No SEC CIK/.test(x)), s.skipped.join("; "));
  assert.equal(s.checked, 10); // the segment sums, against FMP's own revenue
  assert.equal(s.flagged, 1);
  assert.equal(JSON.parse(flagsOf(db, "NOCIK")[0].detail).total_source, "fmp");

  const none = await runDqCheck(db, "ZZZZ");
  assert.equal(none.checked, 0);
  assert.ok(none.skipped.some((x) => /no annual income statements/.test(x)));

  fmp.EUR = JSON.parse(JSON.stringify(fmp.TST));
  for (const r of fmp.EUR["income-statement"]) { r.reportedCurrency = "EUR"; r.symbol = "EUR"; }
  const eur = await runDqCheck(db, "EUR");
  assert.ok(eur.skipped.some((x) => /in EUR/.test(x)));
  assert.equal(eur.checked, 10);

  await assert.rejects(runDqCheck(db, "not a ticker!"), (e) => e.status === 400);
});

test("nightly: tickers loaded in the last 7 days, errors logged and the run continues", async () => {
  const db = openDb(":memory:");
  const at = (daysAgo) => new Date(Date.now() - daysAgo * 864e5).toISOString();
  const ev = (when, feature, ticker) => db.run("INSERT INTO usage_events (at, feature, provider, ticker) VALUES (?, ?, 'fmp', ?)", when, feature, ticker);
  ev(at(1), "fmp", "TST"); ev(at(2), "fmp", "TST"); ev(at(0.5), "fmp", "ERR");
  ev(at(10), "fmp", "OLD"); ev(at(1), "claude", "XYZ"); ev(at(1), "fmp", null);
  const out = await runNightlyDq(db);
  assert.equal(out.tickers, 1);
  assert.equal(out.errors, 1);
  assert.equal(out.created, 2);
  const symbols = new Set(calls.filter((c) => c.symbol).map((c) => c.symbol));
  assert.deepEqual([...symbols].sort(), ["ERR", "TST"]);
  const err = db.get("SELECT * FROM error_log WHERE source = 'dq'");
  assert.equal(err.ticker, "ERR");
  assert.equal(db.getConfig("dq_last_nightly").tickers, 1);
});

// ---------- routes ----------
async function signIn(app, db, email) {
  let cookie = "";
  const req = async (method, path, body) => {
    const headers = { cookie };
    if (method !== "GET") headers["content-type"] = "application/json";
    const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const m = /cm_sid=([^;]*)/.exec(res.headers.get("set-cookie") || "");
    if (m) cookie = "cm_sid=" + m[1];
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  await req("POST", "/auth/start", { email });
  const subject = db.get("SELECT subject FROM dev_mail WHERE to_email = ? ORDER BY id DESC LIMIT 1", email)?.subject;
  const code = /(\d{6})/.exec(subject || "")?.[1];
  assert.ok(code, "a sign-in code was sent");
  assert.equal((await req("POST", "/auth/verify", { email, code })).status, 200);
  return req;
}

test("routes: owner triages flags, runs a check, manages overrides; every change is audited", async () => {
  const db = openDb(":memory:");
  const app = createApp(db);
  const anon = await app.request("/api/admin/dq/flags");
  assert.equal(anon.status, 401);
  const req = await signIn(app, db, "owner@example.com");
  const B = "/api/admin/dq";

  const run = await req("POST", B + "/run", { ticker: "tst" });
  assert.equal(run.status, 200);
  assert.equal(run.body.ticker, "TST");
  assert.equal(run.body.created, 2);
  assert.equal(run.body.comparisons, undefined);
  const detailed = await req("POST", B + "/run", { ticker: "TST", details: true });
  assert.equal(detailed.body.created, 0);
  assert.equal(detailed.body.comparisons.length, 70);
  assert.equal(detailed.body.comparisons.filter((c) => !c.ok).length, 2);
  assert.equal((await req("POST", B + "/run", { ticker: "$$$" })).status, 400);

  let list = await req("GET", B + "/flags");
  assert.equal(list.status, 200);
  assert.equal(list.body.flags.length, 2);
  assert.equal(typeof list.body.flags[0].detail, "object");
  assert.equal((await req("GET", B + "/flags?status=bogus")).status, 400);
  const ni = list.body.flags.find((f) => f.field === "net_income");

  const upd = await req("POST", `${B}/flags/${ni.id}`, { status: "wontfix", note: "FMP restates later" });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.flag.status, "wontfix");
  assert.equal(upd.body.flag.note, "FMP restates later");
  assert.equal(upd.body.flag.updated_by, db.get("SELECT id FROM profiles WHERE email = 'owner@example.com'").id);
  assert.equal((await req("POST", `${B}/flags/${ni.id}`, { status: "closed" })).status, 400);
  assert.equal((await req("POST", `${B}/flags/99999`, { status: "fixed" })).status, 404);
  const audit = db.get("SELECT * FROM audit_log WHERE action = 'dq.flag_update'");
  assert.equal(audit.target, `dq_flags:${ni.id}`);
  assert.equal(JSON.parse(audit.before).status, "open");
  assert.equal(JSON.parse(audit.after).status, "wontfix");

  list = await req("GET", B + "/flags?status=open");
  assert.equal(list.body.flags.length, 1);
  list = await req("GET", B + "/flags?status=all&ticker=tst&limit=1");
  assert.equal(list.body.flags.length, 1);
  assert.ok(list.body.next);
  list = await req("GET", B + "/flags?status=open,wontfix&kind=sec_mismatch");
  assert.equal(list.body.flags.length, 1);

  // overrides
  const add = await req("POST", B + "/overrides", { ticker: "tst", kind: "geo_label", from: "Other Americas", to: "Latin America" });
  assert.equal(add.status, 200);
  assert.equal(add.body.override.active, true);
  assert.deepEqual(add.body.override.rule, { from: "Other Americas", to: "Latin America" });
  const seg = await callFmp(db, "statements", { endpoint: "revenue-geographic-segments", symbol: "TST", period: "annual", structure: "flat" });
  assert.ok("Latin America" in seg.payload[0].data, "callFmp applies the active override on read");
  assert.equal((await req("POST", B + "/overrides", { ticker: "TST", kind: "segment", from: "a", to: "b" })).status, 400);
  assert.equal((await req("POST", B + "/overrides", { ticker: "TST", kind: "geo_label", from: "x", to: "x" })).status, 400);
  const replace = await req("POST", B + "/overrides", { ticker: "TST", kind: "geo_label", from: "Other Americas", to: "Americas ex-US" });
  assert.equal(db.get("SELECT active FROM ticker_overrides WHERE id = ?", add.body.override.id).active, 0, "a new rule for the same label replaces the old");
  const ov = await req("GET", B + "/overrides?ticker=TST");
  assert.equal(ov.body.overrides.length, 2);
  assert.equal(ov.body.overrides.filter((o) => o.active).length, 1);
  const del = await req("DELETE", `${B}/overrides/${replace.body.override.id}`);
  assert.equal(del.status, 200);
  assert.equal(del.body.override.active, false);
  assert.equal((await req("DELETE", `${B}/overrides/99999`)).status, 404);
  const actions = db.all("SELECT action FROM audit_log WHERE action LIKE 'dq.%' ORDER BY id").map((a) => a.action);
  assert.deepEqual(actions, ["dq.run", "dq.run", "dq.flag_update", "dq.override_add", "dq.override_add", "dq.override_remove"]);

  const sum = await req("GET", B + "/summary");
  assert.equal(sum.status, 200);
  assert.equal(sum.body.by_status.open, 1);
  assert.equal(sum.body.by_status.wontfix, 1);
  assert.equal(sum.body.by_kind.sec_mismatch.wontfix, 1);
  assert.equal(sum.body.by_kind.segment_sum.open, 1);
  assert.deepEqual(sum.body.open_by_ticker, [{ ticker: "TST", n: 1 }]);
  assert.equal(sum.body.overrides_active, 0);
  assert.equal(sum.body.last_check.ticker, "TST");

  // the run route is rate limited per admin
  let limited = null;
  for (let i = 0; i < 6 && !limited; i++) { const r = await req("POST", B + "/run", { ticker: "TST" }); if (r.status === 429) limited = r; }
  assert.ok(limited, "too many manual runs are refused");
});

test("routes: a signed-in non-admin can't reach the queue", async () => {
  const db = openDb(":memory:");
  const app = createApp(db);
  db.setConfig("licences", { fmp_display: { signed_at: "2026-10-01" }, edgar_tools_display: null, legal: { signed_at: "2026-10-01" } });
  db.run("INSERT INTO allowlist (email, role, invited_at) VALUES ('user@example.com', 'user', ?)", new Date().toISOString());
  const req = await signIn(app, db, "user@example.com");
  assert.equal((await req("GET", "/api/admin/dq/flags")).status, 403);
  assert.equal((await req("POST", "/api/admin/dq/overrides", { ticker: "TST", kind: "geo_label", from: "a", to: "b" })).status, 403);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM ticker_overrides").n, 0);
});
