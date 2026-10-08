// Assembles the Shikiho-style data bundle for one US ticker from FMP + edgar.tools.
import { fmp, fmpSoft, first } from "./fmp.mjs";
import { edgarCompany, edgarFilings, edgarMaterialEvents, edgarRatios } from "./edgar.mjs";
import { cached } from "./store.mjs";
import { HttpError } from "./http.mjs";
import { damodaranDcf, dcfSensitivity } from "./dcf.mjs";

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
    const rows = await fmp("historical-price-eod/light", { symbol, from: from.toISOString().slice(0, 10) });
    if (!Array.isArray(rows) || !rows.length) throw new HttpError(404, "no_price_history");
    return rows.map((r) => ({ d: r.date, p: num(r.price), v: num(r.volume) }));
  });
}

const RANGES = { "1m": 31, "3m": 93, "6m": 186, "1y": 366, "3y": 1096, "5y": 1827, "10y": 3653 };

export async function chartSeries(symbol, range) {
  const days = RANGES[range] || RANGES["1y"];
  const all = await dailyPrices(symbol);
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const pts = all.filter((r) => r.d >= cutoff).reverse(); // oldest first
  // thin long series for payload size (keep <= ~800 points)
  const step = Math.max(1, Math.floor(pts.length / 800));
  const thinned = step === 1 ? pts : pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  return { symbol, range, points: thinned.map((r) => [r.d, r.p]), from: pts[0]?.d, to: pts[pts.length - 1]?.d };
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
      total += num(d.adjDividend ?? d.dividend) || 0;
      any = true;
    }
  }
  return any ? r2(total) : null;
}

async function institutionalHolders(symbol) {
  let q = lastCompletedQuarter();
  for (let i = 0; i < 3; i++) {
    const [holders, summary] = await Promise.all([
      fmpSoft("institutional-ownership/extract-analytics/holder", { symbol, year: q.year, quarter: q.quarter, limit: 10 }),
      fmpSoft("institutional-ownership/symbol-positions-summary", { symbol, year: q.year, quarter: q.quarter }),
    ]);
    if (Array.isArray(holders) && holders.length) {
      return {
        asOf: holders[0].date,
        holders: holders.map((h) => ({
          name: h.investorName,
          sharesM: Math.round((num(h.sharesNumber) || 0) / M * 10) / 10,
          ownershipPct: r2(h.ownership),
          changeShares: num(h.changeInSharesNumber),
        })),
        summary: first(summary)
          ? {
              investorsHolding: num(first(summary).investorsHolding),
              ownershipPct: r2(first(summary).ownershipPercent),
              newPositions: num(first(summary).newPositions),
              closedPositions: num(first(summary).closedPositions),
              increased: num(first(summary).increasedPositions),
              reduced: num(first(summary).reducedPositions),
            }
          : null,
      };
    }
    q = prevQuarter(q);
  }
  return { asOf: null, holders: [], summary: null };
}

/** Competitors: FMP peers plus the largest US-listed names in the same industry, verified via batch quote. */
async function competitors(symbol, industry, peersRaw) {
  const candidates = new Map();
  for (const p of Array.isArray(peersRaw) ? peersRaw : []) if (p.symbol && p.symbol !== symbol && !p.symbol.includes(".")) candidates.set(p.symbol, p.companyName);
  if (industry) {
    const rows = await fmpSoft("company-screener", { industry, exchange: "NASDAQ,NYSE,AMEX", limit: 15, isEtf: false, isFund: false });
    for (const r of Array.isArray(rows) ? rows : []) if (r.symbol && r.symbol !== symbol && !r.symbol.includes(".") && !candidates.has(r.symbol)) candidates.set(r.symbol, r.companyName);
  }
  const syms = [...candidates.keys()].slice(0, 25);
  if (!syms.length) return [];
  const quotes = await fmpSoft("batch-quote", { symbols: syms.join(",") });
  const usEx = (e) => ["NASDAQ", "NYSE", "AMEX"].some((x) => String(e || "").toUpperCase().startsWith(x));
  return (Array.isArray(quotes) ? quotes : [])
    .filter((q) => q.symbol && usEx(q.exchange) && num(q.marketCap) > 0 && !/^[A-Z]{5}$/.test(q.symbol))
    .sort((a, b) => b.marketCap - a.marketCap)
    .slice(0, 10)
    .map((q) => ({ symbol: q.symbol, name: q.name || candidates.get(q.symbol), marketCapM: mm(q.marketCap), price: num(q.price), changePct: r2(q.changePercentage) }));
}

