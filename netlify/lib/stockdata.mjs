// Assembles the Shikiho-style data bundle for one US ticker from the market-data provider + edgar.tools.
import { provider, soft } from "./providers/index.mjs";
import { edgarCompany, edgarFilings, edgarMaterialEvents, edgarRatios } from "./edgar.mjs";
import { cached } from "./store.mjs";
import { HttpError } from "./http.mjs";
import { damodaranDcf, dcfSensitivity } from "./dcf.mjs";

const P = provider();
const M = 1e6;
const SYMBOL_RE = /^[A-Z0-9.\-]{1,10}$/;

export function normalizeSymbol(raw) {
  const s = String(raw || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!SYMBOL_RE.test(s)) throw new HttpError(400, "invalid_symbol");
  return s;
}

const num = (v) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const mm = (v) => (num(v) === null ? null : Math.round(num(v) / M)); // USD -> million USD
const pct = (v, d = 1) => (num(v) === null ? null : Math.round(num(v) * 100 * 10 ** d) / 10 ** d);
const r2 = (v) => (num(v) === null ? null : Math.round(num(v) * 100) / 100);

function yy(dateStr) {
  return dateStr ? dateStr.slice(2, 4) : "";
}
function month(dateStr) {
  return dateStr ? Number(dateStr.slice(5, 7)) : null;
}

/** Fiscal-year label like Shikiho "連25.9" -> { fy: "25.9" } */
function fyLabel(dateStr) {
  return `${yy(dateStr)}.${month(dateStr)}`;
}

/** Quarter label "26.4-6" from the quarter-end date. */
function quarterLabel(dateStr) {
  const end = month(dateStr);
  const start = ((end - 3 + 12) % 12) + 1;
  const y = Number(dateStr.slice(0, 4));
  const startYear = start > end ? y - 1 : y;
  return `${String(startYear).slice(2)}.${start}-${end}`;
}

function lastCompletedQuarter(lagDays = 50) {
  const d = new Date(Date.now() - lagDays * 86400000);
  const q = Math.floor(d.getUTCMonth() / 3); // 0..3 current quarter
  let year = d.getUTCFullYear();
  let quarter = q; // previous quarter index (1-based) = q
  if (quarter === 0) {
    quarter = 4;
    year -= 1;
  }
  return { year, quarter };
}

function prevQuarter({ year, quarter }) {
  return quarter === 1 ? { year: year - 1, quarter: 4 } : { year, quarter: quarter - 1 };
}

/** Daily closes, newest first, for up to 10 years. Cached for 6 hours. */
export async function dailyPrices(symbol) {
  return cached(`prices:${symbol}`, 6 * 3600, async () => {
    const from = new Date();
    from.setUTCFullYear(from.getUTCFullYear() - 10);
    from.setUTCDate(from.getUTCDate() - 7);
    const rows = await P.dailyPrices(symbol, from.toISOString().slice(0, 10));
    if (!Array.isArray(rows) || !rows.length) throw new HttpError(404, "no_price_history");
    return rows.map((r) => ({ d: r.date, p: num(r.close), v: num(r.volume) }));
  });
}

const RANGES = { "1m": 31, "3m": 93, "6m": 186, "1y": 366, "3y": 1096, "5y": 1827, "10y": 3653 };

export async function chartSeries(symbol, range) {
  const days = RANGES[range] || RANGES["1y"];
  const all = await dailyPrices(symbol);
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const asc = all.slice().reverse(); // oldest first
  const startIdx = asc.findIndex((r) => r.d >= cutoff);
  const pts = startIdx < 0 ? [] : asc.slice(startIdx);
  // thin long series for payload size (keep <= ~800 points)
  const step = Math.max(1, Math.floor(pts.length / 800));
  const keep = (i) => step === 1 || i % step === 0 || i === pts.length - 1;
  // simple moving averages over the trailing N closes, using history before the range start
  const ma = (n) => { let sum = 0; const out = []; for (let i = 0; i < asc.length; i++) { sum += asc[i].p; if (i >= n) sum -= asc[i - n].p; const inRange = i >= startIdx && startIdx >= 0; if (inRange && keep(i - startIdx)) out.push([asc[i].d, i >= n - 1 ? Math.round((sum / n) * 100) / 100 : null]); } return out; };
  const thinned = pts.filter((_, i) => keep(i));
  return { symbol, range, points: thinned.map((r) => [r.d, r.p]), ma50: ma(50), ma200: ma(200), from: pts[0]?.d, to: pts[pts.length - 1]?.d };
}

