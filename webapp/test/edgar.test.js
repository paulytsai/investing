// Edgar Tools module: input validation, the MCP client (SSE and JSON replies, sessions, errors), the SEC-direct
// fallback (submissions -> material_events, filing index + exhibit -> filing_section) and the sec_cache layer.
// fetch is stubbed throughout; the fixtures below are trimmed copies of real NKE responses (October 2026).
// Run: node --disable-warning=ExperimentalWarning --test test/edgar.test.js
process.env.CLAUDE_STUB = "true";
const { test, beforeEach, afterEach } = await import("node:test");
const assert = (await import("node:assert/strict")).default;
const { openDb } = await import("../server/db.js");
const { config } = await import("../server/config.js");
const { callEdgar, resolveEdgar, resetEdgarSession, edgarInternals, EDGAR_TOOLS } = await import("../server/tools/edgar.js");
const { secInternals, secThrottle, parseHtmlDoc, extractItem, classifyTable, selectTables, DEFAULT_SEC_UA, pruneSecCache } = await import("../server/tools/sec.js");

// ---------- fixtures ----------
const NKE_EVENTS = {
  company: { cik: 320187, name: "NIKE, Inc.", ticker: "NKE" },
  results: [
    { filing_date: "2026-10-01", accession_number: "0000320187-26-000184", form: "8-K", items: ["2.02", "2.05", "9.01"], item_names: ["Results of Operations and Financial Condition", "Costs Associated with Exit or Disposal Activities", "Financial Statements and Exhibits"], sec_url: "https://www.sec.gov/Archives/edgar/data/320187/000032018726000184/0000320187-26-000184-index.htm", description: "8-K", price_reaction: { pct_1d: 0.15, pct_5d: null, session: "after_close", as_of: "2026-10-02" } },
    { filing_date: "2026-06-30", accession_number: "0000320187-26-000076", form: "8-K", items: ["2.02", "9.01"], item_names: ["Results of Operations and Financial Condition", "Financial Statements and Exhibits"], sec_url: "https://www.sec.gov/Archives/edgar/data/320187/000032018726000076/0000320187-26-000076-index.htm", description: "8-K" },
  ],
  total: 2, showing: 2, tier: "professional",
};
const TICKERS = { 0: { cik_str: 320187, ticker: "NKE", title: "NIKE, Inc." }, 1: { cik_str: 1067983, ticker: "BRK-B", title: "BERKSHIRE HATHAWAY INC" } };
const col = (rows, i) => rows.map((r) => r[i]);
const SUB_ROWS = [
  // accession, filingDate, acceptance, form, items, primaryDocument
  ["0000320187-26-000184", "2026-10-01", "2026-10-02T00:15:15.000Z", "8-K", "2.02,2.05,9.01", "nke-20261001.htm"],
  ["0000320187-26-000170", "2026-09-16", "2026-09-16T20:00:00.000Z", "8-K", "5.02,7.01,9.01", "nke-20260916.htm"],
  ["0000320187-26-000150", "2026-09-01", "2026-09-01T20:00:00.000Z", "4", "", "form4.xml"],
  ["0000320187-26-000076", "2026-06-30", "2026-07-01T00:15:28.000Z", "8-K", "2.02,9.01", "nke-20260630.htm"],
  ["0000320187-26-000070", "2026-06-23", "2026-06-24T00:24:58.000Z", "8-K", "2.02,5.02,7.01,9.01", "nke-20260616.htm"],
  ["0000320187-26-000026", "2026-03-31", "2026-04-01T00:15:22.000Z", "8-K", "2.02,9.01", "nke-20260331.htm"],
  ["0000320187-25-000140", "2025-12-22", "2025-12-22T20:00:00.000Z", "8-K/A", "2.02,9.01", "nke-20251222.htm"],
  ["0000320187-24-000062", "2024-10-01", "2024-10-02T00:15:00.000Z", "8-K", "2.02,9.01", "nke-20241001.htm"],
];
const SUBMISSIONS = {
  cik: "320187", name: "NIKE, Inc.", tickers: ["NKE"],
  filings: {
    recent: {
      accessionNumber: col(SUB_ROWS, 0), filingDate: col(SUB_ROWS, 1), acceptanceDateTime: col(SUB_ROWS, 2), form: col(SUB_ROWS, 3),
      items: col(SUB_ROWS, 4), primaryDocument: col(SUB_ROWS, 5), primaryDocDescription: col(SUB_ROWS, 3),
    },
    files: [],
  },
};
const ACC = "0000320187-26-000184";
const BASE = "https://www.sec.gov/Archives/edgar/data/320187/000032018726000184/";
const INDEX_HTML = `<html><body><div id="formName">
         <strong>Form 8-K</strong> - Current report: </div>
<div class="formGrouping"><div class="infoHead">Filing Date</div>
         <div class="info">2026-10-01</div></div>
<table class="tableFile" summary="Document Format Files">
<tr><th scope="col">Seq</th><th scope="col">Description</th><th scope="col">Document</th><th scope="col">Type</th><th scope="col">Size</th></tr>
<tr><td scope="row">1</td><td scope="row">8-K</td><td scope="row"><a href="/ix?doc=/Archives/edgar/data/320187/000032018726000184/nke-20261001.htm">nke-20261001.htm</a> &nbsp;&nbsp;<span style="color: green">iXBRL</span></td><td scope="row">8-K</td><td scope="row">30506</td></tr>
<tr class="evenRow"><td scope="row">2</td><td scope="row">EX-99.1</td><td scope="row"><a href="/Archives/edgar/data/320187/000032018726000184/q1fy27exhibit991er.htm">q1fy27exhibit991er.htm</a></td><td scope="row">EX-99.1</td><td scope="row">274099</td></tr>
<tr><td scope="row">6</td><td scope="row"></td><td scope="row"><a href="/Archives/edgar/data/320187/000032018726000184/blackswoosh401era.jpg">blackswoosh401era.jpg</a></td><td scope="row">GRAPHIC</td><td scope="row">7670</td></tr>
</table>
<span class="companyName">NIKE, Inc. (Filer) <acronym title="Central Index Key">CIK</acronym>: <a href="/cgi-bin/browse-edgar?CIK=0000320187&amp;action=getcompany">0000320187 (see all company filings)</a></span>
</body></html>`;
const EXHIBIT_HTML = `<DOCUMENT>
<TYPE>EX-99.1
<SEQUENCE>2
<FILENAME>q1fy27exhibit991er.htm
<DESCRIPTION>EX-99.1
<TEXT>
<html><head>
<!-- Document created using Wdesk -->
<title>Document</title><style>.x{color:red}</style></head><body>
<script>var secret = "do not leak";</script>
<div style="text-align:center"><table style="width:100%"><tr><td style="width:2%">&#8226;</td><td><font style="font-family:'Arial'">Sport Offense continued to   drive momentum</font></td></tr></table></div>
<div style="margin-top:5pt"><font>BEAVERTON, Ore., Oct. 1, 2026 &#8212; NIKE, Inc. today reported fiscal 2027 results.</font></div>
<div><font style="font-weight:700">Outlook</font></div>
<div><font>Revenues are expected to decline&#160;high-single digits in fiscal 2027.</font></div>
<table class="t1" style="border-collapse:collapse"><tr><td colspan="3" style="padding:2pt"><div><font>Guidance</font></div></td></tr>
<tr><td>Revenue</td><td>$11.0&#160;billion</td><td style="text-align:right">$11.5 billion</td></tr></table>
<div><font>(Tables Follow)</font></div>
<div><table style="border-collapse:collapse"><tr><td style="width:1.0%"></td><td style="width:28%"></td></tr>
<tr><td colspan="12" style="padding:2pt"><font>CONSOLIDATED STATEMENTS OF INCOME</font></td></tr>
<tr><td colspan="3" style="padding:2pt">(In millions)</td><td colspan="3" rowspan="2" style="x">8/31/2026</td><td colspan="3">8/31/2025</td></tr>
<tr><td colspan="3">Revenues</td><td>&#x24;</td><td>11,213 </td><td>$</td><td>11,720</td></tr>
<tr><td colspan="3"><div>Net income</div></td><td>712</td><td>727</td></tr>
<tr><td colspan="3">Shareholders&apos; equity &amp; other</td><td>(14)</td><td>&#x2014;</td></tr></table></div>
</body></html>
</TEXT>
</DOCUMENT>`;
const PRIMARY_HTML = `<html><head><title>8-K</title></head><body>
<div style="display:none"><ix:header><ix:hidden><ix:nonNumeric name="dei:Hidden">hidden facts 123</ix:nonNumeric></ix:hidden></ix:header></div>
<p>UNITED STATES SECURITIES AND EXCHANGE COMMISSION</p><p>FORM 8-K</p>
<table><tr><td>Item&#160;2.02</td><td>Results of Operations and Financial Condition</td></tr></table>
<p>On October 1, 2026, NIKE, Inc. issued a press release announcing its results.</p>
<p><b>ITEM 2.05 Costs Associated with Exit or Disposal Activities</b></p>
<p>On October 1, 2026, the Company announced a multi-year enterprise program.</p>
<p>The Company expects approximately $0.3 billion to be recognized in fiscal 2027.</p>
<p>Item 9.01 Financial Statements and Exhibits</p><p>(d) Exhibits</p>
<p>SIGNATURES</p><p>Pursuant to the requirements of the Securities Exchange Act of 1934...</p>
</body></html>`;

