// FMP: the connector calls the page makes, mapped onto FMP's stable REST API (the payloads are the same; checked
// endpoint by endpoint against the connector's responses). Only these (tool, endpoint) pairs and parameters pass,
// so the route can't be used as an open FMP proxy. The API key is added here and never reaches the browser.
import crypto from "node:crypto";
import fs from "node:fs";
import { config } from "../config.js";
import { nowIso } from "../db.js";
import { fail } from "../http.js";

const H = 3600;
// tool -> endpoint -> { path, params: allowed input keys -> FMP query names, ttl seconds, ticker scoped }
export const FMP_MAP = {
  statements: {
    "income-statement": { path: "income-statement", params: { symbol: "symbol", period: "period", limit: "limit" }, ttl: 12 * H },
    "balance-sheet-statement": { path: "balance-sheet-statement", params: { symbol: "symbol", period: "period", limit: "limit" }, ttl: 12 * H },
    "cashflow-statement": { path: "cash-flow-statement", params: { symbol: "symbol", period: "period", limit: "limit" }, ttl: 12 * H },
    "revenue-product-segmentation": { path: "revenue-product-segmentation", params: { symbol: "symbol", period: "period", structure: "structure" }, ttl: 24 * H },
    "revenue-geographic-segments": { path: "revenue-geographic-segmentation", params: { symbol: "symbol", period: "period", structure: "structure" }, ttl: 24 * H },
    "metrics-ratios": { path: "ratios", params: { symbol: "symbol", period: "period", limit: "limit" }, ttl: 24 * H },
  },
  analyst: {
    "financial-estimates": { path: "analyst-estimates", params: { symbol: "symbol", period: "period", limit: "limit" }, ttl: 12 * H },
  },
  company: {
    "profile-symbol": { path: "profile", params: { symbol: "symbol" }, ttl: 120 },
  },
  economics: {
    "treasury-rates": { path: "treasury-rates", params: { from_date: "from", to_date: "to" }, ttl: 6 * H, global: true },
    "market-risk-premium": { path: "market-risk-premium", params: {}, ttl: 7 * 24 * H, global: true },
  },
  earningsTranscript: {
    "transcripts-dates-by-symbol": { path: "earning-call-transcript-dates", params: { symbol: "symbol" }, ttl: 12 * H },
    "search-transcripts": { path: "earning-call-transcript", params: { symbol: "symbol", year: "year", quarter: "quarter" }, ttl: 365 * 24 * H },
  },
  calendar: {
    "earnings-company": { path: "earnings", params: { symbol: "symbol", limit: "limit" }, ttl: 6 * H },
  },
};

const VALUE = /^[A-Za-z0-9.\-_^:]{1,24}$/;
export function resolveFmp(tool, input) {
  const def = FMP_MAP[tool]?.[input?.endpoint];
  if (!def) fail(400, "unknown_tool", `FMP ${tool}/${input?.endpoint} isn't available here.`);
  const q = {};
  for (const [k, v] of Object.entries(input || {})) {
    if (k === "endpoint" || v === undefined || v === null) continue;
    const name = def.params[k];
    if (!name) fail(400, "bad_parameter", `Parameter ${k} isn't allowed for ${input.endpoint}.`);
    const s = String(v);
    if (!VALUE.test(s)) fail(400, "bad_parameter", `Bad value for ${k}.`);
    if (k === "limit" && !(+s >= 1 && +s <= 40)) fail(400, "bad_parameter", "limit must be 1-40.");
    q[name] = k === "symbol" ? s.toUpperCase() : s;
  }
  if (!def.global && !q.symbol) fail(400, "bad_parameter", "symbol is required.");
  const keys = Object.keys(q).sort();
  const key = crypto.createHash("sha256").update(def.path + "?" + keys.map((k) => k + "=" + q[k]).join("&")).digest("hex");
  return { def, query: q, key, ticker: def.global ? null : q.symbol };
}

