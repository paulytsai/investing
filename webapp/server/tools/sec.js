// SEC EDGAR, read directly: the fallback behind the Edgar Tools connector (edgar.js). It rebuilds the payloads the page
// reads from sec.gov's public endpoints:
//   material_events  -> company_tickers.json (ticker -> CIK) + data.sec.gov submissions (8-K items as filed)
//   filing_section   -> the filing's index page, then the press-release exhibit (EX-99.1, else the first EX-99) or the
//                       primary 8-K document, parsed into tables_html (each <table>, stripped to text cells with
//                       colspan/rowspan) and plain-text prose
// SEC fair access: every request carries a User-Agent (SEC_USER_AGENT, else a generic one that names no person) and
// requests are spaced so this process sends at most 8 per second. www.sec.gov refuses a User-Agent without a contact
// address, so filing documents need SEC_USER_AGENT set ("<app name> <contact email>").
import crypto from "node:crypto";
import { config } from "../config.js";
import { nowIso } from "../db.js";
import { fail, ApiError } from "../http.js";

export const DEFAULT_SEC_UA = "company-model-webapp/0.1 (self-hosted; set SEC_USER_AGENT)";
export const secUserAgent = () => config.secUserAgent || DEFAULT_SEC_UA;

const H = 3600e3, D = 24 * H;
export const SEC_TTL = { tickers: 7 * D, submissions: 6 * H, filing: 365 * D };
export const STALE_OK_MS = 7 * D; // a cached copy this far past expiry still beats an error