// ---------- fetch stub ----------
let calls = [], routes = [];
const realFetch = globalThis.fetch;
const sse = (chunks, headers = {}) => {
  const enc = new TextEncoder();
  const body = new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(enc.encode(x)); c.close(); } });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream", ...headers } });
};
const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...headers } });
const html = (s, status = 200) => new Response(s, { status, headers: { "content-type": "text/html" } });
function route(match, fn) { routes.push({ match, fn }); }
// standard SEC routes
function secRoutes() {
  route((u) => u === "https://www.sec.gov/files/company_tickers.json", () => json(TICKERS));
  route((u) => u === "https://data.sec.gov/submissions/CIK0000320187.json", () => json(SUBMISSIONS));
  route((u) => u === `${BASE}${ACC}-index.htm`, () => html(INDEX_HTML));
  route((u) => u === `${BASE}q1fy27exhibit991er.htm`, () => html(EXHIBIT_HTML));
  route((u) => u === `${BASE}nke-20261001.htm`, () => html(PRIMARY_HTML));
}
// an MCP server: initialize (SSE, with a session id), notifications (202), tools/call -> onCall(body, n)
function mcpServer(onCall, { sessionId = "sess-1", initJson = false } = {}) {
  let n = 0;
  route((u) => u === config.edgarToolsUrl, (u, init, body) => {
    if (body.method === "initialize") {
      const reply = { jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "edgar-tools", version: "1" } } };
      return initJson ? json(reply, 200, { "mcp-session-id": sessionId }) : sse([`event: message\ndata: ${JSON.stringify(reply)}\n\n`], { "mcp-session-id": sessionId });
    }
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    return onCall(body, ++n, init);
  });
}
const toolResult = (id, payload, extra = {}) => ({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(payload) }], ...extra } });