function priceTables(daily) {
  // daily newest first
  const byYear = new Map();
  for (const r of daily) {
    const y = r.d.slice(0, 4);
    const e = byYear.get(y) || { year: y, high: -Infinity, highAt: null, low: Infinity, lowAt: null };
    if (r.p > e.high) {
      e.high = r.p;
      e.highAt = r.d;
    }
    if (r.p < e.low) {
      e.low = r.p;
      e.lowAt = r.d;
    }
    byYear.set(y, e);
  }
  const years = [...byYear.values()].sort((a, b) => a.year.localeCompare(b.year));
  const recent = years.slice(-4); // 3 full years + current
  const older = years.slice(0, -4);
  const yearly = [];
  if (older.length) {
    const hi = older.reduce((a, b) => (b.high > a.high ? b : a));
    const lo = older.reduce((a, b) => (b.low < a.low ? b : a));
    yearly.push({
      label: `${older[0].year.slice(2)}-${older[older.length - 1].year.slice(2)}`,
      high: hi.high,
      highNote: hi.year.slice(2),
      low: lo.low,
      lowNote: lo.year.slice(2),
    });
  }
  const latestDate = daily[0]?.d;
  for (const y of recent) {
    const isCurrent = latestDate && y.year === latestDate.slice(0, 4);
    yearly.push({
      label: isCurrent ? `${y.year.slice(2)}.1-${month(latestDate)}` : y.year.slice(2),
      high: y.high,
      highNote: String(month(y.highAt)),
      low: y.low,
      lowNote: String(month(y.lowAt)),
    });
  }
  // last 3 calendar months
  const byMonth = new Map();
  for (const r of daily) {
    const k = r.d.slice(0, 7);
    const e = byMonth.get(k) || { ym: k, high: -Infinity, low: Infinity, volume: 0 };
    e.high = Math.max(e.high, r.p);
    e.low = Math.min(e.low, r.p);
    e.volume += r.v || 0;
    byMonth.set(k, e);
  }
  const months = [...byMonth.values()].sort((a, b) => a.ym.localeCompare(b.ym)).slice(-3);
  const monthly = months.map((m, i) => ({
    label: i === 0 ? `${m.ym.slice(2, 4)}.${Number(m.ym.slice(5, 7))}` : String(Number(m.ym.slice(5, 7))),
    partial: i === months.length - 1,
    high: m.high,
    low: m.low,
    volumeM: Math.round(m.volume / M),
  }));
  return { yearly, monthly };
}

function dividendsInWindow(divs, startExclusive, endInclusive) {
  let total = 0;
  let any = false;
  for (const d of divs) {
    if (d.date > startExclusive && d.date <= endInclusive) {
      total += num(d.amount) || 0;
      any = true;
    }
  }
  return any ? r2(total) : null;
}

async function institutionalHolders(symbol) {
  let q = lastCompletedQuarter();
  for (let i = 0; i < 3; i++) {
    const [holders, summary] = await Promise.all([
      soft(P.institutionalHolders(symbol, q.year, q.quarter, 10)),
      soft(P.institutionalSummary(symbol, q.year, q.quarter), null),
    ]);
    if (Array.isArray(holders) && holders.length) {
      return {
        asOf: holders[0].date,
        holders: holders.map((h) => ({
          name: h.name,
          sharesM: Math.round((num(h.shares) || 0) / M * 10) / 10,
          ownershipPct: r2(h.ownershipPct),
          changeShares: num(h.changeShares),
        })),
        summary: summary
          ? {
              investorsHolding: num(summary.investorsHolding),
              ownershipPct: r2(summary.ownershipPct),
              newPositions: num(summary.newPositions),
              closedPositions: num(summary.closedPositions),
              increased: num(summary.increased),
              reduced: num(summary.reduced),
            }
          : null,
      };
    }
    q = prevQuarter(q);
  }
  return { asOf: null, holders: [], summary: null };
}

/** Competitors: the provider's peers plus the largest US-listed names in the same industry, verified via batch quote. */
async function competitors(symbol, industry, peersRaw) {
  const candidates = new Map();
  for (const p of Array.isArray(peersRaw) ? peersRaw : []) if (p.symbol && p.symbol !== symbol && !p.symbol.includes(".")) candidates.set(p.symbol, p.name);
  if (industry) {
    const rows = await soft(P.screenIndustry(industry, 15));
    for (const r of Array.isArray(rows) ? rows : []) if (r.symbol && r.symbol !== symbol && !r.symbol.includes(".") && !candidates.has(r.symbol)) candidates.set(r.symbol, r.name);
  }
  const syms = [...candidates.keys()].slice(0, 25);
  if (!syms.length) return [];
  const quotes = await soft(P.quotes(syms));
  const usEx = (e) => ["NASDAQ", "NYSE", "AMEX"].some((x) => String(e || "").toUpperCase().startsWith(x));
  return (Array.isArray(quotes) ? quotes : [])
    .filter((q) => q.symbol && usEx(q.exchange) && num(q.marketCap) > 0 && !/^[A-Z]{5}$/.test(q.symbol))
    .sort((a, b) => b.marketCap - a.marketCap)
    .slice(0, 10)
    .map((q) => ({ symbol: q.symbol, name: q.name || candidates.get(q.symbol), marketCapM: mm(q.marketCap), price: num(q.price), changePct: r2(q.changePct) }));
}

