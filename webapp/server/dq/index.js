// Data quality: cross-checks FMP's annual statements against SEC XBRL company facts, and FMP's segment revenue
// against total revenue, and keeps the discrepancies in a queue (dq_flags) for the admin.
//
// The SEC side is a port of the Python prototype (sec_vs_fmp.py): us-gaap facts from 10-K / 10-K/A filings only
// (fp = FY), one value per period with the latest filing winning, fiscal years taken from ~1-year durations
// (340-380 days) of the revenue / net income tags and matched to FMP by period end date (within 7 days), the same tag
// fallbacks per line, and per-share lines adjusted for stock splits found from EPS restated between filings.
//
// A flag's fingerprint is sha256(ticker|kind|field|period|fmp_value|sec_value): re-running inserts nothing new, a flag
// the admin closed (fixed / wontfix) stays closed unless the values change, and an open flag whose values now agree
// (or have changed) is closed automatically with a note.
import crypto from "node:crypto";
import { Hono } from "hono";
import { requireAdmin } from "../auth.js";
import { nowIso } from "../db.js";
import { fail, rateLimit } from "../http.js";
import { callFmp } from "../tools/fmp.js";
import { lookupCik, companyFacts, pruneSecCache } from "./sec_facts.js";

export const YEARS = 5;            // fiscal years compared per ticker (the latest in FMP)
export const REL_TOL = 0.01;       // a mismatch is more than 1% of the SEC value ...
export const FLOORS = { money: 0.5e6, eps: 0.01, shares: 0.5e6 }; // ... and more than this in absolute terms
export const SEGMENT_TOL = 0.02;   // segment members must sum to total revenue within 2%
const NIGHTLY_MAX = 50;
const STATUSES = ["open", "acknowledged", "fixed", "wontfix"];
const OVERRIDE_KINDS = ["geo_label", "product_label"];
const TICKER = /^[A-Z0-9][A-Z0-9.\-]{0,11}$/;
const DAY = 864e5;

const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
// a stable text form for the fingerprint and the value columns (split-adjusted EPS can carry float noise)
const canon = (v) => (v == null ? "" : Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6));

// ---------- SEC line rules (each gets g(tag) -> {v, f} | null and returns {v, tag, src: [fact]} | null) ----------
const RULE_TAGS = new Set(); // every us-gaap tag a rule can read (the SEC fetch keeps only these)
const T = (...tags) => {
  tags.forEach((t) => RULE_TAGS.add(t));
  return (g) => { for (const t of tags) { const x = g(t); if (x) return { v: x.v, tag: t, src: [x.f] }; } return null; };
};
const MAX = (...tags) => {
  tags.forEach((t) => RULE_TAGS.add(t));
  return (g) => {
    let best = null;
    for (const t of tags) { const x = g(t); if (x && (!best || Math.abs(x.v) > Math.abs(best.v))) best = { v: x.v, tag: t, src: [x.f] }; }
    return best;
  };
};
const OR = (...rules) => (g) => { for (const r of rules) { const x = r(g); if (x) return x; } return null; };
const DIFF = (a, b) => (g) => { const x = a(g), y = b(g); return x && y ? { v: x.v - y.v, tag: `${x.tag}-${y.tag}`, src: [...x.src, ...y.src] } : null; };
// sum of sub-rules; the first `need` must be present, the rest are optional
const SUM = (rules, need = 1) => (g) => {
  let v = 0; const tags = [], src = [];
  for (let i = 0; i < rules.length; i++) {
    const x = rules[i](g);
    if (!x) { if (i < need) return null; continue; }
    v += x.v; tags.push(x.tag); src.push(...x.src);
  }
  return { v, tag: tags.join("+"), src };
};
const ZERO = (name) => () => ({ v: 0, tag: name, src: [] });

// revenue: the largest of the variants (companies tag subsets such as product revenue next to the total; utilities
// tag the total as RegulatedAndUnregulatedOperatingRevenue). FMP may also match one variant: oil companies tag
// "total revenues and other income" as Revenues, and FMP shows the contract-revenue line (CVX).
const REV_TAGS = ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "SalesRevenueGoodsNet",
  "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueServicesNet", "RevenuesNetOfInterestExpense", "RegulatedAndUnregulatedOperatingRevenue"];
const REV = MAX(...REV_TAGS);
// banks: SEC "Revenues" is net revenue; FMP's revenue is roughly gross (interest income + noninterest income, within
// a few percent: FMP nets some items in some years)
const BANK_GROSS_REV = SUM([T("InterestAndDividendIncomeOperating", "InterestIncomeOperating"), T("NoninterestIncome")], 2);
const COGS = T("CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold", "CostOfServices", "CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization");
const GP = OR(T("GrossProfit"), DIFF(REV, COGS));
const GP_DERIVED = DIFF(REV, COGS);
const RND = T("ResearchAndDevelopmentExpense", "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost", "TechnologyAndDevelopmentExpense");
const SGA = OR(T("SellingGeneralAndAdministrativeExpense"),
  SUM([T("GeneralAndAdministrativeExpense"), T("SellingAndMarketingExpense", "MarketingExpense", "MarketingAndAdvertisingExpense", "SellingExpense")], 2));