// test mode: serve the saved connector responses instead of calling FMP
let fixtures = null;
function fromFixtures(input) {
  fixtures = fixtures || JSON.parse(fs.readFileSync(config.fmpFixtures, "utf8"));
  const t = (input.symbol || "NKE").toUpperCase(), d = fixtures[t];
  const key = input.endpoint + "|" + (input.period ?? (input.year ? input.year + "Q" + input.quarter : "None"));
  if (!d || !(key in d)) fail(502, "tool_error", "No fixture for " + t + " " + key);
  return d[key];
}

// geography labels the admin corrected for a ticker (the data-quality queue's fix), applied to FMP payloads
function applyOverrides(db, ticker, endpoint, body) {
  if (!ticker || !Array.isArray(body) || !/segment/.test(endpoint)) return body;
  const rules = db.all("SELECT kind, rule FROM ticker_overrides WHERE ticker = ? AND active = 1", ticker);
  if (!rules.length) return body;
  const kind = endpoint.includes("geographic") ? "geo_label" : "product_label";
  const map = new Map(rules.filter((r) => r.kind === kind).map((r) => { const x = JSON.parse(r.rule); return [x.from, x.to]; }));
  if (!map.size) return body;
  return body.map((row) => (row && row.data ? { ...row, data: Object.fromEntries(Object.entries(row.data).map(([k, v]) => [map.get(k) || k, v])), _overridden: true } : row));
}

export async function callFmp(db, tool, input) {
  const { def, query, key, ticker } = resolveFmp(tool, input);
  const now = Date.now();
  const cached = db.get("SELECT body, expires_at_ms FROM fmp_cache WHERE key = ?", key);
  if (cached && cached.expires_at_ms > now) {
    db.run("UPDATE fmp_cache SET hits = hits + 1, last_hit_at = ? WHERE key = ?", nowIso(), key);
    return { payload: applyOverrides(db, ticker, input.endpoint, JSON.parse(cached.body)), cacheHit: true, ticker };
  }
  let body;
  try {
    if (config.fmpFixtures) body = fromFixtures(input);
    else {
      const url = new URL(config.fmpBase + "/" + def.path);
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
      if (config.fmpApiKey) url.searchParams.set("apikey", config.fmpApiKey);
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      const text = await res.text();
      if (res.status === 429 || res.status >= 500) fail(503, "rate_limited", "FMP is busy. Retrying.", { retryable: true, retryAfterMs: 2000 });
      if (res.status === 401 || res.status === 403) fail(502, "tool_error", "FMP refused the request (check the plan and API key).");
      if (!res.ok) fail(502, "tool_error", `FMP returned ${res.status}.`);
      try { body = JSON.parse(text); } catch (e) { fail(502, "tool_error", "FMP returned something that isn't JSON."); }
      if (body && !Array.isArray(body) && body["Error Message"]) fail(502, "tool_error", String(body["Error Message"]).slice(0, 200));
    }
  } catch (e) {
    // stale-on-error: a cached copy up to 7 days old is better than nothing
    if (cached && cached.expires_at_ms > now - 7 * 864e5) {
      db.logError("fmp", e.code || "fetch", e.message, { ticker, endpoint: input.endpoint, stale: true });
      return { payload: applyOverrides(db, ticker, input.endpoint, JSON.parse(cached.body)), cacheHit: true, stale: true, ticker };
    }
    throw e;
  }
  const json = JSON.stringify(body);
  db.run(`INSERT INTO fmp_cache (key, path, params, ticker, body, bytes, fetched_at, expires_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (key) DO UPDATE SET body = excluded.body, bytes = excluded.bytes, fetched_at = excluded.fetched_at, expires_at_ms = excluded.expires_at_ms`,
    key, def.path, JSON.stringify(query), ticker, json, json.length, nowIso(), now + def.ttl * 1000);
  return { payload: applyOverrides(db, ticker, input.endpoint, body), cacheHit: false, ticker };
}