async function riskFreeRate() {
  const r = await soft(P.treasury10y(), null);
  return r ? { rate: num(r.rate), date: r.date } : { rate: 4.5, date: null };
}

async function buildBundle(symbol) {
  const profile = await P.profile(symbol);
  if (!profile || !profile.name) throw new HttpError(404, "symbol_not_found");
  if (profile.isEtf || profile.isFund) throw new HttpError(400, "not_a_company");

  const [
    quote,
    incomeA,
    incomeQ,
    balanceA,
    balanceQ,
    cashA,
    metricsA,
    metricsTTM,
    ratiosTTM,
    dividends,
    splits,
    executives,
    estimates,
    peers,
    employees,
    sharesFloat,
    segments,
    earnings,
    grades,
    targets,
    insider,
    transcriptDates,
    daily,
    inst,
    edgarCo,
    rf,
    indices,
  ] = await Promise.all([
    soft(P.quote(symbol), null),
    soft(P.incomeStatements(symbol, { period: "annual", limit: 10 })),
    soft(P.incomeStatements(symbol, { period: "quarter", limit: 8 })),
    soft(P.balanceSheets(symbol, { period: "annual", limit: 2 })),
    soft(P.balanceSheets(symbol, { period: "quarter", limit: 1 })),
    soft(P.cashFlows(symbol, { period: "annual", limit: 10 })),
    soft(P.keyMetrics(symbol, { period: "annual", limit: 2 })),
    soft(P.keyMetricsTtm(symbol), null),
    soft(P.ratiosTtm(symbol), null),
    soft(P.dividends(symbol, 60)),
    soft(P.splits(symbol)),
    soft(P.executives(symbol)),
    soft(P.estimates(symbol, 12)),
    soft(P.peers(symbol)),
    soft(P.employees(symbol), null),
    soft(P.sharesFloat(symbol), null),
    soft(P.revenueSegments(symbol, 1)),
    soft(P.earnings(symbol, 8)),
    soft(P.analystRating(symbol), null),
    soft(P.priceTarget(symbol), null),
    soft(P.insiderStats(symbol), null),
    soft(P.transcriptDates(symbol)),
    dailyPrices(symbol).catch(() => []),
    institutionalHolders(symbol),
    edgarCompany(symbol),
    riskFreeRate(),
    indexMembership(symbol),
  ]);
  const competitorList = await competitors(symbol, profile.industry, peers);

  const cik = edgarCo?.cik || profile.cik;
  const [filings, events, edgarRat] = cik
    ? await Promise.all([edgarFilings(cik, { limit: 8 }), edgarMaterialEvents(cik, { days: 365, limit: 10 }), edgarRatios(cik)])
    : [[], [], null];

  const q = quote || {};
  const annual = (Array.isArray(incomeA) ? incomeA : []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const quarters = (Array.isArray(incomeQ) ? incomeQ : []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const divs = Array.isArray(dividends) ? dividends : [];
  const cash = (Array.isArray(cashA) ? cashA : []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const latestFY = annual[annual.length - 1] || null;
  const prevFY = annual[annual.length - 2] || null;
  const bsQ = balanceQ[0] || null;
  const bsA = balanceA[0] || null;
  const bs = bsQ || bsA;
  const km = metricsA[0] || null;
  const kmTTM = metricsTTM;
  const rtTTM = ratiosTTM;
  const sharesOut = num(sharesFloat?.outstanding) || num(q.sharesOutstanding) || (num(profile.marketCap) && num(q.price) ? profile.marketCap / q.price : null);

  // ---- 業績 table ----
  const performance = [];
  annual.slice(-5).forEach((r, i, arr) => {
    const prevDate = i === 0 ? (annual[annual.length - 5 - 1]?.date || `${Number(r.date.slice(0, 4)) - 1}${r.date.slice(4)}`) : arr[i - 1].date;
    performance.push({
      kind: "annual",
      label: fyLabel(r.date),
      date: r.date,
      revenue: mm(r.revenue),
      operatingIncome: mm(r.operatingIncome),
      pretaxIncome: mm(r.pretaxIncome),
      netIncome: mm(r.netIncome),
      eps: r2(r.epsDiluted ?? r.eps),
      dps: dividendsInWindow(divs, prevDate, r.date),
    });
  });
  const futureEstimates = (Array.isArray(estimates) ? estimates : [])
    .filter((e) => latestFY && e.date > latestFY.date)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 2);
  for (const e of futureEstimates) {
    performance.push({
      kind: "estimate",
      label: fyLabel(e.date),
      date: e.date,
      revenue: mm(e.revenue),
      operatingIncome: mm(e.ebit),
      pretaxIncome: null,
      netIncome: mm(e.netIncome),
      eps: r2(e.eps),
      dps: null,
      analysts: num(e.analysts),
    });
  }
  const recentQuarters = quarters.slice(-4);
  for (const r of recentQuarters) {
    performance.push({
      kind: "quarter",
      label: quarterLabel(r.date),
      date: r.date,
      revenue: mm(r.revenue),
      operatingIncome: mm(r.operatingIncome),
      pretaxIncome: mm(r.pretaxIncome),
      netIncome: mm(r.netIncome),
      eps: r2(r.epsDiluted ?? r.eps),
      dps: null,
    });
  }
  // Year-over-year quarter for the "vs same quarter last year"
  const yoyQuarter = (() => {
    const last = quarters[quarters.length - 1];
    const prior = quarters.find((x) => x.period === last?.period && Number(x.fiscalYear) === Number(last?.fiscalYear) - 1);
    if (!last || !prior) return null;
    return {
      label: quarterLabel(last.date),
      revenueGrowthPct: prior.revenue ? pct((last.revenue - prior.revenue) / Math.abs(prior.revenue)) : null,
      netIncomeGrowthPct: prior.netIncome ? pct((last.netIncome - prior.netIncome) / Math.abs(prior.netIncome)) : null,
    };
  })();

  // ---- 配当 ----
  const dividendHistory = divs.slice(0, 8).map((d) => ({ date: d.date, paymentDate: d.paymentDate, amount: r2(d.amount) }));
  const ttmDividend = divs.filter((d) => d.date > new Date(Date.now() - 366 * 86400000).toISOString().slice(0, 10)).reduce((s, d) => s + (num(d.amount) || 0), 0);
  const price = num(q.price) || num(profile.price);
  const dividendYieldPct = price && ttmDividend ? r2((ttmDividend / price) * 100) : null;
  const bps = bs && sharesOut ? r2(num(bs.equity) / sharesOut) : null;

  // ---- 指標 ----
  const maxNet = annual.reduce((a, r) => (num(r.netIncome) !== null && (a === null || r.netIncome > a.netIncome) ? r : a), null);
  const latestCF = cash[cash.length - 1] || null;
  const prevCF = cash[cash.length - 2] || null;
  const indicators = {
    fiscalYear: latestFY ? fyLabel(latestFY.date) : null,
    roePct: pct(km?.roe),
    roeTTMPct: pct(kmTTM?.roe),
    roaPct: pct(km?.roa),
    roaTTMPct: pct(kmTTM?.roa),
    maxNetIncome: maxNet ? { label: fyLabel(maxNet.date), value: mm(maxNet.netIncome) } : null,
    capex: latestCF ? mm(Math.abs(num(latestCF.capex) || 0)) : null,
    capexPrev: prevCF ? mm(Math.abs(num(prevCF.capex) || 0)) : null,
    depreciation: latestCF ? mm(latestCF.depreciation) : null,
    depreciationPrev: prevCF ? mm(prevCF.depreciation) : null,
    rnd: latestFY ? mm(latestFY.rnd) : null,
    rndPrev: prevFY ? mm(prevFY.rnd) : null,
    per: r2(rtTTM?.pe),
    pbr: r2(rtTTM?.pb),
    evToEbitda: r2(kmTTM?.evToEbitda),
  };

  const cashflow = latestCF
    ? {
        fiscalYear: fyLabel(latestCF.date),
        operating: mm(latestCF.operating),
        operatingPrev: prevCF ? mm(prevCF.operating) : null,
        investing: mm(latestCF.investing),
        investingPrev: prevCF ? mm(prevCF.investing) : null,
        financing: mm(latestCF.financing),
        financingPrev: prevCF ? mm(prevCF.financing) : null,
        cash: mm(latestCF.cashEnd),
        cashPrev: prevCF ? mm(prevCF.cashEnd) : null,
        freeCashFlow: mm(latestCF.freeCashFlow),
        buybacks: mm(Math.abs(num(latestCF.buybacks) || 0)),
        dividendsPaid: mm(Math.abs(num(latestCF.dividendsPaid) || 0)),
      }
    : null;

  // ---- 財務 (leverage, interest burden, liquidity, asset quality) ----
  const ebitdaFY = num(latestFY?.ebitda);
  const ebitFY = num(latestFY?.operatingIncome);
  const interestFY = num(latestFY?.interestExpense);
  const prevDebt = balanceA[1] ? num(balanceA[1].totalDebt) : null;
  const avgDebt = bs && num(bs.totalDebt) !== null ? (prevDebt !== null ? (num(bs.totalDebt) + prevDebt) / 2 : num(bs.totalDebt)) : null;
  const shsNow = num(latestFY?.dilutedShares);
  const shsPrev = num(prevFY?.dilutedShares);
  const financials = bs
    ? {
        asOf: bs.date,
        period: bs.period,
        totalAssets: mm(bs.totalAssets),
        equity: mm(bs.equity),
        equityRatioPct: num(bs.totalAssets) ? pct(num(bs.equity) / num(bs.totalAssets)) : null,
        retainedEarnings: mm(bs.retainedEarnings),
        cashAndShortTerm: mm(bs.cashAndShortTerm),
        totalDebt: mm(bs.totalDebt),
        netDebt: num(bs.totalDebt) !== null ? mm(num(bs.totalDebt) - (num(bs.cashAndShortTerm) || 0)) : null,
        debtToEquity: num(bs.equity) > 0 ? r2(num(bs.totalDebt) / num(bs.equity)) : null,
        debtToEbitda: ebitdaFY > 0 ? r2(num(bs.totalDebt) / ebitdaFY) : null,
        netDebtToEbitda: ebitdaFY > 0 ? r2((num(bs.totalDebt) - (num(bs.cashAndShortTerm) || 0)) / ebitdaFY) : null,
        interestExpense: mm(interestFY),
        interestCoverage: interestFY > 0 && ebitFY !== null ? r2(ebitFY / interestFY) : null,
        interestToEbitPct: interestFY !== null && ebitFY > 0 ? pct(interestFY / ebitFY) : null,
        avgInterestRatePct: interestFY !== null && avgDebt > 0 ? pct(interestFY / avgDebt, 2) : null,
        currentRatio: num(bs.currentLiabilities) > 0 ? r2(num(bs.currentAssets) / num(bs.currentLiabilities)) : null,
        goodwillIntangibles: mm(bs.goodwillAndIntangibles),
        goodwillPct: num(bs.totalAssets) ? pct((num(bs.goodwillAndIntangibles) || 0) / num(bs.totalAssets)) : null,
        sharesChangePct: shsNow && shsPrev ? pct(shsNow / shsPrev - 1) : null,
        roicPct: pct(kmTTM?.roic),
        ebitda: mm(ebitdaFY),
        fiscalYear: latestFY ? fyLabel(latestFY.date) : null,
      }
    : null;

  // ---- segments ----
  const seg = segments[0] || null;
  let segmentList = [];
  if (seg?.data && typeof seg.data === "object") {
    const total = Object.values(seg.data).reduce((s, v) => s + (num(v) || 0), 0);
    segmentList = Object.entries(seg.data)
      .map(([name, v]) => ({ name, value: num(v), sharePct: total ? Math.round((num(v) / total) * 100) : null }))
      .sort((a, b) => (b.value || 0) - (a.value || 0))
      .slice(0, 8);
  }

  // ---- capital changes ----
  const capitalChanges = (Array.isArray(splits) ? splits : [])
    .slice(0, 10)
    .map((s) => ({ date: s.date, numerator: num(s.numerator), denominator: num(s.denominator), type: s.type }));

  const officers = (Array.isArray(executives) ? executives : [])
    .filter((e) => e.active !== false)
    .slice(0, 12)
    .map((e) => ({ name: e.name, title: e.title, since: e.since || null }));

  const peerList = (Array.isArray(peers) ? peers : [])
    .filter((p) => p.symbol && !p.symbol.includes(".") && p.symbol !== symbol && !/^[A-Z]{5}$/.test(p.symbol))
    .slice(0, 5)
    .map((p) => ({ symbol: p.symbol, name: p.name }));

  const latestInsider = insider;
  const emp = employees;
  const fyEnd = edgarCo?.fiscalYearEnd ? Number(edgarCo.fiscalYearEnd.slice(0, 2)) : latestFY ? month(latestFY.date) : null;
  const opMargin = latestFY && num(latestFY.revenue) ? pct(num(latestFY.operatingIncome) / num(latestFY.revenue)) : null;
  const opMarginPrev = prevFY && num(prevFY.revenue) ? pct(num(prevFY.operatingIncome) / num(prevFY.revenue)) : null;
  const salesGrowth = annual.slice(-4).map((r, i, arr) => (i === 0 ? null : { label: fyLabel(r.date), pct: num(arr[i - 1].revenue) ? pct(num(r.revenue) / num(arr[i - 1].revenue) - 1) : null })).filter(Boolean);
  const rev5 = annual.slice(-6);
  const revenueCagr5Pct = rev5.length >= 2 && num(rev5[0].revenue) > 0 ? pct(Math.pow(num(rev5[rev5.length - 1].revenue) / num(rev5[0].revenue), 1 / (rev5.length - 1)) - 1) : null;

  // ---- valuation metrics (TTM) ----
  const nextEst = (Array.isArray(estimates) ? estimates : []).filter((e) => latestFY && e.date > latestFY.date).sort((a, b) => a.date.localeCompare(b.date));
  const fwdEps = num(nextEst[0]?.eps);
  const fwdEps2 = num(nextEst[1]?.eps);
  const epsTTM = num(rtTTM?.epsTtm);
  // Next-twelve-month EPS: blend FY1 and FY2 consensus by months remaining in FY1.
  let epsNtm = null;
  if (fwdEps && nextEst[0]?.date) {
    const monthsLeft = Math.max(0, Math.min(12, (Date.parse(nextEst[0].date) - Date.now()) / (30.44 * 86400000)));
    epsNtm = fwdEps2 ? (fwdEps * monthsLeft + fwdEps2 * (12 - monthsLeft)) / 12 : fwdEps;
  }
  // 52-week high/low dates and all-time high from the daily series.
  const dailyArr = Array.isArray(daily) ? daily : [];
  const yearAgo = new Date(Date.now() - 366 * 86400000).toISOString().slice(0, 10);
  const last52 = dailyArr.filter((r) => r.d >= yearAgo);
  const hi52 = last52.reduce((a, r) => (a === null || r.p > a.p ? r : a), null);
  const lo52 = last52.reduce((a, r) => (a === null || r.p < a.p ? r : a), null);
  const ath = dailyArr.reduce((a, r) => (a === null || r.p > a.p ? r : a), null);
  const epsGrowthFwd = fwdEps && epsTTM && epsTTM > 0 ? (fwdEps / epsTTM - 1) * 100 : null;
  const valuation = {
    price, marketCapM: mm(q.marketCap || profile.marketCap), enterpriseValueM: mm(kmTTM?.enterpriseValue),
    pe: r2(rtTTM?.pe), peForward: fwdEps && price ? r2(price / fwdEps) : null, peForward2: fwdEps2 && price ? r2(price / fwdEps2) : null,
    peg: r2(rtTTM?.peg), pegForward: epsGrowthFwd && epsGrowthFwd > 0 && price && fwdEps ? r2(price / fwdEps / epsGrowthFwd) : null,
    ps: r2(rtTTM?.ps), pb: r2(rtTTM?.pb), pfcf: r2(rtTTM?.pfcf), pocf: r2(rtTTM?.pocf),
    evSales: r2(kmTTM?.evToSales), evEbitda: r2(kmTTM?.evToEbitda), evOcf: r2(kmTTM?.evToOcf), evFcf: r2(kmTTM?.evToFcf),
    earningsYieldPct: pct(kmTTM?.earningsYield), fcfYieldPct: pct(kmTTM?.fcfYield), dividendYieldPct, payoutPct: pct(rtTTM?.payout),
    epsTTM: r2(epsTTM), epsNtm: r2(epsNtm), epsForward: r2(fwdEps), epsForward2: r2(fwdEps2), epsGrowthFwdPct: r2(epsGrowthFwd), bvps: r2(rtTTM?.bvps), fcfps: r2(rtTTM?.fcfps), revenuePerShare: r2(rtTTM?.revenuePerShare),
    grossMarginPct: pct(rtTTM?.grossMargin), opMarginPct: pct(rtTTM?.opMargin), netMarginPct: pct(rtTTM?.netMargin),
    roePct: pct(kmTTM?.roe), roicPct: pct(kmTTM?.roic), roaPct: pct(kmTTM?.roa),
    netDebtEbitda: r2(kmTTM?.netDebtToEbitda), debtEquity: r2(rtTTM?.debtToEquity), interestCoverage: r2(rtTTM?.interestCoverage), currentRatio: r2(rtTTM?.currentRatio),
    beta: r2(profile.beta), yearHigh: num(q.yearHigh), yearLow: num(q.yearLow), priceAvg50: num(q.priceAvg50), priceAvg200: num(q.priceAvg200),
    yearHighDate: hi52?.d || null, yearLowDate: lo52?.d || null, yearHighClose: hi52?.p ?? null, yearLowClose: lo52?.p ?? null,
    allTimeHigh: ath ? { price: ath.p, date: ath.d } : null,
    analystTarget: targets ? { high: num(targets.high), low: num(targets.low), consensus: num(targets.consensus), upsidePct: price && num(targets.consensus) ? r2((targets.consensus / price - 1) * 100) : null } : null,
  };
  // ---- DCF (Damodaran FCFF) ----
  let dcf = null;
  try {
    const taxRate = latestFY && num(latestFY.pretaxIncome) > 0 ? (num(latestFY.incomeTax) / num(latestFY.pretaxIncome)) * 100 : null;
    // Accumulated operating losses from the reported years shelter early profits from tax.
    let nol = 0;
    for (const r of annual.slice(-5)) { const oi = num(r.operatingIncome) || 0; nol = oi < 0 ? nol - oi : Math.max(0, nol - oi); }
    const dcfInput = {
      price, sharesOut, dilutedShares: num(latestFY?.dilutedShares), marketCap: num(q.marketCap || profile.marketCap),
      totalDebt: num(bs?.totalDebt), leases: num(bs?.leases), cash: num(bs?.cashAndShortTerm), nonOperatingAssets: num(bs?.longTermInvestments), minorityInterest: num(bs?.minorityInterest),
      nol, beta: num(profile.beta), roic: pct(kmTTM?.roic), riskFree: rf.rate, erp: Number(process.env.DCF_ERP || 4.5),
      latest: { revenue: num(latestFY?.revenue), ebit: num(latestFY?.operatingIncome), taxRate, interestExpense: num(latestFY?.interestExpense), investedCapital: num(km?.investedCapital) || (bs ? (num(bs.totalDebt) || 0) + (num(bs.equity) || 0) - (num(bs.cashAndShortTerm) || 0) : null) },
      estimates: nextEst.map((e) => ({ date: e.date, revenue: num(e.revenue), ebit: num(e.ebit) })),
    };
    const base = damodaranDcf(dcfInput);
    if (base) dcf = { ...base, riskFreeDate: rf.date, sensitivity: dcfSensitivity(dcfInput, base) };
  } catch (e) {
    console.warn("dcf failed", e.message);
  }

  const tDates = (Array.isArray(transcriptDates) ? transcriptDates : []).slice(0, 8).map((t) => ({ fiscalYear: num(t.fiscalYear), quarter: num(t.quarter), date: t.date }));

  return {
    symbol,
    asOf: new Date().toISOString(),
    company: {
      name: profile.name,
      exchange: profile.exchange,
      exchangeFullName: profile.exchangeFullName,
      currency: profile.currency,
      cik,
      isin: profile.isin,
      sector: profile.sector,
      industry: profile.industry,
      sicDescription: edgarCo?.sicDescription || null,
      sicCode: edgarCo?.sicCode || null,
      description: profile.description,
      businessSummary: edgarCo?.businessSummary || null,
      website: profile.website,
      ceo: profile.ceo,
      address: [profile.address, profile.city, profile.state, profile.zip].filter(Boolean).join(", "),
      country: profile.country,
      phone: profile.phone,
      ipoDate: profile.ipoDate,
      stateOfIncorporation: edgarCo?.stateOfIncorporation || null,
      filerCategory: edgarCo?.filerCategory || null,
      indices,
      fiscalYearEndMonth: fyEnd,
      employees: num(emp?.count) || num(profile.employees),
      employeesAsOf: emp?.asOf || null,
      segments: segmentList,
      segmentsFiscalYear: seg?.fiscalYear || null,
      peers: peerList,
      competitors: competitorList,
    },
    market: {
      price,
      change: num(q.change),
      changePct: r2(q.changePct),
      dayHigh: num(q.dayHigh),
      dayLow: num(q.dayLow),
      yearHigh: num(q.yearHigh),
      yearLow: num(q.yearLow),
      volume: num(q.volume),
      avgVolume: num(profile.averageVolume),
      marketCapM: mm(q.marketCap || profile.marketCap),
      sharesOutstandingM: sharesOut ? Math.round(sharesOut / M) : null,
      freeFloatPct: r2(sharesFloat?.freeFloatPct),
      beta: r2(profile.beta),
      priceAvg50: num(q.priceAvg50),
      priceAvg200: num(q.priceAvg200),
      quoteTime: q.time || null,
      per: indicators.per,
      pbr: indicators.pbr,
      dividendYieldPct,
      bps,
      analystTarget: targets ? { high: num(targets.high), low: num(targets.low), consensus: num(targets.consensus) } : null,
      analystRating: grades
        ? { consensus: grades.consensus, buy: (num(grades.strongBuy) || 0) + (num(grades.buy) || 0), hold: num(grades.hold), sell: (num(grades.sell) || 0) + (num(grades.strongSell) || 0) }
        : null,
    },
    performance,
    yoyQuarter,
    growth: { operatingMarginPct: opMargin, operatingMarginPrevPct: opMarginPrev, revenueCagr5Pct, salesGrowth },
    valuation,
    dcf,
    dividends: { history: dividendHistory, ttm: r2(ttmDividend), yieldPct: dividendYieldPct, frequency: divs[0]?.frequency || null },
    indicators,
    cashflow,
    financials,
    holders: inst,
    insider: latestInsider
      ? {
          year: num(latestInsider.year),
          quarter: num(latestInsider.quarter),
          purchases: num(latestInsider.purchases),
          sales: num(latestInsider.sales),
          acquiredShares: num(latestInsider.acquiredShares),
          disposedShares: num(latestInsider.disposedShares),
        }
      : null,
    earningsHistory: (Array.isArray(earnings) ? earnings : [])
      .filter((e) => e.epsActual !== null && e.epsActual !== undefined)
      .slice(0, 4)
      .map((e) => ({ date: e.date, epsActual: num(e.epsActual), epsEstimated: num(e.epsEstimated), revenueActualM: mm(e.revenueActual), revenueEstimatedM: mm(e.revenueEstimated) })),
    nextEarnings: (Array.isArray(earnings) ? earnings : []).find((e) => e.epsActual === null || e.epsActual === undefined)?.date || null,
    capitalChanges,
    prices: Array.isArray(daily) && daily.length ? priceTables(daily) : { yearly: [], monthly: [] },
    officers,
    filings: filings.slice(0, 8),
    materialEvents: events,
    edgarRatios: edgarRat,
    transcripts: tDates,
    latestTranscriptDate: tDates[0]?.date || null,
  };
}

/** Full bundle, cached for 12 hours per symbol. */

/** Index membership and weights (S&P 500 / Nasdaq 100 / Dow 30) from the constituent lists and the tracking ETFs, cached daily. */
async function indexTables() {
  return cached("index-tables", 24 * 3600, async () => {
    const sets = [["S&P 500", "sp500", "SPY"], ["Nasdaq 100", "nasdaq100", "QQQ"], ["Dow 30", "dow30", "DIA"]];
    const out = {};
    const norm = (x) => String(x || "").toUpperCase().replace(/\./g, "-");
    for (const [name, index, etf] of sets) {
      const [list, holdings] = await Promise.all([soft(P.indexConstituents(index)), soft(P.etfHoldings(etf))]);
      const weights = {};
      for (const h of Array.isArray(holdings) ? holdings : []) if (h.symbol && Number.isFinite(Number(h.weightPct))) weights[norm(h.symbol)] = Number(h.weightPct);
      for (const c of Array.isArray(list) ? list : []) { const sym = norm(c.symbol); (out[sym] ||= []).push({ index: name, weightPct: weights[sym] ?? null }); }
    }
    return out;
  }, { version: "1" });
}

export async function indexMembership(symbol) {
  try { const t = await indexTables(); return t[String(symbol).toUpperCase().replace(/\./g, "-")] || []; } catch { return []; }
}

export async function stockBundle(symbol, { force = false, peek = false } = {}) {
  return cached(`stock:${symbol}`, 12 * 3600, () => buildBundle(symbol), { version: "11", force, peek });
}

/** Newest earnings-call transcript date the provider lists for a symbol (one light request). */
export async function latestTranscriptDate(symbol) {
  const rows = await soft(P.transcriptDates(symbol));
  const dates = (Array.isArray(rows) ? rows : []).map((t) => t.date).filter(Boolean).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

/** Light, frequently refreshed quote (5 minutes); the contract's quote shape (price, change, changePct, marketCap, time ...). */
export async function liveQuote(symbol) {
  return cached(`quote:${symbol}`, 300, async () => (await P.quote(symbol)) || {}, { version: "2" });
}

export async function searchSymbols(q) {
  const query = String(q || "").trim();
  if (query.length < 1) return [];
  const rows = await soft(P.search(query, 20));
  const seen = new Set();
  const usExchange = (r) => ["NASDAQ", "NYSE", "AMEX"].some((x) => (r.exchange || "").toUpperCase().startsWith(x));
  return rows
    .filter((r) => r.symbol && r.currency === "USD" && usExchange(r) && !r.symbol.includes(".") && !/-P[A-Z]?$/.test(r.symbol) && !/\b(ETF|Fund|Trust|Notes?|Warrant|Units?)\b/i.test(r.name || ""))
    .filter((r) => (seen.has(r.symbol) ? false : seen.add(r.symbol)))
    .slice(0, 8)
    .map((r) => ({ symbol: r.symbol, name: r.name, exchange: r.exchange }));
}