let db;
beforeEach(() => {
  calls = []; routes = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: u, init, body });
    const r = routes.find((x) => x.match(u, body));
    if (!r) throw new Error("unexpected fetch " + u);
    return r.fn(u, init, body);
  };
  db = openDb(":memory:");
  config.edgarToolsApiKey = "";
  config.secUserAgent = "";
  resetEdgarSession();
  Object.assign(secInternals, { gapMs: 0, backoffMs: 5 });
  edgarInternals.timeoutMs = 45000;
});
afterEach(() => { globalThis.fetch = realFetch; });

const rejects = async (p, status, code, re) => {
  await assert.rejects(p, (e) => { assert.equal(e.status, status); assert.equal(e.code, code); if (re) assert.match(e.message, re); return true; });
};

// ---------- validation ----------
test("only the three tools and the page's parameters pass", async () => {
  assert.deepEqual(EDGAR_TOOLS, ["material_events", "filing_section", "financial_statements"]);
  const bad = (tool, input, code = "bad_parameter") => assert.throws(() => resolveEdgar(tool, input), (e) => e.status === 400 && e.code === code);
  bad("company_brief", { company: "NKE" }, "unknown_tool");
  bad("material_events", {});
  bad("material_events", { company: "NKE;DROP TABLE" });
  bad("material_events", { company: "https://evil.example/x" });
  bad("material_events", { company: "NKE", url: "https://evil.example" });
  bad("material_events", { company: "NKE", limit: 0 });
  bad("material_events", { company: "NKE", limit: 51 });
  bad("material_events", { company: "NKE", limit: 2.5 });
  bad("material_events", { company: "NKE", since: "2024-13-01" });
  bad("material_events", { company: "NKE", since: "2024-02-30" });
  bad("material_events", { company: "NKE", since: "yesterday" });
  bad("material_events", { company: "NKE", item: "2.2" });
  bad("material_events", { company: "NKE", since: "2026-02-01", until: "2026-01-01" });
  bad("material_events", { company: { $ne: 1 } });
  bad("filing_section", { accession: "0000320187-26-184", section: "earnings_release" });
  bad("filing_section", { accession: "../../etc/passwd", section: "earnings_release" });
  bad("filing_section", { accession: ACC });
  bad("filing_section", { accession: ACC, section: "mdna" });
  bad("filing_section", { accession: ACC, section: "eight_k_item:2.05; rm" });
  bad("filing_section", { accession: ACC, section: "earnings_release", tables: "everything" });
  bad("filing_section", { accession: ACC, section: "earnings_release", prose: "some" });
  bad("financial_statements", { company: "NKE", statement: "income_statement", period: "annual" });
  bad("financial_statements", { company: "NKE", statement: "breakdown:geography", period: "ttm" });

  // what the page sends passes; the cache key ignores key order and ticker case
  const a = resolveEdgar("material_events", { company: "nke", item: "2.02", since: "2024-07-28", limit: 12 });
  const b = resolveEdgar("material_events", { limit: "12", since: "2024-07-28", item: "2.02", company: "NKE" });
  assert.equal(a.key, b.key);
  assert.deepEqual(a.args, { company: "NKE", item: "2.02", since: "2024-07-28", limit: 12 });
  assert.match(a.key, /^[0-9a-f]{64}$/);
  assert.notEqual(a.key, resolveEdgar("material_events", { company: "NKE", item: "2.02", since: "2024-07-28", limit: 3 }).key);
  resolveEdgar("material_events", { company: "NKE", since: "2025-10-06", limit: 30 }); // the notes draft
  resolveEdgar("material_events", { company: "BRK.B", item: "2.02" });
  resolveEdgar("filing_section", { accession: ACC, section: "earnings_release", tables: "all", prose: "none" });
  resolveEdgar("filing_section", { accession: ACC, section: "eight_k_item:2.05" });
  resolveEdgar("financial_statements", { company: "NKE", statement: "breakdown:geography", period: "annual" });
});