// Nike tags no operating income: gross profit - SG&A (- R&D)
const OPINC_DERIVED = DIFF(DIFF(GP, SGA), OR(RND, ZERO("noRnD")));
const NI = T("NetIncomeLoss", "NetIncomeLossAvailableToCommonStockholdersBasic", "ProfitLoss");
const EPSD = T("EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted");
const SHD = T("WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfShareOutstandingBasicAndDiluted");
const ASSETS = T("Assets");
const LIAB = T("Liabilities"); // not every company tags a total (Nike, Coca-Cola don't); equity is checked as well
const EQUITY = T("StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest");
const CASH = T("CashAndCashEquivalentsAtCarryingValue", "Cash");
// the cash-flow statement's total: what FMP shows as cash for banks (cash and due from banks + deposits with banks),
// and the only untagged-by-segment cash figure for Berkshire; it includes restricted cash, hence the looser match.
// Less the restricted cash it is the balance-sheet line for companies that stopped tagging that (Chevron from 2024).
const CASH_RESTRICTED = T("CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents");
const CASH_EX_RESTRICTED = DIFF(CASH_RESTRICTED, SUM([T("RestrictedCashCurrent", "RestrictedCashAndCashEquivalentsAtCarryingValue"),
  T("RestrictedCashNoncurrent", "RestrictedCashAndCashEquivalentsNoncurrent")], 1));
const BANK_CASH = OR(SUM([T("CashAndDueFromBanks"), T("InterestBearingDepositsInBanks")], 2), T("CashAndDueFromBanks"));
const CFO = T("NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations");
const CAPEX = T("PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets", "PaymentsForCapitalImprovements", "PaymentsToAcquireOtherPropertyPlantAndEquipment");

const neg = (v) => (isNum(v) ? -v : v);
// field, label, D(uration) | I(nstant), SEC definitions, FMP value from {i, b, c} rows, per-share kind.
// sec: FMP passes when it matches any definition that has a value (within REL_TOL, or the definition's own tol), so a
// company-type convention (bank revenue, cash with restricted cash) isn't reported as an FMP error; otherwise the
// first definition with a value is the reference the flag reports. passOnly definitions (gross profit and operating
// income derived from other lines, for companies that report neither) can confirm FMP but never raise a flag: FMP's
// own construction of a line the company doesn't report is a definition, not an error.
export const LINES = [
  { field: "revenue", label: "Revenue", kind: "D", sec: [REV, ...REV_TAGS.map((t) => T(t)), { rule: BANK_GROSS_REV, tol: 0.03 }], fmp: (r) => r.i?.revenue },
  { field: "gross_profit", label: "Gross profit", kind: "D", sec: [T("GrossProfit"), { rule: GP_DERIVED, passOnly: true }], fmp: (r) => r.i?.grossProfit },
  { field: "operating_income", label: "Operating income", kind: "D", sec: [T("OperatingIncomeLoss"), { rule: OPINC_DERIVED, passOnly: true }], fmp: (r) => r.i?.operatingIncome },
  { field: "net_income", label: "Net income", kind: "D", sec: [NI], fmp: (r) => r.i?.netIncome },
  { field: "eps_diluted", label: "Diluted EPS", kind: "D", sec: [EPSD], fmp: (r) => r.i?.epsDiluted ?? r.i?.epsdiluted, ps: "eps" },
  { field: "shares_diluted", label: "Diluted shares", kind: "D", sec: [SHD], fmp: (r) => r.i?.weightedAverageShsOutDil, ps: "shares" },
  { field: "total_assets", label: "Total assets", kind: "I", sec: [ASSETS], fmp: (r) => r.b?.totalAssets },
  { field: "total_liabilities", label: "Total liabilities", kind: "I", sec: [LIAB], fmp: (r) => r.b?.totalLiabilities },
  { field: "total_equity", label: "Stockholders' equity", kind: "I", sec: [EQUITY], fmp: (r) => r.b?.totalStockholdersEquity },
  { field: "cash", label: "Cash and equivalents", kind: "I", sec: [CASH, { rule: CASH_EX_RESTRICTED, tol: 0.03 }, { rule: CASH_RESTRICTED, tol: 0.03 }, BANK_CASH], fmp: (r) => r.b?.cashAndCashEquivalents },
  { field: "operating_cash_flow", label: "Operating cash flow", kind: "D", sec: [CFO], fmp: (r) => r.c?.operatingCashFlow ?? r.c?.netCashProvidedByOperatingActivities },
  { field: "capex", label: "Capital expenditure", kind: "D", sec: [CAPEX], fmp: (r) => neg(r.c?.capitalExpenditure ?? r.c?.investmentsInPropertyPlantAndEquipment) },
].map((l) => ({ ...l, sec: l.sec.map((d) => (typeof d === "function" ? { rule: d } : d)) }));
const STATEMENT_OF = { revenue: "i", gross_profit: "i", operating_income: "i", net_income: "i", eps_diluted: "i", shares_diluted: "i",
  total_assets: "b", total_liabilities: "b", total_equity: "b", cash: "b", operating_cash_flow: "c", capex: "c" };

