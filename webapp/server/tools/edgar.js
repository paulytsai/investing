// Edgar Tools: the page's three filing tools (material_events, filing_section, financial_statements). With
// EDGAR_TOOLS_API_KEY set, calls go to the Edgar Tools MCP server (streamable HTTP, JSON-RPC 2.0) and the payload is
// the tool's own result, exactly what the claude.ai connector gave the page. Without a key, or when Edgar Tools
// fails for any reason other than the key, sec.js rebuilds the same payload shapes from sec.gov. Only these three
// tools and the parameters the page sends pass validation, so the route can't be used as an open proxy.
// Results are cached in sec_cache (key: sha256 of tool + normalised input) and served stale for up to 7 days on error.
import { config } from "../config.js";
import { ApiError, fail } from "../http.js";
import { cacheRow, cachePut, sha256, STALE_OK_MS, secMaterialEvents, secFilingSection } from "./sec.js";

export const EDGAR_TOOLS = ["material_events", "filing_section", "financial_statements"];

const H = 3600e3, D = 24 * H;
export const TOOL_TTL = { material_events: 6 * H, filing_section: 365 * D, financial_statements: D };

// ---------- input validation ----------
const TICKER = /^(?:[A-Za-z][A-Za-z0-9.-]{0,9}|\d{1,10})$/;
const ACCESSION = /^\d{10}-\d{2}-\d{6}$/;
const ITEM = /^\d{1,2}\.\d{2}$/;
const SECTION = /^(?:earnings_release|press_release|eight_k_item:\d{1,2}\.\d{2})$/;
const TABLES = ["none", "all", "outlook", "core", "income", "balance", "cashflow", "recon", "segment"];
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;

const str = (re, what) => (v) => { if (typeof v !== "string" || v.length > 40 || !re.test(v)) fail(400, "bad_parameter", `Bad value for ${what}.`); return v; };
const oneOf = (list, what) => (v) => { if (!list.includes(v)) fail(400, "bad_parameter", `${what} must be one of ${list.join(", ")}.`); return v; };
const date = (what) => (v) => { if (typeof v !== "string" || !isDate(v)) fail(400, "bad_parameter", `${what} must be a date (YYYY-MM-DD).`); return v; };
const int = (lo, hi, what) => (v) => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,3}$/.test(v) ? +v : NaN;
  if (!Number.isInteger(n) || n < lo || n > hi) fail(400, "bad_parameter", `${what} must be ${lo}-${hi}.`);
  return n;
};
const ticker = (v) => str(TICKER, "company")(v).toUpperCase();

// tool -> parameter -> [required, check]
const SPEC = {
  material_events: {
    company: [true, ticker], item: [false, str(ITEM, "item")], since: [false, date("since")], until: [false, date("until")],
    limit: [false, int(1, 50, "limit")], // the page's notes draft asks for 30; the connector allows 50
  },
  filing_section: {
    accession: [true, str(ACCESSION, "accession")], section: [true, str(SECTION, "section")],
    tables: [false, oneOf(TABLES, "tables")], prose: [false, oneOf(["none", "full"], "prose")],
  },
  financial_statements: {
    company: [true, ticker], statement: [true, oneOf(["breakdown:geography"], "statement")], period: [false, oneOf(["annual", "quarterly"], "period")],
  },
};

// -> {args: the normalised input, key: cache key, ticker}
export function resolveEdgar(tool, input) {
  const spec = SPEC[tool];
  if (!spec) fail(400, "unknown_tool", `Edgar Tools ${tool} isn't available here.`);
  if (!input || typeof input !== "object" || Array.isArray(input)) fail(400, "bad_parameter", "Expected an input object.");
  const args = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined || v === null) continue;
    if (!Object.prototype.hasOwnProperty.call(spec, k)) fail(400, "bad_parameter", `Parameter ${k} isn't allowed for ${tool}.`);
    args[k] = spec[k][1](v);
  }
  for (const [k, [req]] of Object.entries(spec)) if (req && args[k] === undefined) fail(400, "bad_parameter", `${k} is required.`);
  if (args.since && args.until && args.since > args.until) fail(400, "bad_parameter", "since is after until.");
  const keys = Object.keys(args).sort();
  const key = sha256("edgar:" + tool + "?" + keys.map((k) => k + "=" + args[k]).join("&"));
  return { args, key, ticker: args.company || null };
}

