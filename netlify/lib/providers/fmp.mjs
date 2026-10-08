// Financial Modeling Prep ("stable" API) implementation of the market-data contract.
// Only this file knows FMP's endpoint names and field names; it returns the normalised
// records described in CONTRACT.md.
import { cfg } from "../config.mjs";
import { ProviderError } from "./index.mjs";

export const id = "fmp";
const BASE = "https://financialmodelingprep.com/stable";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const str = (v) => (v === null || v === undefined ? null : String(v));
const list = (v) => (Array.isArray(v) ? v : []);
const first = (v) => (Array.isArray(v) && v.length ? v[0] : null);

async function call(endpoint, params = {}, { timeoutMs = 9000 } = {}) {
  // Rate limits (HTTP 429) are retried with short pauses so bursts from the warmer do not drop panels.
  for (let i = 0; ; i++) {
    try { return await once(endpoint, params, timeoutMs); }
    catch (e) { if (e instanceof ProviderError && e.status === 429 && i < 3) { await sleep([1500, 4000, 8000][i]); continue; } throw e; }
  }
}

async function once(endpoint, params, timeoutMs) {
  const url = new URL(`${BASE}/${endpoint.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  const key = cfg.fmpKey();
  if (key) url.searchParams.set("apikey", key);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "us-shikiho/0.1" } });
    if (!res.ok) throw new ProviderError(`FMP ${endpoint} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`, { status: res.status, endpoint });
    const data = await res.json();
    if (data && typeof data === "object" && !Array.isArray(data) && data["Error Message"]) throw new ProviderError(data["Error Message"], { endpoint });
    return data;
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    throw new ProviderError(`FMP ${endpoint}: ${e.message}`, { endpoint });
  } finally {
    clearTimeout(t);
  }
}

// ---- company ----
export async function profile(symbol) {
  const p = first(await call("profile", { symbol }));
  return p ? mapProfile(p) : null;
}
function mapProfile(p) {
  return {
    symbol: p.symbol, name: p.companyName || null, exchange: p.exchange || null, exchangeFullName: p.exchangeFullName || null, currency: p.currency || null,
    cik: p.cik || null, isin: p.isin || null, sector: p.sector || null, industry: p.industry || null, description: p.description || null, website: p.website || null, ceo: p.ceo || null,
    address: p.address || null, city: p.city || null, state: p.state || null, zip: p.zip || null, country: p.country || null, phone: p.phone || null, ipoDate: p.ipoDate || null,
    employees: num(p.fullTimeEmployees), marketCap: num(p.marketCap), price: num(p.price), beta: num(p.beta), averageVolume: num(p.averageVolume), changePct: num(p.changePercentage),
    isEtf: !!p.isEtf, isFund: !!p.isFund, isActivelyTrading: p.isActivelyTrading !== false,
  };
}

const mapQuote = (q) => ({
  symbol: q.symbol, name: q.name || null, price: num(q.price), change: num(q.change), changePct: num(q.changePercentage), volume: num(q.volume),
  dayLow: num(q.dayLow), dayHigh: num(q.dayHigh), yearHigh: num(q.yearHigh), yearLow: num(q.yearLow), marketCap: num(q.marketCap),
  priceAvg50: num(q.priceAvg50), priceAvg200: num(q.priceAvg200), exchange: q.exchange || null, open: num(q.open), previousClose: num(q.previousClose),
  time: q.timestamp ? new Date(Number(q.timestamp) * 1000).toISOString() : null, sharesOutstanding: num(q.sharesOutstanding),
});
export async function quote(symbol) { const q = first(await call("quote", { symbol })); return q ? mapQuote(q) : null; }
export async function quotes(symbols) {
  if (!symbols.length) return [];
  return list(await call("batch-quote", { symbols: symbols.join(",") })).filter((q) => q && q.symbol).map(mapQuote);
}

// ---- statements (raw USD) ----
const mapIncome = (r) => ({
  date: r.date, fiscalYear: str(r.fiscalYear), period: r.period || null, revenue: num(r.revenue), grossProfit: num(r.grossProfit), operatingIncome: num(r.operatingIncome),
  pretaxIncome: num(r.incomeBeforeTax), netIncome: num(r.netIncome), eps: num(r.eps), epsDiluted: num(r.epsDiluted), ebitda: num(r.ebitda), interestExpense: num(r.interestExpense),
  incomeTax: num(r.incomeTaxExpense), rnd: num(r.researchAndDevelopmentExpenses), sga: num(r.sellingGeneralAndAdministrativeExpenses), dilutedShares: num(r.weightedAverageShsOutDil), sharesOut: num(r.weightedAverageShsOut),
});
export async function incomeStatements(symbol, { period = "annual", limit = 10 } = {}) { return list(await call("income-statement", { symbol, period, limit })).map(mapIncome); }

const mapBalance = (r) => ({
  date: r.date, fiscalYear: str(r.fiscalYear), period: r.period || null, totalAssets: num(r.totalAssets), equity: num(r.totalStockholdersEquity), retainedEarnings: num(r.retainedEarnings),
  cashAndShortTerm: num(r.cashAndShortTermInvestments), totalDebt: num(r.totalDebt), netDebt: num(r.netDebt), currentAssets: num(r.totalCurrentAssets), currentLiabilities: num(r.totalCurrentLiabilities),
  goodwillAndIntangibles: num(r.goodwillAndIntangibleAssets), leases: num(r.capitalLeaseObligations), longTermInvestments: num(r.longTermInvestments), minorityInterest: num(r.minorityInterest),
});
export async function balanceSheets(symbol, { period = "annual", limit = 2 } = {}) { return list(await call("balance-sheet-statement", { symbol, period, limit })).map(mapBalance); }

const mapCash = (r) => ({
  date: r.date, fiscalYear: str(r.fiscalYear), period: r.period || null, operating: num(r.netCashProvidedByOperatingActivities ?? r.operatingCashFlow), investing: num(r.netCashProvidedByInvestingActivities),
  financing: num(r.netCashProvidedByFinancingActivities), cashEnd: num(r.cashAtEndOfPeriod), freeCashFlow: num(r.freeCashFlow), capex: num(r.capitalExpenditure), depreciation: num(r.depreciationAndAmortization),
  buybacks: num(r.commonStockRepurchased), dividendsPaid: num(r.netDividendsPaid), commonDividendsPaid: num(r.commonDividendsPaid), acquisitions: num(r.acquisitionsNet),
});
export async function cashFlows(symbol, { period = "annual", limit = 10 } = {}) { return list(await call("cash-flow-statement", { symbol, period, limit })).map(mapCash); }

const mapMetrics = (r) => ({
  date: r.date, fiscalYear: str(r.fiscalYear), roe: num(r.returnOnEquity), roa: num(r.returnOnAssets), roic: num(r.returnOnInvestedCapital), investedCapital: num(r.investedCapital),
  capexToRevenue: num(r.capexToRevenue), rndToRevenue: num(r.researchAndDevelopementToRevenue), sgaToRevenue: num(r.salesGeneralAndAdministrativeToRevenue), evToEbitda: num(r.evToEBITDA),
});
export async function keyMetrics(symbol, { period = "annual", limit = 2 } = {}) { return list(await call("key-metrics", { symbol, period, limit })).map(mapMetrics); }

export async function keyMetricsTtm(symbol) {
  const k = first(await call("key-metrics-ttm", { symbol }));
  return k ? {
    roe: num(k.returnOnEquityTTM), roa: num(k.returnOnAssetsTTM), roic: num(k.returnOnInvestedCapitalTTM), enterpriseValue: num(k.enterpriseValueTTM), evToSales: num(k.evToSalesTTM), evToEbitda: num(k.evToEBITDATTM),
    evToOcf: num(k.evToOperatingCashFlowTTM), evToFcf: num(k.evToFreeCashFlowTTM), earningsYield: num(k.earningsYieldTTM), fcfYield: num(k.freeCashFlowYieldTTM), netDebtToEbitda: num(k.netDebtToEBITDATTM),
    rndToRevenue: num(k.researchAndDevelopementToRevenueTTM), sgaToRevenue: num(k.salesGeneralAndAdministrativeToRevenueTTM), capexToRevenue: num(k.capexToRevenueTTM), inventoryDays: num(k.daysOfInventoryOutstandingTTM), investedCapital: num(k.investedCapitalTTM),
  } : null;
}
export async function ratiosTtm(symbol) {
  const r = first(await call("ratios-ttm", { symbol }));
  return r ? {
    pe: num(r.priceToEarningsRatioTTM), peg: num(r.priceToEarningsGrowthRatioTTM), pb: num(r.priceToBookRatioTTM), ps: num(r.priceToSalesRatioTTM), pfcf: num(r.priceToFreeCashFlowRatioTTM), pocf: num(r.priceToOperatingCashFlowRatioTTM),
    payout: num(r.dividendPayoutRatioTTM), epsTtm: num(r.netIncomePerShareTTM), bvps: num(r.bookValuePerShareTTM), fcfps: num(r.freeCashFlowPerShareTTM), revenuePerShare: num(r.revenuePerShareTTM),
    grossMargin: num(r.grossProfitMarginTTM), opMargin: num(r.operatingProfitMarginTTM), netMargin: num(r.netProfitMarginTTM), debtToEquity: num(r.debtToEquityRatioTTM), interestCoverage: num(r.interestCoverageRatioTTM),
    currentRatio: num(r.currentRatioTTM), assetTurnover: num(r.assetTurnoverTTM),
  } : null;
}
export async function incomeGrowth(symbol) {
  const g = first(await call("income-statement-growth", { symbol, limit: 1 }));
  return g ? { date: g.date, revenueGrowth: num(g.growthRevenue), operatingIncomeGrowth: num(g.growthOperatingIncome) } : null;
}

// ---- corporate actions, people, estimates ----
export async function dividends(symbol, limit = 60) {
  return list(await call("dividends", { symbol, limit })).map((d) => ({ date: d.date, paymentDate: d.paymentDate || null, amount: num(d.adjDividend ?? d.dividend), frequency: d.frequency || null }));
}
export async function splits(symbol) {
  return list(await call("splits", { symbol })).map((s) => ({ date: s.date, numerator: num(s.numerator), denominator: num(s.denominator), type: s.splitType || null }));
}
export async function executives(symbol) {
  return list(await call("key-executives", { symbol })).map((e) => ({ name: e.name, title: e.title, since: e.titleSince || null, active: e.active !== false }));
}
export async function estimates(symbol, limit = 12) {
  return list(await call("analyst-estimates", { symbol, period: "annual", limit })).map((e) => ({ date: e.date, revenue: num(e.revenueAvg), ebit: num(e.ebitAvg), netIncome: num(e.netIncomeAvg), eps: num(e.epsAvg), analysts: num(e.numAnalystsEps) }));
}
export async function peers(symbol) {
  return list(await call("stock-peers", { symbol })).map((p) => ({ symbol: p.symbol, name: p.companyName || null }));
}
export async function employees(symbol) {
  const e = first(await call("employee-count", { symbol, limit: 1 }));
  return e ? { count: num(e.employeeCount), asOf: e.periodOfReport || null } : null;
}
export async function sharesFloat(symbol) {
  const s = first(await call("shares-float", { symbol }));
  return s ? { outstanding: num(s.outstandingShares), freeFloatPct: num(s.freeFloat) } : null;
}
const mapSeg = (r) => ({ fiscalYear: r.fiscalYear ?? null, date: r.date || null, data: r.data && typeof r.data === "object" ? r.data : {} });
export async function revenueSegments(symbol, limit = 1) { return list(await call("revenue-product-segmentation", { symbol, limit })).map(mapSeg); }
export async function revenueGeography(symbol, limit = 2) { return list(await call("revenue-geographic-segmentation", { symbol, structure: "flat" })).slice(0, limit).map(mapSeg); }
export async function earnings(symbol, limit = 8) {
  return list(await call("earnings", { symbol, limit })).map((e) => ({ date: e.date, epsActual: num(e.epsActual), epsEstimated: num(e.epsEstimated), revenueActual: num(e.revenueActual), revenueEstimated: num(e.revenueEstimated) }));
}
export async function analystRating(symbol) {
  const g = first(await call("grades-consensus", { symbol }));
  return g ? { consensus: g.consensus || null, strongBuy: num(g.strongBuy), buy: num(g.buy), hold: num(g.hold), sell: num(g.sell), strongSell: num(g.strongSell) } : null;
}
export async function priceTarget(symbol) {
  const t = first(await call("price-target-consensus", { symbol }));
  return t ? { high: num(t.targetHigh), low: num(t.targetLow), consensus: num(t.targetConsensus) } : null;
}
export async function insiderStats(symbol) {
  const i = first(await call("insider-trading/statistics", { symbol }));
  return i ? { year: num(i.year), quarter: num(i.quarter), purchases: num(i.totalPurchases), sales: num(i.totalSales), acquiredShares: num(i.totalAcquired), disposedShares: num(i.totalDisposed) } : null;
}

// ---- transcripts, prices, holders ----
export async function transcriptDates(symbol) {
  return list(await call("earning-call-transcript-dates", { symbol })).map((t) => ({ fiscalYear: num(t.fiscalYear), quarter: num(t.quarter), date: t.date || null }));
}
export async function transcript(symbol, fiscalYear, quarter) {
  const r = first(await call("earning-call-transcript", { symbol, year: fiscalYear, quarter }));
  return r && r.content ? { date: r.date || null, content: String(r.content) } : null;
}
export async function dailyPrices(symbol, from) {
  return list(await call("historical-price-eod/light", { symbol, from })).map((r) => ({ date: r.date, close: num(r.price), volume: num(r.volume) }));
}
export async function institutionalHolders(symbol, year, quarter, limit = 10) {
  return list(await call("institutional-ownership/extract-analytics/holder", { symbol, year, quarter, limit })).map((h) => ({ name: h.investorName, shares: num(h.sharesNumber), ownershipPct: num(h.ownership), changeShares: num(h.changeInSharesNumber), date: h.date || null }));
}
export async function institutionalSummary(symbol, year, quarter) {
  const s = first(await call("institutional-ownership/symbol-positions-summary", { symbol, year, quarter }));
  return s ? { investorsHolding: num(s.investorsHolding), ownershipPct: num(s.ownershipPercent), newPositions: num(s.newPositions), closedPositions: num(s.closedPositions), increased: num(s.increasedPositions), reduced: num(s.reducedPositions) } : null;
}
export async function screenIndustry(industry, limit = 15) {
  return list(await call("company-screener", { industry, exchange: "NASDAQ,NYSE,AMEX", limit, isEtf: false, isFund: false })).map((r) => ({ symbol: r.symbol, name: r.companyName || null }));
}
export async function treasury10y() {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  const r = first(await call("treasury-rates", { from, to }));
  return r ? { rate: num(r.year10), date: r.date } : null;
}
export async function news(symbol, limit = 30) {
  return list(await call("news/stock", { symbols: symbol, limit })).map((n) => ({ date: n.publishedDate || null, publisher: n.publisher || n.site || null, title: n.title || "", text: n.text || null, url: n.url || null }));
}
export async function compensation(symbol) {
  return list(await call("governance-executive-compensation", { symbol })).map((r) => ({ year: num(r.year), name: r.nameAndPosition, total: num(r.total), salary: num(r.salary), stockAward: num(r.stockAward), incentive: num(r.incentivePlanCompensation) }));
}
export async function search(query, limit = 20) {
  const [bySymbol, byName] = await Promise.all([call("search-symbol", { query, limit }).catch(() => []), call("search-name", { query, limit }).catch(() => [])]);
  return [...list(bySymbol), ...list(byName)].map((r) => ({ symbol: r.symbol, name: r.name || null, exchange: r.exchange || null, currency: r.currency || null }));
}
const INDEX_ENDPOINTS = { sp500: "sp500-constituent", nasdaq100: "nasdaq-constituent", dow30: "dowjones-constituent" };
export async function indexConstituents(index) {
  const ep = INDEX_ENDPOINTS[index];
  if (!ep) throw new ProviderError(`unknown index ${index}`);
  return list(await call(ep, {})).map((c) => ({ symbol: c.symbol, name: c.name || null, sector: c.sector || null, subSector: c.subSector || null }));
}
export async function etfHoldings(etf) {
  return list(await call("etf/holdings", { symbol: etf })).filter((h) => h.asset).map((h) => ({ symbol: h.asset, weightPct: num(h.weightPercentage) }));
}
export async function health() {
  const p = await profile("AAPL");
  return { ok: !!(p && p.name), detail: p ? p.name : "no profile" };
}