const ANCHORS = ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "SalesRevenueGoodsNet", "NetIncomeLoss"];
const SPLIT_TAGS = ["EarningsPerShareDiluted", "EarningsPerShareBasic"];
export const SEC_SPEC = {
  annual: [...new Set([...RULE_TAGS, ...ANCHORS])].filter((t) => !SPLIT_TAGS.includes(t)).map((t) => "us-gaap:" + t),
  interim: [...SPLIT_TAGS.map((t) => "us-gaap:" + t), "dei:EntityCommonStockSharesOutstanding"],
};

// ---------- SEC fact store ----------
// tag -> Map("start|end" -> fact): 10-K / 10-K/A facts with fp FY, the latest filing winning per period
function factStore(facts) {
  const t = new Map();
  for (const [tag, units] of Object.entries(facts?.["us-gaap"] || {})) {
    for (const list of Object.values(units)) {
      for (const f of list) {
        if (!/^10-K(\/A)?$/.test(f.form) || f.fp !== "FY") continue;
        let m = t.get(tag);
        if (!m) t.set(tag, (m = new Map()));
        const k = (f.start || "") + "|" + f.end;
        const old = m.get(k);
        if (!old || f.filed > old.filed) m.set(k, f);
      }
    }
  }
  return t;
}
// fiscal years: end -> start, from ~1-year durations of the anchor tags
function fiscalYears(store) {
  const per = new Map();
  for (const tag of ANCHORS) {
    for (const f of store.get(tag)?.values() || []) {
      if (f.start) { const d = days(f.start, f.end); if (d >= 340 && d <= 380 && !per.has(f.end)) per.set(f.end, f.start); }
    }
  }
  return per;
}

// stock splits from per-share facts restated by a "nice" ratio between two filings: [ratio, lo_filed, hi_filed]
// (the split happened after lo and on or before hi), narrowed with the cover-page share count
const NICE = [1.5, 2, 3, 4, 5, 7, 8, 10, 15, 20];
export function detectSplits(facts) {
  const per = new Map();
  for (const tag of SPLIT_TAGS) {
    for (const f of facts?.["us-gaap"]?.[tag]?.["USD/shares"] || []) {
      if (!f.start || !f.val) continue;
      const k = tag + "|" + f.start + "|" + f.end;
      let m = per.get(k);
      if (!m) per.set(k, (m = new Map()));
      m.set(f.filed, f.val);
    }
  }
  const cands = [];
  for (const byFiled of per.values()) {
    const fl = [...byFiled.keys()].sort();
    for (let i = 0; i + 1 < fl.length; i++) {
      const va = byFiled.get(fl[i]), vb = byFiled.get(fl[i + 1]);
      if (va * vb <= 0) continue;
      const r = va / vb;
      for (const nr of NICE) if (Math.abs(r - nr) / nr < 0.03) cands.push([nr, fl[i], fl[i + 1]]);
    }
  }
  cands.sort((x, y) => x[0] - y[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0));
  const events = [];
  for (const [nr, a, b] of cands) {
    const e = events.find((e) => e[0] === nr && !(b <= e[1] || a >= e[2])); // overlapping window: the same event
    if (e) { if (a > e[1]) e[1] = a; if (b < e[2]) e[2] = b; } else events.push([nr, a, b]);
  }
  const cover = new Map();
  for (const f of facts?.dei?.EntityCommonStockSharesOutstanding?.shares || []) {
    if (/^10-[KQ]/.test(f.form || "")) cover.set(f.filed, (cover.get(f.filed) || 0) + f.val); // share classes filed together
  }
  const cs = [...cover.entries()].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  for (const e of events) {
    for (let i = 0; i + 1 < cs.length; i++) {
      const [fa, va] = cs[i], [fb, vb] = cs[i + 1];
      if (va && e[1] <= fa && fb <= e[2] && Math.abs(vb / va - e[0]) / e[0] < 0.1) { e[1] = fa; e[2] = fb; }
    }
  }
  return events;
}
const splitFactor = (splits, filed) => splits.reduce((f, [r, lo]) => (filed <= lo ? f * r : f), 1);