async function riskFreeRate() {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  const rows = await fmpSoft("treasury-rates", { from, to });
  const r = first(rows);
  return r ? { rate: num(r.year10), date: r.date } : { rate: 4.5, date: null };
}

async function buildBundle(symbol) {
  const profile = first(await fmp("profile", { symbol }));
  if (!profile || !profile.companyName) throw new HttpError(404, "symbol_not_found");
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
    fmpSoft("quote", { symbol }),
    fmpSoft("income-statement", { symbol, period: "annual", limit: 10 }),
    fmpSoft("income-statement", { symbol, period: "quarter", limit: 8 }),
    fmpSoft("balance-sheet-statement", { symbol, period: "annual", limit: 2 }),
    fmpSoft("balance-sheet-statement", { symbol, period: "quarter", limit: 1 }),
    fmpSoft("cash-flow-statement", { symbol, period: "annual", limit: 10 }),
    fmpSoft("key-metrics", { symbol, period: "annual", limit: 2 }),
    fmpSoft("key-metrics-ttm", { symbol }),
    fmpSoft("ratios-ttm", { symbol }),
    fmpSoft("dividends", { symbol, limit: 60 }),
    fmpSoft("splits", { symbol }),
    fmpSoft("key-executives", { symbol }),
    fmpSoft("analyst-estimates", { symbol, period: "annual", limit: 12 }),
    fmpSoft("stock-peers", { symbol }),
    fmpSoft("employee-count", { symbol, limit: 1 }),
    fmpSoft("shares-float", { symbol }),
    fmpSoft("revenue-product-segmentation", { symbol, limit: 1 }),
    fmpSoft("earnings", { symbol, limit: 8 }),
    fmpSoft("grades-consensus", { symbol }),
    fmpSoft("price-target-consensus", { symbol }),
    fmpSoft("insider-trading/statistics", { symbol }),
    fmpSoft("earning-call-transcript-dates", { symbol }),
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

  const q = first(quote) || {};
  const annual = (Array.isArray(incomeA) ? incomeA : []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const quarters = (Array.isArray(incomeQ) ? incomeQ : []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const divs = Array.isArray(dividends) ? dividends : [];
  const cash = (Array.isArray(cashA) ? cashA : []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const latestFY = annual[annual.length - 1] || null;
  const prevFY = annual[annual.length - 2] || null;
  const bsQ = first(balanceQ);
  const bsA = first(balanceA);
  const bs = bsQ || bsA;
  const km = first(metricsA);
  const kmPrev = Array.isArray(metricsA) ? metricsA[1] : null;
  const kmTTM = first(metricsTTM);
  const rtTTM = first(ratiosTTM);
  const sharesOut = num(first(sharesFloat)?.outstandingShares) || num(q.sharesOutstanding) || (num(profile.marketCap) && num(q.price) ? profile.marketCap / q.price : null);

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
      pretaxIncome: mm(r.incomeBeforeTax),
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
      revenue: mm(e.revenueAvg),
      operatingIncome: mm(e.ebitAvg),
      pretaxIncome: null,
      netIncome: mm(e.netIncomeAvg),
      eps: r2(e.epsAvg),
      dps: null,
      analysts: num(e.numAnalystsEps),
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
      pretaxIncome: mm(r.incomeBeforeTax),
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
  const dividendHistory = divs.slice(0, 8).map((d) => ({ date: d.date, paymentDate: d.paymentDate, amount: r2(d.adjDividend ?? d.dividend) }));
  const ttmDividend = divs.filter((d) => d.date > new Date(Date.now() - 366 * 86400000).toISOString().slice(0, 10)).reduce((s, d) => s + (num(d.adjDividend ?? d.dividend) || 0), 0);
  const price = num(q.price) || num(profile.price);
  const dividendYieldPct = price && ttmDividend ? r2((ttmDividend / price) * 100) : null;
  const bps = bs && sharesOut ? r2(num(bs.totalStockholdersEquity) / sharesOut) : null;

  // ---- 指標 ----
  const maxNet = annual.reduce((a, r) => (num(r.netIncome) !== null && (a === null || r.netIncome > a.netIncome) ? r : a), null);
  const latestCF = cash[cash.length - 1] || null;
  const prevCF = cash[cash.length - 2] || null;
  const indicators = {
    fiscalYear: latestFY ? fyLabel(latestFY.date) : null,
    roePct: pct(km?.returnOnEquity),
    roeTTMPct: pct(kmTTM?.returnOnEquityTTM),
    roaPct: pct(km?.returnOnAssets),
    roaTTMPct: pct(kmTTM?.returnOnAssetsTTM),
    maxNetIncome: maxNet ? { label: fyLabel(maxNet.date), value: mm(maxNet.netIncome) } : null,
    capex: latestCF ? mm(Math.abs(num(latestCF.capitalExpenditure) || 0)) : null,
    capexPrev: prevCF ? mm(Math.abs(num(prevCF.capitalExpenditure) || 0)) : null,
    depreciation: latestCF ? mm(latestCF.depreciationAndAmortization) : null,
    depreciationPrev: prevCF ? mm(prevCF.depreciationAndAmortization) : null,
    rnd: latestFY ? mm(latestFY.researchAndDevelopmentExpenses) : null,
    rndPrev: prevFY ? mm(prevFY.researchAndDevelopmentExpenses) : null,
    per: r2(rtTTM?.priceToEarningsRatioTTM),
    pbr: r2(rtTTM?.priceToBookRatioTTM),
    evToEbitda: r2(kmTTM?.evToEBITDATTM),
  };

  const cashflow = latestCF
    ? {
        fiscalYear: fyLabel(latestCF.date),
        operating: mm(latestCF.netCashProvidedByOperatingActivities),
        operatingPrev: prevCF ? mm(prevCF.netCashProvidedByOperatingActivities) : null,
        investing: mm(latestCF.netCashProvidedByInvestingActivities),
        investingPrev: prevCF ? mm(prevCF.netCashProvidedByInvestingActivities) : null,
        financing: mm(latestCF.netCashProvidedByFinancingActivities),
        financingPrev: prevCF ? mm(prevCF.netCashProvidedByFinancingActivities) : null,
        cash: mm(latestCF.cashAtEndOfPeriod),
        cashPrev: prevCF ? mm(prevCF.cashAtEndOfPeriod) : null,
        freeCashFlow: mm(latestCF.freeCashFlow),
        buybacks: mm(Math.abs(num(latestCF.commonStockRepurchased) || 0)),
        dividendsPaid: mm(Math.abs(num(latestCF.netDividendsPaid) || 0)),
      }
    : null;

  // ---- 財務 (leverage, interest burden, liquidity, asset quality) ----
  const ebitdaFY = num(latestFY?.ebitda);
  const ebitFY = num(latestFY?.operatingIncome);
  const interestFY = num(latestFY?.interestExpense);
  const prevDebt = Array.isArray(balanceA) && balanceA[1] ? num(balanceA[1].totalDebt) : null;
  const avgDebt = bs && num(bs.totalDebt) !== null ? (prevDebt !== null ? (num(bs.totalDebt) + prevDebt) / 2 : num(bs.totalDebt)) : null;
  const shsNow = num(latestFY?.weightedAverageShsOutDil);
  const shsPrev = num(prevFY?.weightedAverageShsOutDil);
  const financials = bs
    ? {
        asOf: bs.date,
        period: bs.period,
        totalAssets: mm(bs.totalAssets),
        equity: mm(bs.totalStockholdersEquity),
        equityRatioPct: num(bs.totalAssets) ? pct(num(bs.totalStockholdersEquity) / num(bs.totalAssets)) : null,
        retainedEarnings: mm(bs.retainedEarnings),
        cashAndShortTerm: mm(bs.cashAndShortTermInvestments),
        totalDebt: mm(bs.totalDebt),
        netDebt: num(bs.totalDebt) !== null ? mm(num(bs.totalDebt) - (num(bs.cashAndShortTermInvestments) || 0)) : null,
        debtToEquity: num(bs.totalStockholdersEquity) > 0 ? r2(num(bs.totalDebt) / num(bs.totalStockholdersEquity)) : null,
        debtToEbitda: ebitdaFY > 0 ? r2(num(bs.totalDebt) / ebitdaFY) : null,
        netDebtToEbitda: ebitdaFY > 0 ? r2((num(bs.totalDebt) - (num(bs.cashAndShortTermInvestments) || 0)) / ebitdaFY) : null,
        interestExpense: mm(interestFY),
        interestCoverage: interestFY > 0 && ebitFY !== null ? r2(ebitFY / interestFY) : null,
        interestToEbitPct: interestFY !== null && ebitFY > 0 ? pct(interestFY / ebitFY) : null,
        avgInterestRatePct: interestFY !== null && avgDebt > 0 ? pct(interestFY / avgDebt, 2) : null,
        currentRatio: num(bs.totalCurrentLiabilities) > 0 ? r2(num(bs.totalCurrentAssets) / num(bs.totalCurrentLiabilities)) : null,
        goodwillIntangibles: mm(bs.goodwillAndIntangibleAssets),
        goodwillPct: num(bs.totalAssets) ? pct((num(bs.goodwillAndIntangibleAssets) || 0) / num(bs.totalAssets)) : null,
        sharesChangePct: shsNow && shsPrev ? pct(shsNow / shsPrev - 1) : null,
        roicPct: pct(kmTTM?.returnOnInvestedCapitalTTM),
        ebitda: mm(ebitdaFY),
        fiscalYear: latestFY ? fyLabel(latestFY.date) : null,
      }
    : null;

  // ---- segments ----
  const seg = first(segments);
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
    .map((s) => ({ date: s.date, numerator: num(s.numerator), denominator: num(s.denominator), type: s.splitType }));

  const officers = (Array.isArray(executives) ? executives : [])
    .filter((e) => e.active !== false)
    .slice(0, 12)
    .map((e) => ({ name: e.name, title: e.title, since: e.titleSince || null }));

  const peerList = (Array.isArray(peers) ? peers : [])
    .filter((p) => p.symbol && !p.symbol.includes(".") && p.symbol !== symbol && !/^[A-Z]{5}$/.test(p.symbol))
    .slice(0, 5)
    .map((p) => ({ symbol: p.symbol, name: p.companyName }));

  const latestInsider = first(insider);
  const emp = first(employees);
  const fyEnd = edgarCo?.fiscalYearEnd ? Number(edgarCo.fiscalYearEnd.slice(0, 2)) : latestFY ? month(latestFY.date) : null;
  const opMargin = latestFY && num(latestFY.revenue) ? pct(num(latestFY.operatingIncome) / num(latestFY.revenue)) : null;
  const opMarginPrev = prevFY && num(prevFY.revenue) ? pct(num(prevFY.operatingIncome) / num(prevFY.revenue)) : null;
  const salesGrowth = annual.slice(-4).map((r, i, arr) => (i === 0 ? null : { label: fyLabel(r.date), pct: num(arr[i - 1].revenue) ? pct(num(r.revenue) / num(arr[i - 1].revenue) - 1) : null })).filter(Boolean);
  const rev5 = annual.slice(-6);
  const revenueCagr5Pct = rev5.length >= 2 && num(rev5[0].revenue) > 0 ? pct(Math.pow(num(rev5[rev5.length - 1].revenue) / num(rev5[0].revenue), 1 / (rev5.length - 1)) - 1) : null;

  // ---- valuation metrics (TTM) ----
  const nextEst = (Array.isArray(estimates) ? estimates : []).filter((e) => latestFY && e.date > latestFY.date).sort((a, b) => a.date.localeCompare(b.date));
  const fwdEps = num(nextEst[0]?.epsAvg);
  const fwdEps2 = num(nextEst[1]?.epsAvg);
  const epsTTM = num(rtTTM?.netIncomePerShareTTM);
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
    price, marketCapM: mm(q.marketCap || profile.marketCap), enterpriseValueM: mm(kmTTM?.enterpriseValueTTM),
    pe: r2(rtTTM?.priceToEarningsRatioTTM), peForward: fwdEps && price ? r2(price / fwdEps) : null, peForward2: fwdEps2 && price ? r2(price / fwdEps2) : null,
    peg: r2(rtTTM?.priceToEarningsGrowthRatioTTM), pegForward: epsGrowthFwd && epsGrowthFwd > 0 && price && fwdEps ? r2(price / fwdEps / epsGrowthFwd) : null,
    ps: r2(rtTTM?.priceToSalesRatioTTM), pb: r2(rtTTM?.priceToBookRatioTTM), pfcf: r2(rtTTM?.priceToFreeCashFlowRatioTTM), pocf: r2(rtTTM?.priceToOperatingCashFlowRatioTTM),
    evSales: r2(kmTTM?.evToSalesTTM), evEbitda: r2(kmTTM?.evToEBITDATTM), evOcf: r2(kmTTM?.evToOperatingCashFlowTTM), evFcf: r2(kmTTM?.evToFreeCashFlowTTM),
    earningsYieldPct: pct(kmTTM?.earningsYieldTTM), fcfYieldPct: pct(kmTTM?.freeCashFlowYieldTTM), dividendYieldPct, payoutPct: pct(rtTTM?.dividendPayoutRatioTTM),
    epsTTM: r2(epsTTM), epsNtm: r2(epsNtm), epsForward: r2(fwdEps), epsForward2: r2(fwdEps2), epsGrowthFwdPct: r2(epsGrowthFwd), bvps: r2(rtTTM?.bookValuePerShareTTM), fcfps: r2(rtTTM?.freeCashFlowPerShareTTM), revenuePerShare: r2(rtTTM?.revenuePerShareTTM),
    grossMarginPct: pct(rtTTM?.grossProfitMarginTTM), opMarginPct: pct(rtTTM?.operatingProfitMarginTTM), netMarginPct: pct(rtTTM?.netProfitMarginTTM),
    roePct: pct(kmTTM?.returnOnEquityTTM), roicPct: pct(kmTTM?.returnOnInvestedCapitalTTM), roaPct: pct(kmTTM?.returnOnAssetsTTM),
    netDebtEbitda: r2(kmTTM?.netDebtToEBITDATTM), debtEquity: r2(rtTTM?.debtToEquityRatioTTM), interestCoverage: r2(rtTTM?.interestCoverageRatioTTM), currentRatio: r2(rtTTM?.currentRatioTTM),
    beta: r2(profile.beta), yearHigh: num(q.yearHigh), yearLow: num(q.yearLow), priceAvg50: num(q.priceAvg50), priceAvg200: num(q.priceAvg200),
    yearHighDate: hi52?.d || null, yearLowDate: lo52?.d || null, yearHighClose: hi52?.p ?? null, yearLowClose: lo52?.p ?? null,
    allTimeHigh: ath ? { price: ath.p, date: ath.d } : null,
    analystTarget: first(targets) ? { high: num(first(targets).targetHigh), low: num(first(targets).targetLow), consensus: num(first(targets).targetConsensus), upsidePct: price && num(first(targets).targetConsensus) ? r2((first(targets).targetConsensus / price - 1) * 100) : null } : null,
  };
  // ---- DCF (Damodaran FCFF) ----
  let dcf = null;
  try {
    const taxRate = latestFY && num(latestFY.incomeBeforeTax) > 0 ? (num(latestFY.incomeTaxExpense) / num(latestFY.incomeBeforeTax)) * 100 : null;
    // Accumulated operating losses from the reported years shelter early profits from tax.
    let nol = 0;
    for (const r of annual.slice(-5)) { const oi = num(r.operatingIncome) || 0; nol = oi < 0 ? nol - oi : Math.max(0, nol - oi); }
    const dcfInput = {
      price, sharesOut, dilutedShares: num(latestFY?.weightedAverageShsOutDil), marketCap: num(q.marketCap || profile.marketCap),
      totalDebt: num(bs?.totalDebt), leases: num(bs?.capitalLeaseObligations), cash: num(bs?.cashAndShortTermInvestments), nonOperatingAssets: num(bs?.longTermInvestments), minorityInterest: num(bs?.minorityInterest),
      nol, beta: num(profile.beta), riskFree: rf.rate, erp: Number(process.env.DCF_ERP || 4.5),
      latest: { revenue: num(latestFY?.revenue), ebit: num(latestFY?.operatingIncome), taxRate, interestExpense: num(latestFY?.interestExpense), investedCapital: num(km?.investedCapital) || (bs ? (num(bs.totalDebt) || 0) + (num(bs.totalStockholdersEquity) || 0) - (num(bs.cashAndShortTermInvestments) || 0) : null) },
      estimates: nextEst.map((e) => ({ date: e.date, revenue: num(e.revenueAvg), ebit: num(e.ebitAvg) })),
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
      name: profile.companyName,
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
      employees: num(emp?.employeeCount) || num(profile.fullTimeEmployees),
      employeesAsOf: emp?.periodOfReport || null,
      segments: segmentList,
      segmentsFiscalYear: seg?.fiscalYear || null,
      peers: peerList,
      competitors: competitorList,
    },
    market: {
      price,
      change: num(q.change),
      changePct: r2(q.changePercentage),
      dayHigh: num(q.dayHigh),
      dayLow: num(q.dayLow),
      yearHigh: num(q.yearHigh),
      yearLow: num(q.yearLow),
      volume: num(q.volume),
      avgVolume: num(profile.averageVolume),
      marketCapM: mm(q.marketCap || profile.marketCap),
      sharesOutstandingM: sharesOut ? Math.round(sharesOut / M) : null,
      freeFloatPct: r2(first(sharesFloat)?.freeFloat),
      beta: r2(profile.beta),
      priceAvg50: num(q.priceAvg50),
      priceAvg200: num(q.priceAvg200),
      quoteTime: q.timestamp ? new Date(q.timestamp * 1000).toISOString() : null,
      per: indicators.per,
      pbr: indicators.pbr,
      dividendYieldPct,
      bps,
      analystTarget: first(targets) ? { high: num(first(targets).targetHigh), low: num(first(targets).targetLow), consensus: num(first(targets).targetConsensus) } : null,
      analystRating: first(grades)
        ? { consensus: first(grades).consensus, buy: (num(first(grades).strongBuy) || 0) + (num(first(grades).buy) || 0), hold: num(first(grades).hold), sell: (num(first(grades).sell) || 0) + (num(first(grades).strongSell) || 0) }
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
          purchases: num(latestInsider.totalPurchases),
          sales: num(latestInsider.totalSales),
          acquiredShares: num(latestInsider.totalAcquired),
          disposedShares: num(latestInsider.totalDisposed),
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

/** Index membership and weights (S&P 500 / Nasdaq 100 / Dow 30) from FMP constituent lists and the tracking ETFs, cached daily. */
async function indexTables() {
  return cached("index-tables", 24 * 3600, async () => {
    const sets = [["S&P 500", "sp500-constituent", "SPY"], ["Nasdaq 100", "nasdaq-constituent", "QQQ"], ["Dow 30", "dowjones-constituent", "DIA"]];
    const out = {};
    const norm = (x) => String(x || "").toUpperCase().replace(/\./g, "-");
    for (const [name, listEp, etf] of sets) {
      const [list, holdings] = await Promise.all([fmpSoft(listEp, {}), fmpSoft("etf/holdings", { symbol: etf })]);
      const weights = {};
      for (const h of Array.isArray(holdings) ? holdings : []) if (h.asset && Number.isFinite(Number(h.weightPercentage))) weights[norm(h.asset)] = Number(h.weightPercentage);
      for (const c of Array.isArray(list) ? list : []) { const sym = norm(c.symbol); (out[sym] ||= []).push({ index: name, weightPct: weights[sym] ?? null }); }
    }
    return out;
  }, { version: "1" });
}

export async function indexMembership(symbol) {
  try { const t = await indexTables(); return t[String(symbol).toUpperCase().replace(/\./g, "-")] || []; } catch { return []; }
}

export async function stockBundle(symbol, { force = false } = {}) {
  return cached(`stock:${symbol}`, 12 * 3600, () => buildBundle(symbol), { version: "10", force });
}

/** Newest earnings-call transcript date FMP lists for a symbol (one light request). */
export async function latestTranscriptDate(symbol) {
  const rows = await fmpSoft("earning-call-transcript-dates", { symbol });
  const dates = (Array.isArray(rows) ? rows : []).map((t) => t.date).filter(Boolean).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

/** Light, frequently refreshed quote (5 minutes). */
export async function liveQuote(symbol) {
  return cached(`quote:${symbol}`, 300, async () => first(await fmp("quote", { symbol })) || {});
}

export async function searchSymbols(q) {
  const query = String(q || "").trim();
  if (query.length < 1) return [];
  const [bySymbol, byName] = await Promise.all([fmpSoft("search-symbol", { query, limit: 20 }), fmpSoft("search-name", { query, limit: 20 })]);
  const seen = new Set();
  const usExchange = (r) => ["NASDAQ", "NYSE", "AMEX"].some((x) => (r.exchange || "").toUpperCase().startsWith(x));
  return [...bySymbol, ...byName]
    .filter((r) => r.symbol && r.currency === "USD" && usExchange(r) && !r.symbol.includes(".") && !/-P[A-Z]?$/.test(r.symbol) && !/\b(ETF|Fund|Trust|Notes?|Warrant|Units?)\b/i.test(r.name || ""))
    .filter((r) => (seen.has(r.symbol) ? false : seen.add(r.symbol)))
    .slice(0, 8)
    .map((r) => ({ symbol: r.symbol, name: r.name, exchange: r.exchange }));
}