// ---------- Edgar Tools MCP client ----------
test("Edgar Tools over SSE: handshake, session id, payload passed through unchanged, then cached", async () => {
  config.edgarToolsApiKey = "et-test-key";
  mcpServer((body) => {
    assert.equal(body.method, "tools/call");
    assert.deepEqual(body.params, { name: "material_events", arguments: { company: "NKE", item: "2.02", since: "2024-07-28", limit: 12 } });
    const text = `data: ${JSON.stringify(toolResult(body.id, NKE_EVENTS))}\n\n`;
    // a progress notification first, and the reply split across chunks
    return sse([`event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":1}}\n\n`, "event: message\n", text.slice(0, 50), text.slice(50)], {});
  });
  const out = await callEdgar(db, "material_events", { company: "nke", item: "2.02", since: "2024-07-28", limit: 12 }, {});
  assert.equal(out.provider, "edgar_tools");
  assert.equal(out.cacheHit, false);
  assert.deepEqual(out.payload, NKE_EVENTS);
  const [init, notif, call] = calls;
  assert.equal(init.body.method, "initialize");
  assert.equal(init.body.params.protocolVersion, "2025-06-18");
  assert.equal(init.init.headers.authorization, "Bearer et-test-key");
  assert.match(init.init.headers.accept, /application\/json/);
  assert.match(init.init.headers.accept, /text\/event-stream/);
  assert.equal(init.init.headers["content-type"], "application/json");
  assert.equal(init.init.headers["mcp-session-id"], undefined);
  assert.equal(notif.body.method, "notifications/initialized");
  assert.equal(notif.body.id, undefined);
  assert.equal(notif.init.headers["mcp-session-id"], "sess-1");
  assert.equal(call.init.headers["mcp-session-id"], "sess-1");
  assert.equal(call.init.headers["mcp-protocol-version"], "2025-06-18");
  // second identical call: from sec_cache, no request
  const again = await callEdgar(db, "material_events", { company: "NKE", item: "2.02", since: "2024-07-28", limit: 12 }, {});
  assert.equal(again.cacheHit, true);
  assert.equal(again.provider, "edgar_tools");
  assert.deepEqual(again.payload, NKE_EVENTS);
  assert.equal(calls.length, 3);
  const row = db.get("SELECT kind, ticker, expires_at_ms FROM sec_cache WHERE kind = 'edgar:material_events'");
  assert.equal(row.ticker, "NKE");
  assert.ok(Math.abs(row.expires_at_ms - Date.now() - 6 * 3600e3) < 60e3);
});