// the SEC value of one definition of a line for one fiscal year
function secValue(store, splits, start, end, line, rule) {
  let factor = 1;
  const g = (tag) => {
    const m = store.get(tag);
    if (!m) return null;
    let f = null;
    if (line.kind === "I") f = m.get("|" + end) || null;
    else {
      f = m.get(start + "|" + end) || null;
      if (!f) { // a start a few days off (52/53-week years)
        for (const x of m.values()) { if (x.end === end && x.start) { const d = days(x.start, x.end); if (d >= 340 && d <= 380) { f = x; break; } } }
      }
    }
    if (!f) return null;
    let v = f.val;
    const k = line.ps ? splitFactor(splits, f.filed) : 1;
    if (line.ps === "eps") v = v / k;
    if (line.ps === "shares") v = v * k;
    if (k !== 1) factor = k;
    return { v, f };
  };
  const res = rule(g);
  return res ? { ...res, splitFactor: factor } : null;
}

function differs(fmpV, secV, floor, tol = REL_TOL) {
  const d = Math.abs(fmpV - secV);
  return d > tol * Math.abs(secV) + 1e-9 && d > floor + 1e-9;
}
const floorOf = (line) => (line.ps === "eps" ? FLOORS.eps : line.ps === "shares" ? FLOORS.shares : FLOORS.money);
const pct = (a, b) => (b ? Math.round(((a - b) / Math.abs(b)) * 10000) / 100 : null);

// ---------- FMP ----------
async function fmpRows(db, symbol, endpoint, extra) {
  const { payload } = await callFmp(db, "statements", { endpoint, symbol, period: "annual", ...extra });
  return Array.isArray(payload) ? payload.filter((r) => r && typeof r.date === "string") : [];
}
const fyLabel = (r) => "FY" + (r.fiscalYear != null && String(r.fiscalYear).trim() ? String(r.fiscalYear).trim() : r.date.slice(0, 4));

// ---------- the check ----------
const running = new Set();