// test hooks: request spacing and retry backoff
export const secInternals = { gapMs: 125, backoffMs: 1500, timeoutMs: 30000, maxBytes: 15e6 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
export const cik10 = (cik) => String(cik).padStart(10, "0");
export const normTicker = (t) => String(t || "").trim().toUpperCase().replace(/\./g, "-");

// ---------- throttle: request starts at least gapMs apart, process-wide ----------
let nextSlot = 0;
export async function secThrottle() {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + secInternals.gapMs;
  if (at > now) await sleep(at - now);
}

// ---------- GET from sec.gov (null on 404) ----------
const secError = (status, code, message, extra) => new ApiError(status, code, message, extra);
export async function secGet(url, { json = false, stats } = {}) {
  for (let attempt = 0; ; attempt++) {
    await secThrottle();
    let res;
    try {
      res = await fetch(url, {
        headers: { "user-agent": secUserAgent(), accept: json ? "application/json" : "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8" },
        signal: AbortSignal.timeout(secInternals.timeoutMs),
      });
    } catch (e) {
      if (attempt === 0) { await sleep(secInternals.backoffMs); continue; }
      throw secError(502, "tool_error", e?.name === "TimeoutError" ? "SEC EDGAR didn't answer in time." : "Couldn't reach SEC EDGAR.");
    }
    if (stats) stats.fetches = (stats.fetches || 0) + 1;
    if (res.status === 429 || res.status === 503) {
      await res.body?.cancel().catch(() => {});
      if (attempt === 0) { const ra = +res.headers.get("retry-after"); await sleep(ra > 0 && ra < 10 ? ra * 1000 : secInternals.backoffMs); continue; }
      throw secError(503, "rate_limited", "SEC EDGAR is busy. Retrying.", { retryable: true, retryAfterMs: 2000 });
    }
    if (res.status === 404) { await res.body?.cancel().catch(() => {}); return null; }
    if (res.status === 403) {
      const t = await res.text().catch(() => "");
      if (/Undeclared Automated Tool/i.test(t)) throw secError(502, "tool_error", "SEC EDGAR refused the request: set SEC_USER_AGENT on the server to the app's name and a contact email (sec.gov requires one).");
      // SEC also answers an undeclared User-Agent this way
      if (/Rate Threshold/i.test(t)) throw secError(503, "rate_limited", "SEC EDGAR is limiting requests from this server. Try again in about 10 minutes" + (config.secUserAgent ? "." : ", and set SEC_USER_AGENT on the server to the app's name and a contact email."));
      throw secError(502, "tool_error", "SEC EDGAR refused the request (403).");
    }
    if (!res.ok) { await res.body?.cancel().catch(() => {}); throw secError(502, "tool_error", `SEC EDGAR returned ${res.status}.`); }
    const text = await res.text();
    if (text.length > secInternals.maxBytes) throw secError(502, "tool_error", "The SEC document is too large to read here.");
    if (!json) return text;
    try { return JSON.parse(text); } catch (e) { throw secError(502, "tool_error", "SEC EDGAR returned something that isn't JSON."); }
  }
}

// ---------- cache (sec_cache: key, kind, ticker, body, bytes, fetched_at, expires_at_ms) ----------
export function cacheRow(db, key) { return db.get("SELECT body, expires_at_ms FROM sec_cache WHERE key = ?", key); }
export function cachePut(db, key, kind, ticker, value, ttlMs) {
  const body = JSON.stringify(value);
  db.run(`INSERT INTO sec_cache (key, kind, ticker, body, bytes, fetched_at, expires_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (key) DO UPDATE SET kind = excluded.kind, ticker = excluded.ticker, body = excluded.body, bytes = excluded.bytes,
          fetched_at = excluded.fetched_at, expires_at_ms = excluded.expires_at_ms`,
    key, kind, ticker || null, body, Buffer.byteLength(body), nowIso(), Date.now() + ttlMs);
}
// fresh cache -> value; else load() and store; on error a copy up to STALE_OK_MS past expiry
async function cached(db, { key, kind, ticker, ttlMs, stats }, load) {
  const row = cacheRow(db, key), now = Date.now();
  if (row && row.expires_at_ms > now) return JSON.parse(row.body);
  try {
    const value = await load();
    cachePut(db, key, kind, ticker, value, ttlMs);
    return value;
  } catch (e) {
    if (row && row.expires_at_ms > now - STALE_OK_MS) {
      if (stats) stats.stale = true;
      db.logError("sec", e.code || "fetch", e.message, { ticker, kind, stale: true });
      return JSON.parse(row.body);
    }
    throw e;
  }
}
// rows this module and edgar.js write; drop them a week after they expired (call from the daily job)
export function pruneSecCache(db) {
  db.run("DELETE FROM sec_cache WHERE (kind LIKE 'sec:%' OR kind LIKE 'edgar:%') AND expires_at_ms < ?", Date.now() - STALE_OK_MS);
}

// ---------- ticker -> CIK ----------
const tickerMemo = new WeakMap(); // db -> {map, until}
export async function lookupCompany(db, company, stats) {
  const s = String(company).trim();
  if (/^\d{1,10}$/.test(s)) return { cik: Number(s), name: null, ticker: null };
  let memo = tickerMemo.get(db);
  if (!memo || memo.until < Date.now()) {
    const map = await cached(db, { key: sha256("sec:company_tickers"), kind: "sec:company_tickers", ttlMs: SEC_TTL.tickers, stats }, async () => {
      const j = await secGet("https://www.sec.gov/files/company_tickers.json", { json: true, stats });
      if (!j || typeof j !== "object") throw secError(502, "tool_error", "SEC's company list (company_tickers.json) is missing.");
      const m = {};
      for (const v of Object.values(j)) {
        const t = v && normTicker(v.ticker);
        if (t && v.cik_str && !(t in m)) m[t] = [Number(v.cik_str), String(v.title || "")];
      }
      return m;
    });
    memo = { map, until: Date.now() + 10 * 60e3 };
    tickerMemo.set(db, memo);
  }
  const hit = memo.map[normTicker(s)];
  if (!hit) fail(502, "tool_error", `SEC EDGAR lists no company with the ticker ${s.toUpperCase()}.`);
  return { cik: hit[0], name: hit[1], ticker: s.toUpperCase() };
}

// ---------- submissions: the company's 8-K / 6-K filings, compacted ----------
const EVENT_FORMS = /^(8-K|6-K)(\/A)?$/;
function compactColumns(c) {
  const out = [];
  const n = (c.accessionNumber || []).length;
  for (let i = 0; i < n; i++) {
    const form = c.form?.[i] || "";
    if (!EVENT_FORMS.test(form)) continue;
    out.push([c.accessionNumber[i], c.filingDate?.[i] || "", form, c.items?.[i] || "", c.primaryDocument?.[i] || "", c.primaryDocDescription?.[i] || "", c.acceptanceDateTime?.[i] || ""]);
  }
  return out;
}
const oldestDate = (c) => (c.filingDate || []).reduce((m, d) => (d && d < m ? d : m), "9999-12-31");

async function submissions(db, cik, since, stats) {
  const sub = await cached(db, { key: sha256("sec:submissions|" + cik), kind: "sec:submissions", ttlMs: SEC_TTL.submissions, stats }, async () => {
    const j = await secGet(`https://data.sec.gov/submissions/CIK${cik10(cik)}.json`, { json: true, stats });
    if (!j) throw secError(502, "tool_error", `SEC EDGAR has no filings for CIK ${cik}.`);
    const recent = j.filings?.recent || {};
    return {
      cik: Number(j.cik || cik), name: j.name || "", tickers: j.tickers || [],
      oldest: oldestDate(recent), rows: compactColumns(recent),
      files: (j.filings?.files || []).map((f) => ({ name: f.name, from: f.filingFrom, to: f.filingTo })),
    };
  });
  let rows = sub.rows;
  // a busy filer's "recent" list may not reach back to `since`: read the older pages that overlap the window
  if (since && since < sub.oldest) {
    const pages = sub.files.filter((f) => f.to >= since && /^CIK\d{10}-submissions-\d{3}\.json$/.test(f.name)).slice(0, 3);
    for (const f of pages) {
      const more = await cached(db, { key: sha256("sec:submissions-page|" + f.name), kind: "sec:submissions", ttlMs: SEC_TTL.submissions, stats }, async () => {
        const j = await secGet("https://data.sec.gov/submissions/" + f.name, { json: true, stats });
        return j ? compactColumns(j) : [];
      });
      rows = rows.concat(more);
    }
  }
  return { ...sub, rows };
}

export const ITEM_NAMES = {
  "1.01": "Entry into a Material Definitive Agreement",
  "1.02": "Termination of a Material Definitive Agreement",
  "1.03": "Bankruptcy or Receivership",
  "1.04": "Mine Safety - Reporting of Shutdowns and Patterns of Violations",
  "1.05": "Material Cybersecurity Incidents",
  "2.01": "Completion of Acquisition or Disposition of Assets",
  "2.02": "Results of Operations and Financial Condition",
  "2.03": "Creation of a Direct Financial Obligation or an Obligation under an Off-Balance Sheet Arrangement of a Registrant",
  "2.04": "Triggering Events That Accelerate or Increase a Direct Financial Obligation or an Obligation under an Off-Balance Sheet Arrangement",
  "2.05": "Costs Associated with Exit or Disposal Activities",
  "2.06": "Material Impairments",
  "3.01": "Notice of Delisting or Failure to Satisfy a Continued Listing Rule or Standard; Transfer of Listing",
  "3.02": "Unregistered Sales of Equity Securities",
  "3.03": "Material Modification to Rights of Security Holders",
  "4.01": "Changes in Registrant's Certifying Accountant",
  "4.02": "Non-Reliance on Previously Issued Financial Statements or a Related Audit Report or Completed Interim Review",
  "5.01": "Changes in Control of Registrant",
  "5.02": "Departure of Directors or Certain Officers; Election of Directors; Appointment of Certain Officers; Compensatory Arrangements of Certain Officers",
  "5.03": "Amendments to Articles of Incorporation or Bylaws; Change in Fiscal Year",
  "5.04": "Temporary Suspension of Trading Under Registrant's Employee Benefit Plans",
  "5.05": "Amendment to Registrant's Code of Ethics, or Waiver of a Provision of the Code of Ethics",
  "5.06": "Change in Shell Company Status",
  "5.07": "Submission of Matters to a Vote of Security Holders",
  "5.08": "Shareholder Director Nominations",
  "6.01": "ABS Informational and Computational Material",
  "6.02": "Change of Servicer or Trustee",
  "6.03": "Change in Credit Enhancement or Other External Support",
  "6.04": "Failure to Make a Required Distribution",
  "6.05": "Securities Act Updating Disclosure",
  "7.01": "Regulation FD Disclosure",
  "8.01": "Other Events",
  "9.01": "Financial Statements and Exhibits",
};

const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const accPath = (cik, acc) => `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replace(/-/g, "")}/`;

// material_events {company, item?, since?, until?, limit?} in the connector's per-company shape
export async function secMaterialEvents(db, input, stats = {}) {
  const co = await lookupCompany(db, input.company, stats);
  const until = input.until || today();
  const since = input.since || new Date(Date.parse(until) - 90 * 864e5).toISOString().slice(0, 10);
  const sub = await submissions(db, co.cik, since, stats);
  const item = input.item || null;
  const seen = new Set();
  const hits = sub.rows
    .filter(([acc, date, form, items]) => {
      if (seen.has(acc) || !date || date < since || date > until) return false;
      seen.add(acc);
      if (!item) return true;
      return form.startsWith("8-K") && items.split(",").map((x) => x.trim()).includes(item);
    })
    .sort((a, b) => (b[1] + b[6]).localeCompare(a[1] + a[6]));
  const limit = input.limit || 10;
  const cik = sub.cik || co.cik;
  const results = hits.slice(0, limit).map(([acc, date, form, items, , desc]) => {
    const list = items ? items.split(",").map((x) => x.trim()).filter(Boolean) : [];
    return {
      filing_date: date, accession_number: acc, form, ...(form.endsWith("/A") ? { is_amendment: true } : {}),
      items: list, item_names: list.map((x) => ITEM_NAMES[x] || "Item " + x),
      sec_url: `${accPath(cik, acc)}${acc}-index.htm`, description: desc || form,
    };
  });
  return {
    company: { cik, name: sub.name || co.name || "", ticker: co.ticker || sub.tickers?.[0] || null },
    results, total: hits.length, showing: results.length,
    coverage: {
      source: "SEC EDGAR submissions API, read directly (items as filed)", window_days: daysBetween(since, until) + 1, since, until,
      events_in_window: hits.length, ...(item ? { item_filter: item } : {}), latest_event_date: hits[0]?.[1] || null,
    },
    data_quality: { as_of: today(), freshness_lag_days: 0, is_stale: !!stats.stale },
  };
}

// ---------- HTML -> tables + prose ----------
const ENT = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ", zwsp: "", shy: "", zwnj: "", zwj: "",
  mdash: "—", ndash: "–", minus: "−", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", sbquo: "‚", bdquo: "„", prime: "′", Prime: "″",
  bull: "•", middot: "·", hellip: "…", copy: "©", reg: "®", trade: "™", dollar: "$", percnt: "%", cent: "¢", euro: "€", pound: "£",
  yen: "¥", sect: "§", para: "¶", deg: "°", times: "×", divide: "÷", plusmn: "±", frac12: "½", frac14: "¼", frac34: "¾",
  sup1: "¹", sup2: "²", sup3: "³", laquo: "«", raquo: "»", iexcl: "¡", iquest: "¿", dagger: "†", Dagger: "‡", check: "✓",
  eacute: "é", Eacute: "É", egrave: "è", agrave: "à", aacute: "á", oacute: "ó", uacute: "ú", iacute: "í", ntilde: "ñ", ccedil: "ç",
  uuml: "ü", ouml: "ö", auml: "ä", Uuml: "Ü", Ouml: "Ö", Auml: "Ä", szlig: "ß", ocirc: "ô", ecirc: "ê", acirc: "â", rarr: "→", larr: "←",
  le: "≤", ge: "≥", ne: "≠", asymp: "≈", infin: "∞", micro: "µ", ordm: "º", ordf: "ª", squ: "□", cir: "○", loz: "◊", diams: "♦",
};
export function decodeEntities(s) {
  return s.replace(/&(#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[A-Za-z][A-Za-z0-9]{1,15});/g, (m, e) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (cp === 160) return " ";
      return cp > 0 && cp < 0x110000 && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : "";
    }
    const v = ENT[e];
    return v === undefined ? m : v;
  });
}
const escHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const squash = (s) => s.replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, " ").replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\s+/g, " ").trim();