test("Edgar Tools JSON replies: the session is reused across calls; a dropped session is re-initialised once", async () => {
  config.edgarToolsApiKey = "et-test-key";
  const section = { section: "earnings_release", title: "EX-99.1", content: "", tables_html: ["<table><tr><td>Revenues</td><td>11,213</td></tr></table>"], filing_date: "20261001" };
  let drop = false;
  mcpServer((body, n) => {
    if (drop) { drop = false; return new Response("session not found", { status: 404 }); }
    return json(toolResult(body.id, n === 1 ? NKE_EVENTS : section));
  }, { initJson: true });
  const a = await callEdgar(db, "material_events", { company: "NKE", item: "2.02", since: "2026-01-01", limit: 3 }, {});
  assert.deepEqual(a.payload, NKE_EVENTS);
  const b = await callEdgar(db, "filing_section", { accession: ACC, section: "earnings_release", tables: "all", prose: "none" }, {});
  assert.deepEqual(b.payload, section);
  assert.equal(calls.filter((c) => c.body?.method === "initialize").length, 1);
  drop = true;
  const c = await callEdgar(db, "filing_section", { accession: ACC, section: "earnings_release", tables: "outlook", prose: "full" }, {});
  assert.deepEqual(c.payload, section);
  assert.equal(calls.filter((c) => c.body?.method === "initialize").length, 2);
  assert.equal(db.get("SELECT expires_at_ms FROM sec_cache WHERE kind = 'edgar:filing_section' LIMIT 1").expires_at_ms > Date.now() + 300 * 864e5, true);
});

test("Edgar Tools errors: a bad key is reported (no fallback), 429 is retryable, tool errors fall back to SEC", async () => {
  config.edgarToolsApiKey = "bad-key";
  route((u) => u === config.edgarToolsUrl, () => new Response("unauthorized", { status: 401 }));
  secRoutes();
  await rejects(callEdgar(db, "material_events", { company: "NKE", item: "2.02", since: "2026-01-01" }, {}), 502, "tool_error", /check the API key/);
  assert.equal(calls.filter((c) => c.url.includes("sec.gov")).length, 0);

  // 429 from Edgar Tools and SEC down too: the page gets a retryable rate_limited
  routes = []; calls = []; resetEdgarSession();
  config.edgarToolsApiKey = "et-test-key";
  mcpServer(() => new Response("slow down", { status: 429, headers: { "retry-after": "3" } }));
  route((u) => u.includes("sec.gov"), () => new Response("down", { status: 500 }));
  await rejects(callEdgar(db, "material_events", { company: "NKE", item: "2.02", since: "2026-01-01" }, {}), 503, "rate_limited");
  try { await callEdgar(db, "material_events", { company: "NKE", item: "2.02", since: "2026-01-02" }, {}); } catch (e) { assert.equal(e.extra.retryable, true); assert.equal(e.extra.retryAfterMs, 3000); }

  // an isError tool result falls back to SEC, which answers
  routes = []; calls = []; resetEdgarSession();
  mcpServer((body) => json({ jsonrpc: "2.0", id: body.id, result: { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code: "QUOTA_EXCEEDED", message: "Monthly quota used up." } }) }] } }));
  secRoutes();
  const out = await callEdgar(db, "material_events", { company: "NKE", item: "2.02", since: "2026-01-01", limit: 5 }, {});
  assert.equal(out.provider, "sec");
  assert.equal(out.payload.results[0].accession_number, ACC);
  // fallback answers are kept only an hour while a key is configured
  const row = db.get("SELECT body, expires_at_ms FROM sec_cache WHERE kind = 'edgar:material_events'");
  assert.equal(JSON.parse(row.body).provider, "sec");
  assert.ok(row.expires_at_ms < Date.now() + 3601e3);
  assert.ok(db.get("SELECT 1 AS x FROM error_log WHERE source = 'edgar_tools' AND message LIKE '%QUOTA_EXCEEDED%'"));

  // with SEC unable to help (geography), the Edgar Tools message is what the page sees
  routes = []; calls = []; resetEdgarSession();
  mcpServer((body) => json({ jsonrpc: "2.0", id: body.id, result: { isError: true, content: [{ type: "text", text: "Unknown company ZZZZ" }] } }));
  await rejects(callEdgar(db, "financial_statements", { company: "ZZZZ", statement: "breakdown:geography", period: "annual" }, {}), 502, "tool_error", /Unknown company ZZZZ/);
});