// opts.details: also return every comparison made ({kind, field, period, fmp, sec, source, ok}), for the admin's "run now"
export async function runDqCheck(db, rawTicker, opts = {}) {
  const ticker = String(rawTicker || "").trim().toUpperCase();
  if (!TICKER.test(ticker)) fail(400, "bad_ticker", "Enter a ticker symbol.");
  if (running.has(ticker)) fail(409, "busy", `A check for ${ticker} is already running.`);
  running.add(ticker);
  const t0 = Date.now();
  try {
    const summary = { ticker, cik: null, entity: null, years: [], checked: 0, flagged: 0, created: 0, resolved: 0, skipped: [], no_sec_value: {}, unverified: {}, flags: [] };
    const results = []; // {kind, field, period, fmp, sec, source, unverified?, mismatch: null | {fmp, sec, detail}}
    const skip = (why) => { if (!summary.skipped.includes(why)) summary.skipped.push(why); };

    // FMP statements (the latest annual rows)
    const limit = { limit: 10 };
    const [inc, bal, cf] = await Promise.all([
      fmpRows(db, ticker, "income-statement", limit), fmpRows(db, ticker, "balance-sheet-statement", limit), fmpRows(db, ticker, "cashflow-statement", limit)]);
    if (!inc.length) {
      skip(`FMP has no annual income statements for ${ticker}.`);
      return finish(db, summary, results, t0, opts);
    }
    const byDate = (rows) => new Map(rows.map((r) => [r.date, r]));
    const B = byDate(bal), C = byDate(cf);
    const years = [...inc].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, YEARS)
      .map((i) => ({ date: i.date, period: fyLabel(i), i, b: B.get(i.date), c: C.get(i.date) }));
    summary.years = years.map((y) => y.period);
    const currency = years[0].i.reportedCurrency || "USD";

    // SEC facts
    let sec = null;
    if (currency !== "USD") skip(`FMP reports ${ticker} in ${currency}; the SEC comparison needs USD.`);
    else {
      try { sec = await loadSec(db, ticker, years[0].i.cik, years[0].date, summary); }
      catch (e) { skip(`SEC company facts unavailable: ${e.message}`); db.logError("dq", e.code || "sec_fetch", e.message, { ticker }); }
    }

    // statements vs SEC
    const secRevenue = new Map();
    if (sec) {
      for (const y of years) {
        let best = null;
        for (const [end, start] of sec.fys) { const d = Math.abs(days(end, y.date)); if (d <= 7 && (!best || d < best.d)) best = { end, start, d }; }
        if (!best) { skip(`${y.period}: no SEC 10-K fiscal year ending near ${y.date}.`); continue; }
        for (const line of LINES) {
          const defs = line.sec.map((d) => ({ tol: d.tol, passOnly: !!d.passOnly, res: secValue(sec.store, sec.splits, best.start, best.end, line, d.rule) }))
            .filter((d, i, all) => d.res && all.findIndex((x) => x.res && x.res.tag === d.res.tag) === i);
          if (!defs.length) { (summary.no_sec_value[line.field] ||= []).push(y.period); continue; }
          if (line.field === "revenue") secRevenue.set(y.date, defs[0].res.v);
          const stmt = STATEMENT_OF[line.field];
          if (!y[stmt]) { skip(`${y.period}: FMP has no ${stmt === "b" ? "balance sheet" : "cash-flow statement"}.`); continue; }
          const fv = line.fmp(y);
          if (!isNum(fv)) { skip(`${y.period}: FMP has no ${line.label.toLowerCase()}.`); continue; }
          summary.checked++;
          const hit = defs.find((d) => !differs(fv, d.res.v, floorOf(line), d.tol));
          const ref = defs.find((d) => !d.passOnly);
          const s = (hit || ref || defs[0]).res;
          const r = { kind: "sec_mismatch", field: line.field, period: y.period, fmp: fv, sec: s.v, source: s.tag, mismatch: null };
          if (!hit && !ref) { r.unverified = true; (summary.unverified[line.field] ||= []).push(y.period); }
          else if (!hit) {
            const f0 = s.src[0] || {};
            r.mismatch = {
              fmp: fv, sec: s.v,
              detail: {
                label: line.label, tag: s.tag, form: f0.form || null, accession: f0.accn || null, filed: f0.filed || null,
                sec_start: line.kind === "D" ? best.start : null, sec_end: best.end, fmp_date: y.date, fmp_filing_date: y[stmt]?.filingDate || null,
                diff: Math.round((fv - s.v) * 1e6) / 1e6, diff_pct: pct(fv, s.v),
                ...(s.splitFactor !== 1 ? { split_factor: s.splitFactor } : {}),
                ...(s.src.length > 1 ? { sources: s.src.map((f) => ({ val: f.val, accession: f.accn, form: f.form, filed: f.filed, start: f.start, end: f.end })) } : {}),
                ...(defs.length > 1 ? { also_compared: defs.filter((d) => d.res !== s).map((d) => ({ tag: d.res.tag, value: d.res.v })) } : {}),
              },
            };
          }
          results.push(r);
        }
      }
    }

    // segment members vs total revenue
    for (const [field, endpoint, label] of [["product_segments", "revenue-product-segmentation", "product"], ["geographic_segments", "revenue-geographic-segments", "geographic"]]) {
      let rows;
      try { rows = await fmpRows(db, ticker, endpoint, { structure: "flat" }); }
      catch (e) { skip(`FMP ${label} segments: ${e.message}`); continue; }
      if (!rows.length) { skip(`FMP has no ${label} segments for ${ticker}.`); continue; }
      for (const y of years) {
        const seg = rows.find((r) => Math.abs(days(r.date, y.date)) <= 7);
        const vals = seg && seg.data && typeof seg.data === "object" ? Object.entries(seg.data).filter(([, v]) => isNum(v)) : [];
        if (!vals.length) continue;
        const sum = vals.reduce((s, [, v]) => s + v, 0);
        // the members should add up to total revenue: SEC's figure, or FMP's own (banks: FMP's is gross revenue)
        const totals = [["sec_revenue", secRevenue.get(y.date)], ["fmp_revenue", y.i.revenue]].filter(([, v]) => isNum(v) && v);
        if (!totals.length) continue;
        summary.checked++;
        const hit = totals.find(([, v]) => Math.abs(sum - v) <= SEGMENT_TOL * Math.abs(v));
        const [source, total] = hit || totals[0];
        const r = { kind: "segment_sum", field, period: y.period, fmp: sum, sec: total, source, mismatch: null };
        if (!hit) {
          r.mismatch = {
            fmp: sum, sec: total,
            detail: {
              label: `Sum of ${label} segments vs total revenue`, endpoint, members: Object.fromEntries(vals), member_count: vals.length,
              total_source: source === "sec_revenue" ? "sec" : "fmp", sec_revenue: secRevenue.get(y.date) ?? null, fmp_revenue: y.i.revenue ?? null, fmp_date: y.date,
              diff: sum - total, diff_pct: pct(sum, total), ...(seg._overridden ? { overridden_labels: true } : {}),
            },
          };
        }
        results.push(r);
      }
    }
    return finish(db, summary, results, t0, opts);
  } finally {
    running.delete(ticker);
  }
}

