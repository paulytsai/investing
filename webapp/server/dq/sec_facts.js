// SEC XBRL company facts for the data-quality check (self-contained on purpose: it does not share code with
// tools/sec.js). Ticker -> CIK through company_tickers.json, then the company's facts from the XBRL API, slimmed to
// the tags the check reads and cached in sec_cache for 24 hours under "dq:" keys. Requests are serialised and spaced
// at least 200 ms apart (at most 5 per second; SEC's limit is 10) and carry a descriptive User-Agent. Set
// SEC_USER_AGENT to "<app name> <contact address>" in production; the default deliberately names no person.
import crypto from "node:crypto";
import { config } from "../config.js";
import { nowIso } from "../db.js";
import { secThrottle } from "../tools/sec.js";

export const DEFAULT_SEC_UA = "company-model-webapp/0.1 (self-hosted; set SEC_USER_AGENT)";
export const SEC_TTL_MS = 24 * 3600e3;
const STALE_OK_MS = 7 * 24 * 3600e3; // a cached copy this far past expiry still beats an error
const TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const factsUrl = (cik) => `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik10(cik)}.json`;

export const cik10 = (cik) => String(cik).padStart(10, "0");
export const secUserAgent = () => config.secUserAgent || DEFAULT_SEC_UA;
export const normTicker = (t) => String(t || "").trim().toUpperCase().replace(/\./g, "-");

export class SecError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// shares the filings module's limiter, so the app as a whole stays under SEC's 10 requests a second
const throttle = secThrottle;

// GET a JSON document from SEC; null on 404
async function secGet(url) {
  await throttle();
  let res;
  try {
    res = await fetch(url, { headers: { "user-agent": secUserAgent(), accept: "application/json" }, signal: AbortSignal.timeout(60000) });
  } catch (e) {
    throw new SecError("sec_unreachable", `SEC request failed (${url}): ${e.message}`);
  }
  if (res.status === 404) { await res.body?.cancel().catch(() => {}); return null; }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    // 403 is what SEC answers when it throttles or does not like the User-Agent
    throw new SecError(res.status === 403 || res.status === 429 ? "sec_refused" : "sec_http", `SEC returned ${res.status} for ${url}`);
  }
  try { return await res.json(); } catch (e) { throw new SecError("sec_bad_json", `SEC sent something that isn't JSON (${url}).`); }
}

// ---------- cache (sec_cache: key, kind, ticker, body, bytes, fetched_at, expires_at_ms) ----------
function cacheWrite(db, key, kind, ticker, value) {
  const body = JSON.stringify(value);
  db.run(`INSERT INTO sec_cache (key, kind, ticker, body, bytes, fetched_at, expires_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (key) DO UPDATE SET kind = excluded.kind, ticker = excluded.ticker, body = excluded.body, bytes = excluded.bytes,
          fetched_at = excluded.fetched_at, expires_at_ms = excluded.expires_at_ms`,
    key, kind, ticker || null, body, Buffer.byteLength(body), nowIso(), Date.now() + SEC_TTL_MS);
}
async function cached(db, key, kind, ticker, load) {
  const row = db.get("SELECT body, expires_at_ms FROM sec_cache WHERE key = ?", key);
  if (row && row.expires_at_ms > Date.now()) return JSON.parse(row.body);
  try {
    const value = await load();
    cacheWrite(db, key, kind, ticker, value);
    return value;
  } catch (e) {
    if (row && row.expires_at_ms > Date.now() - STALE_OK_MS) {
      db.logError("dq", e.code || "sec_fetch", e.message, { ticker, key, stale: true });
      return JSON.parse(row.body);
    }
    throw e;
  }
}
// drop this module's cache rows a week after they expired (jobs.js prunes fmp_cache but not sec_cache)
export function pruneSecCache(db) {
  db.run("DELETE FROM sec_cache WHERE key LIKE 'dq:%' AND expires_at_ms < ?", Date.now() - STALE_OK_MS);
}

// ---------- ticker -> CIK ----------
// returns {cik, name} or null when SEC doesn't list the ticker (not an SEC registrant, or an OTC/foreign line)
export async function lookupCik(db, ticker) {
  const map = await cached(db, "dq:company_tickers", "dq:company_tickers", null, async () => {
    const j = await secGet(TICKERS_URL);
    if (!j || typeof j !== "object") throw new SecError("sec_http", "SEC's company_tickers.json is missing.");
    const m = {};
    for (const v of Object.values(j)) {
      const t = v && normTicker(v.ticker);
      if (t && v.cik_str && !(t in m)) m[t] = [Number(v.cik_str), String(v.title || "")];
    }
    return m;
  });
  const hit = map[normTicker(ticker)];
  return hit ? { cik: hit[0], name: hit[1] } : null;
}

// ---------- company facts ----------
// spec: {annual: ["us-gaap:Revenues", ...], interim: ["us-gaap:EarningsPerShareDiluted", "dei:...", ...]}
// annual tags keep facts from 10-K and 10-K/A; interim tags also keep 10-Q facts (the split detection needs them).
// Only USD, USD/shares and shares units are kept. The cache key carries a hash of the spec, so changing the tag
// mapping never reads a slimmed copy that lacks a new tag.
const UNITS = new Set(["USD", "USD/shares", "shares"]);
const ANNUAL_FORM = /^10-K(\/A)?$/;
const INTERIM_FORM = /^10-[KQ](\/A)?$/;

export function slimFacts(j, spec) {
  const annual = new Set(spec.annual || []), interim = new Set(spec.interim || []);
  const out = { cik: Number(j.cik), entityName: j.entityName || "", namespaces: Object.keys(j.facts || {}), forms: {}, facts: {} };
  for (const [ns, tags] of Object.entries(j.facts || {})) {
    for (const [tag, def] of Object.entries(tags || {})) {
      const id = ns + ":" + tag, keepI = interim.has(id), keepA = keepI || annual.has(id);
      for (const [unit, list] of Object.entries(def?.units || {})) {
        for (const f of list || []) {
          const fam = /^(10-K|10-Q|20-F|40-F|6-K|8-K)/.exec(f.form || "")?.[1] || "other";
          out.forms[fam] = (out.forms[fam] || 0) + 1;
          if (!keepA || !UNITS.has(unit) || !(keepI ? INTERIM_FORM : ANNUAL_FORM).test(f.form || "")) continue;
          const units = ((out.facts[ns] ||= {})[tag] ||= {});
          (units[unit] ||= []).push({ start: f.start || null, end: f.end, val: f.val, accn: f.accn, fp: f.fp || null, form: f.form, filed: f.filed });
        }
      }
    }
  }
  return out;
}

// returns the slimmed facts, or {cik, missing: true} when SEC has no XBRL facts for the company
export async function companyFacts(db, cik, spec, ticker) {
  const hash = crypto.createHash("sha256").update(JSON.stringify({ a: [...(spec.annual || [])].sort(), i: [...(spec.interim || [])].sort() })).digest("hex").slice(0, 12);
  return cached(db, `dq:facts:${cik10(cik)}:${hash}`, "dq:companyfacts", ticker, async () => {
    const j = await secGet(factsUrl(cik));
    if (!j) return { cik: Number(cik), missing: true };
    return slimFacts(j, spec);
  });
}