test("Edgar Tools timeout is a clean tool_error", async () => {
  config.edgarToolsApiKey = "et-test-key";
  edgarInternals.timeoutMs = 50;
  route((u) => u === config.edgarToolsUrl, (u, init) => new Promise((res, rej) => init.signal.addEventListener("abort", () => rej(init.signal.reason))));
  const keepAlive = setTimeout(() => {}, 5000); // AbortSignal.timeout's timer doesn't hold the event loop open
  try {
    await rejects(callEdgar(db, "financial_statements", { company: "NKE", statement: "breakdown:geography", period: "annual" }, {}), 502, "tool_error", /didn't answer/);
  } finally { clearTimeout(keepAlive); }
});

// ---------- SEC-direct fallback ----------
test("material_events from SEC submissions: 8-K item filter, window, newest first, limit, connector field names", async () => {
  secRoutes();
  const out = await callEdgar(db, "material_events", { company: "NKE", item: "2.02", since: "2025-01-01", limit: 3 }, {});
  assert.equal(out.provider, "sec");
  assert.equal(out.cacheHit, false);
  const p = out.payload;
  assert.deepEqual(p.company, { cik: 320187, name: "NIKE, Inc.", ticker: "NKE" });
  assert.deepEqual(p.results.map((r) => r.accession_number), ["0000320187-26-000184", "0000320187-26-000076", "0000320187-26-000070"]);
  assert.equal(p.total, 5); // 184, 076, 070, 026 and the 8-K/A; not 170 (no 2.02), the Form 4, or 2024
  assert.equal(p.showing, 3);
  assert.deepEqual(p.results[0], {
    filing_date: "2026-10-01", accession_number: ACC, form: "8-K", items: ["2.02", "2.05", "9.01"],
    item_names: ["Results of Operations and Financial Condition", "Costs Associated with Exit or Disposal Activities", "Financial Statements and Exhibits"],
    sec_url: "https://www.sec.gov/Archives/edgar/data/320187/000032018726000184/0000320187-26-000184-index.htm", description: "8-K",
  });
  assert.equal(p.coverage.item_filter, "2.02");
  assert.equal(p.coverage.since, "2025-01-01");
  // every request carries the generic User-Agent, which names no person
  for (const c of calls) assert.equal(c.init.headers["user-agent"], DEFAULT_SEC_UA);
  assert.doesNotMatch(DEFAULT_SEC_UA, /@/);

  // a wider window and no item filter: amendments flagged; submissions and tickers come from the cache
  const n = calls.length;
  const all = await callEdgar(db, "material_events", { company: "NKE", since: "2025-06-01", limit: 30 }, {});
  assert.equal(calls.length, n);
  assert.equal(all.cacheHit, true);
  assert.deepEqual(all.payload.results.map((r) => r.filing_date), ["2026-10-01", "2026-09-16", "2026-06-30", "2026-06-23", "2026-03-31", "2025-12-22"]);
  assert.equal(all.payload.results[5].is_amendment, true);
  assert.equal(all.payload.results[0].is_amendment, undefined);

  // a configured SEC_USER_AGENT is used; a ticker SEC doesn't list is a clean error
  config.secUserAgent = "Company Model ops@company.example";
  db.run("DELETE FROM sec_cache");
  const db2 = openDb(":memory:");
  await callEdgar(db2, "material_events", { company: "BRK.B", item: "2.02", since: "2026-01-01" }, {}).catch(() => {});
  assert.equal(calls.at(-1).init.headers["user-agent"], "Company Model ops@company.example");
  assert.ok(calls.some((c) => c.url === "https://data.sec.gov/submissions/CIK0001067983.json")); // BRK.B -> BRK-B -> CIK
  await rejects(callEdgar(db2, "material_events", { company: "ZZZZ", item: "2.02" }, {}), 502, "tool_error", /ZZZZ/);
});

test("filing_section earnings_release from the exhibit: stripped tables, outlook pick, prose, one fetch per filing", async () => {
  secRoutes();
  const all = (await callEdgar(db, "filing_section", { accession: ACC, section: "earnings_release", tables: "all", prose: "none" }, {})).payload;
  assert.equal(calls.length, 2); // index + exhibit
  assert.equal(all.title, "EX-99.1");
  assert.equal(all.exhibit_filename, "q1fy27exhibit991er.htm");
  assert.equal(all.form, "8-K");
  assert.equal(all.accession_number, ACC);
  assert.equal(all.filing_date, "20261001");
  assert.equal(all.content, "");
  assert.equal(all.prose_scope, "none");
  assert.equal(all.tables_scope, "all");
  assert.equal(all.tables_html.length, 2); // the bullet layout table reads as prose
  const [guide, income] = all.tables_html;
  assert.equal(guide, '<table><tr><td colspan="3">Guidance</td></tr><tr><td>Revenue</td><td>$11.0 billion</td><td>$11.5 billion</td></tr></table>');
  assert.match(income, /^<table><tr><td colspan="12">CONSOLIDATED STATEMENTS OF INCOME<\/td><\/tr>/);
  assert.match(income, /<td colspan="3" rowspan="2">8\/31\/2026<\/td>/);
  assert.match(income, /<td>\$<\/td><td>11,213<\/td>/);
  assert.match(income, /<td colspan="3">Shareholders' equity &amp; other<\/td><td>\(14\)<\/td><td>—<\/td>/);
  for (const h of all.tables_html) assert.doesNotMatch(h, /style=|class=|<div|<font|<script|secret/);
  assert.deepEqual(all.tables_available.map((t) => t.class), ["outlook", "income"]);
  // the page's tablesToText, row by row
  const rows = income.match(/<tr>.*?<\/tr>/g).map((tr) => (tr.match(/<td[^>]*>(.*?)<\/td>/g) || []).map((c) => c.replace(/<[^>]*>/g, "").trim()).filter(Boolean).join(" | "));
  assert.deepEqual(rows.slice(1, 3), ["(In millions) | 8/31/2026 | 8/31/2025", "Revenues | $ | 11,213 | $ | 11,720"]);

  const out = await callEdgar(db, "filing_section", { accession: ACC, section: "earnings_release", tables: "outlook", prose: "full" }, {});
  assert.equal(out.cacheHit, true); // the parsed exhibit is cached; no new request
  assert.equal(calls.length, 2);
  const o = out.payload;
  assert.deepEqual(o.tables_html, [guide]);
  assert.match(o.content, /Sport Offense continued to drive momentum/);
  assert.match(o.content, /BEAVERTON, Ore\., Oct\. 1, 2026 — NIKE, Inc\. today reported/);
  assert.match(o.content, /Outlook\n+Revenues are expected to decline high-single digits in fiscal 2027\./);
  assert.match(o.content, /\[table\]/);
  assert.doesNotMatch(o.content, /do not leak|color:red|Wdesk|<|EX-99\.1|SEQUENCE|  /);
  assert.equal(o.char_count, o.content.length);
  assert.equal(o.word_count, o.content.split(/\s+/).filter(Boolean).length);

  const core = (await callEdgar(db, "filing_section", { accession: ACC, section: "earnings_release", tables: "core", prose: "full" }, {})).payload;
  assert.deepEqual(core.tables_html, [income]);
  const none = (await callEdgar(db, "filing_section", { accession: ACC, section: "earnings_release", tables: "none", prose: "full" }, {})).payload;
  assert.deepEqual(none.tables_html, []);
  assert.equal(calls.length, 2);
});

test("outlook with no outlook table returns every table; parse helpers", () => {
  const doc = parseHtmlDoc("<html><body><p>Results</p><table><tr><td>Revenue</td><td>1,000</td><td>900</td></tr></table><table><tr><td>Net income</td><td>100</td><td>90</td></tr></table></body></html>");
  assert.equal(doc.tables.length, 2);
  assert.equal(doc.prose, "Results\n\n[table]\n\n[table]");
  const tables = doc.tables.map((t) => ({ ...t, cls: classifyTable(t) }));
  assert.equal(selectTables(tables, "outlook").length, 2);
  assert.equal(selectTables(tables, "none").length, 0);
  const item = extractItem("FORM 8-K\nItem 2.02. Results of Operations\nText A\nItem 9.01 Exhibits\nSIGNATURES", "2.02");
  assert.equal(item, "Item 2.02. Results of Operations\nText A");
  assert.equal(extractItem("Item 8.01 Other Events\nx", "2.02"), null);
});

test("filing_section eight_k_item reads the item from the primary 8-K document", async () => {
  secRoutes();
  const p = (await callEdgar(db, "filing_section", { accession: ACC, section: "eight_k_item:2.05" }, {})).payload;
  assert.equal(p.section, "eight_k_item:2.05");
  assert.equal(p.title, "Costs Associated with Exit or Disposal Activities");
  assert.equal(p.item_number, "2.05");
  assert.equal(p.filing_date, "20261001");
  assert.match(p.content, /^ITEM 2\.05 Costs Associated with Exit or Disposal Activities\n+On October 1, 2026, the Company announced/);
  assert.match(p.content, /\$0\.3 billion to be recognized in fiscal 2027\.$/);
  assert.doesNotMatch(p.content, /9\.01|SIGNATURES|hidden facts/);
  assert.ok(calls.some((c) => c.url === `${BASE}nke-20261001.htm`)); // the /ix?doc= link resolved to the document
  const p2 = (await callEdgar(db, "filing_section", { accession: ACC, section: "eight_k_item:2.02" }, {})).payload;
  assert.match(p2.content, /^Item 2\.02 Results of Operations and Financial Condition\n+On October 1, 2026, NIKE, Inc\. issued a press release/);
  assert.doesNotMatch(p2.content, /2\.05/);
  await rejects(callEdgar(db, "filing_section", { accession: ACC, section: "eight_k_item:8.01" }, {}), 502, "tool_error", /8\.01/);
});

test("financial_statements without Edgar Tools is a clean tool_error (the page's load() ignores it)", async () => {
  await rejects(callEdgar(db, "financial_statements", { company: "NKE", statement: "breakdown:geography", period: "annual" }, {}), 502, "tool_error", /needs Edgar Tools/);
  assert.equal(calls.length, 0);
});

test("SEC refusals and retries: missing User-Agent contact, one retry on 429, 404 filing", async () => {
  route((u) => u.includes("company_tickers"), () => html("<title>SEC.gov | Your Request Originates from an Undeclared Automated Tool</title>", 403));
  await rejects(callEdgar(db, "material_events", { company: "NKE", item: "2.02" }, {}), 502, "tool_error", /SEC_USER_AGENT/);

  routes = []; calls = [];
  let n = 0;
  route((u) => u.includes("company_tickers"), () => (++n === 1 ? new Response("busy", { status: 429 }) : json(TICKERS)));
  route((u) => u.includes("submissions"), () => json(SUBMISSIONS));
  const out = await callEdgar(db, "material_events", { company: "NKE", item: "2.02", since: "2026-01-01" }, {});
  assert.equal(out.payload.results.length, 4);
  assert.equal(n, 2);

  routes = []; calls = [];
  route((u) => u.includes("data.sec.gov"), () => new Response("busy", { status: 503 }));
  route((u) => u.includes("www.sec.gov"), () => new Response("missing", { status: 404 }));
  await rejects(callEdgar(db, "filing_section", { accession: "0000320187-26-000999", section: "earnings_release", tables: "all", prose: "none" }, {}), 502, "tool_error", /isn't on SEC EDGAR/);
});

test("stale-on-error: an expired copy up to 7 days old is served when the source fails", async () => {
  const { key } = resolveEdgar("material_events", { company: "NKE", item: "2.02", since: "2026-01-01" });
  db.run("INSERT INTO sec_cache (key, kind, ticker, body, bytes, fetched_at, expires_at_ms) VALUES (?, 'edgar:material_events', 'NKE', ?, 10, ?, ?)",
    key, JSON.stringify({ provider: "sec", payload: { results: [{ accession_number: "old" }] } }), new Date().toISOString(), Date.now() - 864e5);
  route(() => true, () => new Response("down", { status: 500 }));
  const out = await callEdgar(db, "material_events", { company: "NKE", item: "2.02", since: "2026-01-01" }, {});
  assert.equal(out.stale, true);
  assert.equal(out.cacheHit, true);
  assert.equal(out.payload.results[0].accession_number, "old");
  // older than 7 days: the error goes through
  db.run("UPDATE sec_cache SET expires_at_ms = ? WHERE key = ?", Date.now() - 8 * 864e5, key);
  await rejects(callEdgar(db, "material_events", { company: "NKE", item: "2.02", since: "2026-01-01" }, {}), 502, "tool_error");
  pruneSecCache(db);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM sec_cache WHERE key = ?", key).n, 0);
});

test("SEC requests are spaced at least gapMs apart (at most 8 per second by default)", async () => {
  assert.equal(secInternals.gapMs, 0); // set by beforeEach; the default is 125
  secInternals.gapMs = 40;
  const t0 = Date.now();
  await Promise.all([secThrottle(), secThrottle(), secThrottle(), secThrottle()]);
  assert.ok(Date.now() - t0 >= 115, "4 slots take at least 3 gaps");
});