// SEC facts for a ticker, or null with the reason in summary.skipped. Candidates: the CIK on FMP's statements (the
// filer FMP read) and the CIK in SEC's ticker map; they differ after a holding-company reorganisation (XOM in 2026:
// the map names the new holding company, which has no 10-K yet). The first candidate whose 10-K fiscal years include
// FMP's latest year wins, else the first with any 10-K years.
async function loadSec(db, ticker, fmpCik, latestDate, summary) {
  const cands = [];
  if (/^\d{1,10}$/.test(String(fmpCik || "").trim()) && Number(fmpCik) > 0) cands.push({ cik: Number(fmpCik), source: "fmp" });
  const hit = await lookupCik(db, ticker);
  if (hit && !cands.some((c) => c.cik === hit.cik)) cands.push({ cik: hit.cik, name: hit.name, source: "sec_ticker_map" });
  if (!cands.length) { summary.skipped.push(`No SEC CIK for ${ticker} (not an SEC registrant, or listed under another symbol).`); return null; }
  let why = null, fallback = null;
  for (const c of cands) {
    const facts = await companyFacts(db, c.cik, SEC_SPEC, ticker);
    if (facts.missing) { why ||= `SEC has no XBRL company facts for CIK ${c.cik}.`; continue; }
    const store = factStore(facts.facts);
    const fys = fiscalYears(store);
    if (!fys.size) {
      const foreign = (facts.forms?.["20-F"] || 0) + (facts.forms?.["40-F"] || 0) > 0 || facts.namespaces?.includes("ifrs-full");
      why ||= foreign ? `${ticker} files 20-F/40-F (foreign private issuer): no 10-K facts to compare.` : `No 10-K annual facts for ${ticker} (CIK ${c.cik}) in SEC company facts.`;
      continue;
    }
    const found = { c, entity: facts.entityName || c.name || null, sec: { store, fys, splits: detectSplits(facts.facts) } };
    if ([...fys.keys()].some((end) => Math.abs(days(end, latestDate)) <= 7)) { fallback = found; break; }
    fallback ||= found;
  }
  if (!fallback) { summary.skipped.push(why); return null; }
  Object.assign(summary, { cik: fallback.c.cik, cik_source: fallback.c.source, entity: fallback.entity });
  return fallback.sec;
}

// write the flags, close stale ones, and fill in the summary
function finish(db, summary, results, t0, opts = {}) {
  const now = nowIso(), day = now.slice(0, 10), t = summary.ticker;
  db.tx(() => {
    for (const r of results) {
      if (r.unverified) continue; // FMP differs only from a derived figure: neither a flag nor a confirmation
      let keepFp = null;
      if (r.mismatch) {
        summary.flagged++;
        const fv = canon(r.mismatch.fmp), sv = canon(r.mismatch.sec);
        keepFp = sha256([t, r.kind, r.field, r.period, fv, sv].join("|"));
        const ins = db.run(`INSERT INTO dq_flags (fingerprint, at, ticker, kind, field, period, fmp_value, sec_value, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                            ON CONFLICT (fingerprint) DO NOTHING`, keepFp, now, t, r.kind, r.field, r.period, fv, sv, JSON.stringify(r.mismatch.detail));
        if (ins.changes) summary.created++;
        const row = db.get("SELECT id, status FROM dq_flags WHERE fingerprint = ?", keepFp);
        summary.flags.push({ id: row.id, status: row.status, kind: r.kind, field: r.field, period: r.period, fmp_value: fv, sec_value: sv, diff_pct: r.mismatch.detail.diff_pct, new: !!ins.changes });
      }
      // open flags for the same line and year that no longer describe the data
      const stale = db.all(`SELECT id, note FROM dq_flags WHERE ticker = ? AND kind = ? AND field = ? AND period = ? AND status IN ('open', 'acknowledged') AND fingerprint IS NOT ?`,
        t, r.kind, r.field, r.period, keepFp);
      for (const s of stale) {
        const why = keepFp ? `Auto-closed ${day}: the values changed; see flag #${summary.flags[summary.flags.length - 1].id}.` : `Auto-closed ${day}: FMP and SEC agree on re-check.`;
        db.run("UPDATE dq_flags SET status = 'fixed', note = ?, updated_by = NULL, updated_at = ? WHERE id = ?", s.note ? s.note + "\n" + why : why, now, s.id);
        summary.resolved++;
      }
    }
    db.setConfig("dq_last_check", { at: now, ticker: t, checked: summary.checked, flagged: summary.flagged, created: summary.created });
  });
  if (opts.details) summary.comparisons = results.map((r) => ({ kind: r.kind, field: r.field, period: r.period, fmp: r.fmp, sec: r.sec, source: r.source, ok: !r.mismatch && !r.unverified, ...(r.unverified ? { unverified: true } : {}) }));
  summary.ms = Date.now() - t0;
  return summary;
}