// ---------- Edgar Tools MCP client (streamable HTTP) ----------
const PROTOCOL = "2025-06-18";
export const edgarInternals = { timeoutMs: 45000 };
const mcp = { sessionId: null, ready: null, version: PROTOCOL, nextId: 1 };
export function resetEdgarSession() { mcp.sessionId = null; mcp.ready = null; mcp.version = PROTOCOL; }

const toolError = (message) => new ApiError(502, "tool_error", String(message).slice(0, 300));
function authError() { const e = new ApiError(502, "tool_error", "Edgar Tools refused the request (check the API key)."); e.auth = true; return e; }
function statusError(res) {
  if (res.status === 401 || res.status === 403) return authError();
  if (res.status === 429) {
    const ra = +res.headers.get("retry-after");
    return new ApiError(503, "rate_limited", "Edgar Tools is busy. Retrying.", { retryable: true, retryAfterMs: ra > 0 && ra <= 60 ? ra * 1000 : 2000 });
  }
  return toolError(`Edgar Tools returned ${res.status}.`);
}

async function post(message, { withSession = true } = {}) {
  const headers = { authorization: `Bearer ${config.edgarToolsApiKey}`, accept: "application/json, text/event-stream", "content-type": "application/json" };
  if (withSession) {
    if (mcp.sessionId) headers["mcp-session-id"] = mcp.sessionId;
    headers["mcp-protocol-version"] = mcp.version;
  }
  try {
    return await fetch(config.edgarToolsUrl, { method: "POST", headers, body: JSON.stringify(message), signal: AbortSignal.timeout(edgarInternals.timeoutMs) });
  } catch (e) {
    throw toolError(e?.name === "TimeoutError" ? `Edgar Tools didn't answer in ${Math.round(edgarInternals.timeoutMs / 1000)} seconds.` : "Couldn't reach Edgar Tools.");
  }
}

// one SSE event -> its JSON data (data: lines joined), or null
function sseData(raw) {
  const data = raw.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
  if (!data) return null;
  try { return JSON.parse(data); } catch (e) { return null; }
}
const isReply = (m, id) => m && typeof m === "object" && m.id === id && ("result" in m || "error" in m);

// the JSON-RPC reply with this id, from a JSON body or an SSE stream (read until the reply arrives)
export async function readReply(res, id) {
  const ct = res.headers.get("content-type") || "";
  try {
    if (ct.includes("text/event-stream")) {
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (value) buf += dec.decode(value, { stream: !done });
          let m;
          while ((m = /\r?\n\r?\n/.exec(buf))) {
            const msg = sseData(buf.slice(0, m.index));
            buf = buf.slice(m.index + m[0].length);
            const hit = Array.isArray(msg) ? msg.find((x) => isReply(x, id)) : isReply(msg, id) ? msg : null;
            if (hit) return hit;
          }
          if (done) { const msg = sseData(buf); return isReply(msg, id) ? msg : null; }
        }
      } finally { reader.cancel().catch(() => {}); }
    }
    const text = await res.text();
    if (!text.trim()) return null;
    let j;
    try { j = JSON.parse(text); } catch (e) { throw toolError("Edgar Tools returned something that isn't JSON."); }
    return Array.isArray(j) ? j.find((x) => isReply(x, id)) || null : j;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw toolError(e?.name === "TimeoutError" ? `Edgar Tools didn't answer in ${Math.round(edgarInternals.timeoutMs / 1000)} seconds.` : "Edgar Tools' answer was cut off.");
  }
}

// initialize handshake once per process (shared by concurrent calls); redone when the server drops the session
function ensureSession() {
  if (mcp.ready) return mcp.ready;
  const p = (async () => {
    const id = mcp.nextId++;
    const res = await post({ jsonrpc: "2.0", id, method: "initialize", params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "company-model-webapp", version: "0.1.0" } } }, { withSession: false });
    if (!res.ok) { await res.body?.cancel().catch(() => {}); throw statusError(res); }
    const sid = res.headers.get("mcp-session-id");
    const msg = await readReply(res, id);
    if (!msg || msg.error) throw toolError("Edgar Tools didn't start a session" + (msg?.error?.message ? ": " + msg.error.message : "."));
    mcp.sessionId = sid || null;
    mcp.version = msg.result?.protocolVersion || PROTOCOL;
    const n = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    await n.body?.cancel().catch(() => {});
    if (n.status === 401 || n.status === 403) throw authError();
  })();
  mcp.ready = p;
  p.catch(() => { if (mcp.ready === p) resetEdgarSession(); });
  return p;
}