// remove the SGML wrapper, comments and everything that is never shown (scripts, styles, head, inline-XBRL header)
function preclean(html) {
  let h = String(html);
  const start = h.search(/<html[\s>]/i);
  if (start > 0) h = h.slice(start);
  const end = h.search(/<\/html\s*>/i);
  if (end > 0) h = h.slice(0, end);
  return h
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, " ")
    .replace(/<![^>]*>|<\?[^>]*>/g, " ")
    .replace(/<(script|style|head|title|ix:header|xbrl)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/^\s*<\/?(DOCUMENT|TYPE|SEQUENCE|FILENAME|DESCRIPTION|TEXT|PAGE)>[^\n<]*$/gm, " ");
}
function tokenize(h) {
  const out = [], re = /<(\/?)([A-Za-z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let last = 0, m;
  while ((m = re.exec(h))) {
    if (m.index > last) out.push({ t: "text", v: h.slice(last, m.index) });
    out.push({ t: m[1] ? "close" : "open", n: m[2].toLowerCase(), a: m[3] || "" });
    last = re.lastIndex;
  }
  if (last < h.length) out.push({ t: "text", v: h.slice(last) });
  return out;
}
const BLOCK = new Set(["p", "div", "br", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "table", "hr", "center", "blockquote", "pre", "section", "article", "header", "footer", "dd", "dt", "dl", "caption", "body", "html"]);
const span = (a, name) => { const m = new RegExp("\\b" + name + "\\s*=\\s*[\"']?(\\d+)", "i").exec(a); const v = m ? +m[1] : 1; return v > 1 && v < 100 ? v : 1; };

// one <table> from toks[start] to its matching </table>: rows of cells {tag, colspan, rowspan, text}
function readTable(toks, start) {
  const rows = [];
  let depth = 1, row = null, cell = null, i = start + 1;
  const endCell = () => { if (cell) { cell.text = squash(cell.buf); delete cell.buf; cell = null; } };
  const endRow = () => { endCell(); if (row) { rows.push(row); row = null; } };
  for (; i < toks.length; i++) {
    const k = toks[i];
    if (k.t === "text") { if (cell) cell.buf += decodeEntities(k.v); continue; }
    if (k.n === "table") {
      if (k.t === "open") { depth++; if (cell) cell.buf += " "; continue; }
      if (--depth === 0) break;
      if (cell) cell.buf += " ";
      continue;
    }
    if (depth > 1) { if (cell && (BLOCK.has(k.n) || k.n === "td" || k.n === "th")) cell.buf += " "; continue; } // a nested table reads as text
    if (k.n === "tr") { if (k.t === "open") { endRow(); row = { cells: [] }; } else endRow(); continue; }
    if (k.n === "td" || k.n === "th") {
      if (k.t === "open") { endCell(); if (!row) row = { cells: [] }; cell = { tag: k.n, colspan: span(k.a, "colspan"), rowspan: span(k.a, "rowspan"), buf: "" }; row.cells.push(cell); }
      else endCell();
      continue;
    }
    if (cell && BLOCK.has(k.n)) cell.buf += " ";
  }
  endRow();
  return { end: i, rows };
}
const cellHtml = (c) => `<${c.tag}${c.colspan > 1 ? ` colspan="${c.colspan}"` : ""}${c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : ""}>${escHtml(c.text)}</${c.tag}>`;
// a figure cell: has a digit, is short and mostly not words; footnote and list markers ("(1)", "2.", "3") don't count
const isFigure = (t) => /\d/.test(t) && t.length <= 40 && (t.match(/[A-Za-z]/g) || []).length <= 12 && !/^[([]?\d[)\].]?$/.test(t);

class TextBuf {
  constructor() { this.parts = []; }
  text(s) { this.parts.push(s); }
  nl() { this.parts.push("\n"); }
  block(s) { this.parts.push("\n", s, "\n"); }
  tail(n) {
    let s = "";
    for (let i = this.parts.length - 1; i >= 0 && s.length < 2 * n; i--) s = this.parts[i] + s;
    return squash(s).slice(-n);
  }
  toString() {
    return this.parts.join("")
      .replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, " ").replace(/[\u200b-\u200d\ufeff]/g, "")
      .split("\n").map((l) => l.replace(/[ \t\f\v\r]+/g, " ").trim()).join("\n")
      .replace(/\n{3,}/g, "\n\n").trim();
  }
}

// parse an HTML document into prose (plain text, data tables replaced by "[table]") and data tables. Tables without
// figures (layout tables: bullets, letterheads, footnotes) are read as prose instead.
export function parseHtmlDoc(html, { keepTablesInProse = false } = {}) {
  const toks = tokenize(preclean(html));
  const prose = new TextBuf(), tables = [];
  for (let i = 0; i < toks.length; i++) {
    const k = toks[i];
    if (k.t === "open" && k.n === "table") {
      const { end, rows } = readTable(toks, i);
      i = end;
      const kept = rows.filter((r) => r.cells.some((c) => c.text));
      if (!kept.length) continue;
      const figures = kept.reduce((n, r) => n + r.cells.filter((c) => isFigure(c.text)).length, 0);
      const lines = kept.map((r) => r.cells.map((c) => c.text).filter(Boolean).join(figures < 2 ? " " : " | "));
      if (figures < 2 || keepTablesInProse) { prose.block(lines.join("\n")); continue; }
      tables.push({
        html: "<table>" + kept.map((r) => "<tr>" + r.cells.map(cellHtml).join("") + "</tr>").join("") + "</table>",
        head: lines.slice(0, 4).join(" | ").slice(0, 400),
        context: prose.tail(400).split("[table]").pop().trim(), // the text between the previous table and this one
        label: (kept.flatMap((r) => r.cells).find((c) => c.text)?.text || "").slice(0, 80),
        text: lines.join("\n"),
      });
      prose.block("[table]");
      continue;
    }
    if (k.t === "text") prose.text(decodeEntities(k.v));
    else if (BLOCK.has(k.n)) prose.nl();
  }
  return { prose: prose.toString(), tables };
}

const OUTLOOK = /\b(outlook|guidance|forecast)\b/i;
// the connector's table classes: the table's own title rows first, then the text just before it, then its lines
const CLASS_RULES = [
  ["outlook", OUTLOOK],
  ["cashflow", /cash flows?\b/],
  ["balance", /balance sheets?|financial (position|condition)/],
  ["recon", /non-gaap|reconciliation|as adjusted|constant currency/],
  ["segment", /segment|geograph|divisional|by region|by category|by product|channel/],
  ["income", /statements? of (comprehensive )?(income|operations|earnings)|income statements?|earnings before interest/],
];
export function classifyTable(t) {
  for (const s of [t.head.toLowerCase(), t.context.slice(-200).toLowerCase()]) for (const [cls, re] of CLASS_RULES) if (re.test(s)) return cls;
  const body = t.text.toLowerCase();
  if (/operating activities/.test(body) && /(investing|financing) activities/.test(body)) return "cashflow";
  if (/total assets/.test(body) && /total liabilities/.test(body)) return "balance";
  if (/revenue|net sales/.test(body) && /net (income|earnings|loss)/.test(body)) return "income";
  return "other";
}
const CORE = new Set(["income", "balance", "cashflow"]);
// the connector's `tables` scopes, applied to the classified tables
export function selectTables(tables, scope) {
  if (scope === "none") return [];
  if (scope === "all") return tables;
  if (scope === "core") return tables.filter((t) => CORE.has(t.cls));
  if (scope === "outlook") {
    const hit = tables.filter((t) => t.cls === "outlook" || OUTLOOK.test(t.context.slice(-300)) || OUTLOOK.test(t.head) || /\b(outlook|guidance)\b/i.test(t.text));
    return hit.length ? hit : tables; // can't tell which table holds the outlook: send them all
  }
  return tables.filter((t) => t.cls === scope);
}

// ---------- filing index + documents ----------
// the filing's index page: form, filing date, company CIK and the documents with their types
async function filingIndex(acc, stats) {
  const html = await secGet(`${accPath(Number(acc.slice(0, 10)), acc)}${acc}-index.htm`, { stats });
  if (!html) fail(502, "tool_error", `Filing ${acc} isn't on SEC EDGAR.`);
  const info = (label) => { const m = new RegExp(`infoHead">\\s*${label}\\s*</div>\\s*<div class="info">([^<]*)<`, "i").exec(html); return m ? m[1].trim() : ""; };
  const form = (/id="formName">\s*<strong>\s*Form\s+([^<]+?)\s*<\/strong>/i.exec(html) || [])[1] || "";
  const cik = +((/CIK=0*(\d+)/i.exec(html) || [])[1] || 0) || Number(acc.slice(0, 10));
  const docs = [];
  const tableM = /summary="Document Format Files"[\s\S]*?<\/table>/i.exec(html);
  for (const row of (tableM ? tableM[0] : "").match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    if (cells.length < 4) continue;
    const href = (/href="([^"]+)"/i.exec(cells[2]) || [])[1];
    if (!href) continue;
    const path = decodeEntities(href).replace(/^\/ix\?doc=/, "");
    docs.push({ seq: squash(cells[0].replace(/<[^>]*>/g, "")), description: squash(decodeEntities(cells[1].replace(/<[^>]*>/g, ""))), url: new URL(path, "https://www.sec.gov").href, name: path.split("/").pop(), type: squash(cells[3].replace(/<[^>]*>/g, "")).toUpperCase() });
  }
  return { form: form.trim(), filingDate: info("Filing Date"), cik, docs };
}
const isText = (d) => /\.(htm|html|txt)$/i.test(d.name);