// ---------- nightly ----------
// tickers someone loaded in the last 7 days (most recent first), at most 50, one after another
export async function runNightlyDq(db, { max = NIGHTLY_MAX, sinceDays = 7 } = {}) {
  const t0 = Date.now();
  try { pruneSecCache(db); } catch (e) { db.logError("dq", "prune", e.message); }
  const since = new Date(Date.now() - sinceDays * DAY).toISOString();
  const tickers = db.all(`SELECT ticker, MAX(at) AS last FROM usage_events WHERE feature = 'fmp' AND ticker IS NOT NULL AND at >= ?
                          GROUP BY ticker ORDER BY last DESC LIMIT ?`, since, max * 2)
    .map((r) => String(r.ticker).toUpperCase()).filter((t) => TICKER.test(t));
  const out = { at: nowIso(), tickers: 0, checked: 0, flagged: 0, created: 0, errors: 0 };
  for (const t of [...new Set(tickers)].slice(0, max)) {
    try {
      const s = await runDqCheck(db, t);
      out.tickers++; out.checked += s.checked; out.flagged += s.flagged; out.created += s.created;
    } catch (e) {
      out.errors++;
      db.logError("dq", e.code || "check_failed", e.message, { ticker: t });
    }
  }
  out.ms = Date.now() - t0;
  db.setConfig("dq_last_nightly", out);
  return out;
}

// ---------- routes (/api/admin/dq) ----------
// detail is JSON when this module wrote it; anything else is passed through as text rather than failing the list
const parseDetail = (d) => { if (!d) return null; try { return JSON.parse(d); } catch (e) { return d; } };
const flagOut = (f) => ({ ...f, detail: parseDetail(f.detail) });
const overrideOut = (o) => ({ ...o, active: !!o.active, rule: JSON.parse(o.rule) });
const intParam = (v, min, max, d) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };
const idParam = (c) => { const id = Number(c.req.param("id")); if (!Number.isSafeInteger(id) || id < 1) fail(400, "bad_id", "Bad id."); return id; };
const body = async (c) => { const b = await c.req.json().catch(() => null); return b && typeof b === "object" ? b : {}; };
const tickerOf = (v) => { const t = String(v || "").trim().toUpperCase(); if (!TICKER.test(t)) fail(400, "bad_ticker", "Enter a ticker symbol."); return t; };