async function rpc(method, params, retried = false) {
  await ensureSession();
  const sid = mcp.sessionId, id = mcp.nextId++;
  const res = await post({ jsonrpc: "2.0", id, method, params });
  if (res.status === 404 || res.status === 400) {
    const text = await res.text().catch(() => "");
    // the session expired or the server restarted: start a new one and try once more
    if (!retried && (res.status === 404 || /session/i.test(text))) {
      if (mcp.sessionId === sid) resetEdgarSession();
      return rpc(method, params, true);
    }
    throw statusError(res);
  }
  if (!res.ok) { await res.body?.cancel().catch(() => {}); throw statusError(res); }
  const msg = await readReply(res, id);
  if (!msg) throw toolError("Edgar Tools sent no answer.");
  return msg;
}

const errText = (p, text) => {
  const e = p && typeof p === "object" ? p.error || p : null;
  const m = e && typeof e === "object" ? [e.code, e.message].filter(Boolean).join(": ") : typeof e === "string" ? e : "";
  return "Edgar Tools: " + (m || text || "the tool failed.");
};
// tools/call -> the tool's payload (its JSON text content, else structuredContent, else the text)
export async function edgarToolsCall(tool, args) {
  const msg = await rpc("tools/call", { name: tool, arguments: args });
  if (msg.error) throw toolError("Edgar Tools: " + (msg.error.message || "error " + msg.error.code));
  const r = msg.result || {};
  const text = (r.content || []).filter((c) => c && c.type === "text" && typeof c.text === "string").map((c) => c.text).join("");
  let payload;
  try { payload = text ? JSON.parse(text) : undefined; } catch (e) { payload = undefined; }
  if (r.isError) {
    const code = payload?.error?.code || payload?.code || "";
    if (/RATE_LIMIT/i.test(code)) throw new ApiError(503, "rate_limited", "Edgar Tools is busy. Retrying.", { retryable: true, retryAfterMs: 3000 });
    throw toolError(errText(payload, text));
  }
  if (payload === undefined) payload = r.structuredContent ?? text;
  // an error object returned as an ordinary result
  if (payload && typeof payload === "object" && !Array.isArray(payload) && payload.error && Object.keys(payload).length <= 3 && !payload.results && !payload.content && !payload.groups) throw toolError(errText(payload, text));
  return payload;
}

// ---------- SEC-direct fallback ----------
const SEC_TOOLS = {
  material_events: secMaterialEvents,
  filing_section: secFilingSection,
  // revenue by geography needs dimensional XBRL from the 10-K, which SEC's companyfacts/frames APIs don't carry
  financial_statements: async () => fail(502, "tool_error", "Geographic breakdown needs Edgar Tools."),
};

// ---------- the route's entry point ----------
// -> {payload, provider: 'edgar_tools' | 'sec', cacheHit, stale?}
export async function callEdgar(db, tool, input, ctx = {}) {
  const { args, key, ticker } = resolveEdgar(tool, input);
  const ttl = TOOL_TTL[tool], now = Date.now();
  const row = cacheRow(db, key);
  if (row && row.expires_at_ms > now) { const b = JSON.parse(row.body); return { payload: b.payload, provider: b.provider, cacheHit: true }; }
  const log = (source, e, extra) => db.logError(source, e.code || "fetch", e.message, { userId: ctx.user?.id, ticker, tool, ...extra });
  const stale = (e) => {
    if (row && row.expires_at_ms > now - STALE_OK_MS) {
      log("edgar", e, { stale: true });
      const b = JSON.parse(row.body);
      return { payload: b.payload, provider: b.provider, cacheHit: true, stale: true };
    }
    throw e;
  };

  let primary = null;
  if (config.edgarToolsApiKey) {
    try {
      const payload = await edgarToolsCall(tool, args);
      cachePut(db, key, "edgar:" + tool, ticker, { provider: "edgar_tools", payload }, ttl);
      return { payload, provider: "edgar_tools", cacheHit: false };
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      log("edgar_tools", e);
      if (e.auth) return stale(e); // a key problem: say so rather than quietly reading SEC instead
      primary = e;
    }
  }
  const stats = {};
  try {
    const payload = await SEC_TOOLS[tool](db, args, stats);
    // with a key configured, keep the fallback briefly so Edgar Tools is asked again soon
    if (!stats.stale) cachePut(db, key, "edgar:" + tool, ticker, { provider: "sec", payload }, config.edgarToolsApiKey ? Math.min(ttl, H) : ttl);
    return { payload, provider: "sec", cacheHit: !stats.fetches, ...(stats.stale ? { stale: true } : {}) };
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    return stale(primary || e);
  }
}