// the parsed press-release exhibit (or primary document) of one filing, cached for a year: filings never change
async function filingDoc(db, acc, which, stats) {
  return cached(db, { key: sha256(`sec:filing|${acc}|${which}`), kind: "sec:filing", ttlMs: SEC_TTL.filing, stats }, async () => {
    const idx = await filingIndex(acc, stats);
    let doc;
    if (which === "release") {
      const ex = idx.docs.filter((d) => /^EX-99/.test(d.type) && isText(d));
      doc = ex.find((d) => /^EX-99\.1$|^EX-99\.01$|^EX-99$/.test(d.type)) || ex[0];
      if (!doc) fail(502, "tool_error", "This filing has no press-release exhibit (EX-99).");
    } else {
      doc = idx.docs.find((d) => d.type === idx.form && isText(d)) || idx.docs.find((d) => d.seq === "1" && isText(d)) || idx.docs.find(isText);
      if (!doc) fail(502, "tool_error", "Couldn't find the main document of this filing.");
    }
    const raw = await secGet(doc.url, { stats });
    if (!raw) fail(502, "tool_error", `${doc.name} isn't on SEC EDGAR.`);
    const isTxt = /\.txt$/i.test(doc.name) && !/<html[\s>]/i.test(raw);
    const parsed = isTxt ? { prose: squashLines(raw), tables: [] } : parseHtmlDoc(raw, { keepTablesInProse: which !== "release" });
    return {
      form: idx.form, filing_date: idx.filingDate, cik: idx.cik, type: doc.type, filename: doc.name,
      prose: parsed.prose,
      tables: parsed.tables.map((t) => ({ html: t.html, head: t.head, context: t.context, label: t.label, text: t.text, cls: classifyTable(t) })),
    };
  });
}
const squashLines = (s) => s.replace(/^\s*<\/?(DOCUMENT|TYPE|SEQUENCE|FILENAME|DESCRIPTION|TEXT|PAGE)>[^\n]*$/gim, "").split("\n").map((l) => l.replace(/[ \t\f\v\r\u00a0]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
const words = (s) => (s.match(/\S+/g) || []).length;
const ymd = (d) => String(d || "").replace(/-/g, "");

// filing_section {accession, section, tables?, prose?} in the connector's shape
export async function secFilingSection(db, input, stats = {}) {
  const acc = input.accession, section = input.section;
  const dq = (d) => ({ as_of: ymd(d.filing_date), freshness_lag_days: 0, is_stale: !!stats.stale, source_accession: acc });
  if (section === "earnings_release" || section === "press_release") {
    const d = await filingDoc(db, acc, "release", stats);
    const tablesScope = input.tables || "core", proseScope = input.prose || "full";
    const picked = selectTables(d.tables, tablesScope);
    const content = proseScope === "none" ? "" : d.prose;
    return {
      section, title: d.type, exhibit_type: d.type, exhibit_filename: d.filename, form: d.form, accession_number: acc, filing_date: ymd(d.filing_date),
      content, word_count: words(content), char_count: content.length, prose_scope: proseScope, tables_scope: tablesScope, tables_omitted: tablesScope === "none" ? d.tables.length : 0,
      tables_available: d.tables.map((t) => ({ class: t.cls, label: t.label, full: false })),
      tables_html: picked.map((t) => t.html),
      data_quality: { ...dq(d), caveats: [`Read directly from SEC EDGAR: ${picked.length} of the exhibit's ${d.tables.length} financial table(s) are in tables_html as stripped HTML (text cells with colspan/rowspan); "[table]" marks where each sat in the prose.`] },
    };
  }
  const m = /^eight_k_item:(\d{1,2}\.\d{2})$/.exec(section);
  if (!m) fail(400, "bad_parameter", "Unsupported section.");
  const d = await filingDoc(db, acc, "primary", stats);
  const content = extractItem(d.prose, m[1]);
  if (content === null) fail(502, "tool_error", `Item ${m[1]} isn't in this filing.`);
  return {
    section, title: ITEM_NAMES[m[1]] || "Item " + m[1], item_number: m[1], form: d.form, accession_number: acc, filing_date: ymd(d.filing_date),
    content, word_count: words(content), char_count: content.length, data_quality: dq(d),
  };
}

// the text of one 8-K item: from its heading to the next item heading or the signatures
export function extractItem(text, item) {
  const lines = text.split("\n");
  const head = /^item\s*(\d{1,2})\s*\.\s*(\d{2})\b/i;
  const num = (l) => { const x = head.exec(l); return x ? `${+x[1]}.${x[2]}` : null; };
  const want = `${+item.split(".")[0]}.${item.split(".")[1]}`;
  const start = lines.findIndex((l) => num(l) === want);
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const n = num(lines[i]);
    if ((n && n !== want) || /^signatures?\b/i.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start, end).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