export function dqRoutes(db) {
  const r = new Hono();
  r.use("*", requireAdmin);

  // the queue: ?status=open (default; comma list or "all") &ticker= &kind= &limit= (1-500) &before=<id> (paging)
  r.get("/flags", (c) => {
    const q = c.req.query();
    const where = [], args = [];
    const st = String(q.status || "open").split(",").map((s) => s.trim()).filter(Boolean);
    if (!st.includes("all")) {
      if (st.some((s) => !STATUSES.includes(s))) fail(400, "bad_status", "status is one of " + STATUSES.join(", ") + " or all.");
      where.push(`status IN (${st.map(() => "?").join(", ")})`); args.push(...st);
    }
    if (q.ticker) { where.push("ticker = ?"); args.push(tickerOf(q.ticker)); }
    if (q.kind) { where.push("kind = ?"); args.push(String(q.kind)); }
    if (q.before) { where.push("id < ?"); args.push(intParam(q.before, 1, Number.MAX_SAFE_INTEGER, 0)); }
    const limit = intParam(q.limit, 1, 500, 100);
    const sql = `SELECT * FROM dq_flags ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT ?`;
    const flags = db.all(sql, ...args, limit).map(flagOut);
    c.header("cache-control", "private, no-store");
    return c.json({ flags, next: flags.length === limit ? flags[flags.length - 1].id : null });
  });

  // triage one flag: {status, note}
  r.post("/flags/:id", async (c) => {
    const id = idParam(c);
    const b = await body(c);
    const f = db.get("SELECT * FROM dq_flags WHERE id = ?", id);
    if (!f) fail(404, "not_found", "No such flag.");
    if (b.status !== undefined && !STATUSES.includes(b.status)) fail(400, "bad_status", "status is one of " + STATUSES.join(", ") + ".");
    if (b.note !== undefined && b.note !== null && typeof b.note !== "string") fail(400, "bad_note", "note must be text.");
    if (b.status === undefined && b.note === undefined) fail(400, "bad_request", "Send a status or a note.");
    const status = b.status ?? f.status;
    const note = b.note === undefined ? f.note : b.note === null ? null : b.note.trim().slice(0, 2000) || null;
    const user = c.get("user");
    db.tx(() => {
      db.run("UPDATE dq_flags SET status = ?, note = ?, updated_by = ?, updated_at = ? WHERE id = ?", status, note, user.id, nowIso(), id);
      db.audit(user.id, "dq.flag_update", `dq_flags:${id}`, { status: f.status, note: f.note }, { status, note, ticker: f.ticker, kind: f.kind, field: f.field, period: f.period });
    });
    return c.json({ flag: flagOut(db.get("SELECT * FROM dq_flags WHERE id = ?", id)) });
  });

  // check one ticker now: {ticker, details?} (details: every comparison, not just the mismatches)
  r.post("/run", async (c) => {
    const user = c.get("user");
    const b = await body(c);
    const ticker = tickerOf(b.ticker);
    rateLimit("dq:run:" + user.id, 5, 5 / 300, "data-quality checks");
    const summary = await runDqCheck(db, ticker, { details: b.details === true });
    db.audit(user.id, "dq.run", ticker, null, { checked: summary.checked, flagged: summary.flagged, created: summary.created, resolved: summary.resolved, skipped: summary.skipped.length });
    return c.json(summary);
  });

  // segment label overrides (applied to FMP segment payloads on read, in tools/fmp.js)
  r.get("/overrides", (c) => {
    const t = c.req.query("ticker");
    const rows = t ? db.all("SELECT * FROM ticker_overrides WHERE ticker = ? ORDER BY active DESC, id DESC", tickerOf(t))
      : db.all("SELECT * FROM ticker_overrides ORDER BY active DESC, id DESC LIMIT 1000");
    c.header("cache-control", "private, no-store");
    return c.json({ overrides: rows.map(overrideOut) });
  });

  r.post("/overrides", async (c) => {
    const b = await body(c);
    const ticker = tickerOf(b.ticker);
    if (!OVERRIDE_KINDS.includes(b.kind)) fail(400, "bad_kind", "kind is geo_label or product_label.");
    const from = typeof b.from === "string" ? b.from.trim() : "", to = typeof b.to === "string" ? b.to.trim() : "";
    if (!from || !to || from.length > 200 || to.length > 200) fail(400, "bad_rule", "from and to are labels of 1-200 characters.");
    if (from === to) fail(400, "bad_rule", "from and to are the same label.");
    const user = c.get("user");
    const id = db.tx(() => {
      // one active rule per source label: a new one replaces the old
      const replaced = db.all("SELECT id, rule FROM ticker_overrides WHERE ticker = ? AND kind = ? AND active = 1", ticker, b.kind)
        .filter((o) => JSON.parse(o.rule).from === from).map((o) => o.id);
      for (const old of replaced) db.run("UPDATE ticker_overrides SET active = 0 WHERE id = ?", old);
      const ins = db.run("INSERT INTO ticker_overrides (ticker, kind, rule, active, created_by, created_at) VALUES (?, ?, ?, 1, ?, ?)",
        ticker, b.kind, JSON.stringify({ from, to }), user.id, nowIso());
      const newId = Number(ins.lastInsertRowid);
      db.audit(user.id, "dq.override_add", `ticker_overrides:${newId}`, replaced.length ? { replaced } : null, { ticker, kind: b.kind, from, to });
      return newId;
    });
    return c.json({ override: overrideOut(db.get("SELECT * FROM ticker_overrides WHERE id = ?", id)) });
  });

  r.delete("/overrides/:id", (c) => {
    const id = idParam(c);
    const o = db.get("SELECT * FROM ticker_overrides WHERE id = ?", id);
    if (!o) fail(404, "not_found", "No such override.");
    if (o.active) {
      const user = c.get("user");
      db.tx(() => {
        db.run("UPDATE ticker_overrides SET active = 0 WHERE id = ?", id);
        db.audit(user.id, "dq.override_remove", `ticker_overrides:${id}`, { active: true, ticker: o.ticker, kind: o.kind, rule: JSON.parse(o.rule) }, { active: false });
      });
    }
    return c.json({ override: overrideOut(db.get("SELECT * FROM ticker_overrides WHERE id = ?", id)) });
  });

  // counts by status and kind, open flags per ticker, and when the checks last ran
  r.get("/summary", (c) => {
    const counts = db.all("SELECT kind, status, COUNT(*) AS n FROM dq_flags GROUP BY kind, status ORDER BY kind, status");
    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    const byKind = {};
    for (const x of counts) {
      byStatus[x.status] = (byStatus[x.status] || 0) + x.n;
      const k = (byKind[x.kind] ||= { total: 0, ...Object.fromEntries(STATUSES.map((s) => [s, 0])) });
      k[x.status] += x.n; k.total += x.n;
    }
    c.header("cache-control", "private, no-store");
    return c.json({
      by_status: byStatus, by_kind: byKind, counts,
      open_by_ticker: db.all("SELECT ticker, COUNT(*) AS n FROM dq_flags WHERE status = 'open' GROUP BY ticker ORDER BY n DESC, ticker LIMIT 50"),
      overrides_active: db.get("SELECT COUNT(*) AS n FROM ticker_overrides WHERE active = 1").n,
      last_check: db.getConfig("dq_last_check"), last_nightly: db.getConfig("dq_last_nightly"),
    });
  });
  return r;
}
