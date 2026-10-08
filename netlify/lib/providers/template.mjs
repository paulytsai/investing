// Skeleton for a new market-data provider. Copy this file, implement every method with the
// shapes documented in CONTRACT.md (raw USD amounts, ratios as fractions, dates as
// "YYYY-MM-DD", null for anything the vendor does not have, arrays newest first unless the
// contract says otherwise), register it in index.mjs and set MARKET_DATA_PROVIDER.
import { ProviderError } from "./index.mjs";

const todo = (name) => { throw new ProviderError(`${name} is not implemented by this provider`); };

export const id = "template";
export async function profile(symbol) { return todo("profile"); }
export async function quote(symbol) { return todo("quote"); }
export async function quotes(symbols) { return todo("quotes"); }
export async function incomeStatements(symbol, { period = "annual", limit = 10 } = {}) { return todo("incomeStatements"); }
export async function balanceSheets(symbol, { period = "annual", limit = 2 } = {}) { return todo("balanceSheets"); }
export async function cashFlows(symbol, { period = "annual", limit = 10 } = {}) { return todo("cashFlows"); }
export async function keyMetrics(symbol, { period = "annual", limit = 2 } = {}) { return todo("keyMetrics"); }
export async function keyMetricsTtm(symbol) { return todo("keyMetricsTtm"); }
export async function ratios(symbol, { period = "annual", limit = 10 } = {}) { return todo("ratios"); }
export async function ratiosTtm(symbol) { return todo("ratiosTtm"); }
export async function incomeGrowth(symbol) { return todo("incomeGrowth"); }
export async function dividends(symbol, limit = 60) { return todo("dividends"); }
export async function splits(symbol) { return todo("splits"); }
export async function executives(symbol) { return todo("executives"); }
export async function estimates(symbol, limit = 12) { return todo("estimates"); }
export async function peers(symbol) { return todo("peers"); }
export async function employees(symbol) { return todo("employees"); }
export async function sharesFloat(symbol) { return todo("sharesFloat"); }
export async function revenueSegments(symbol, limit = 1) { return todo("revenueSegments"); }
export async function revenueGeography(symbol, limit = 2) { return todo("revenueGeography"); }
export async function earnings(symbol, limit = 8) { return todo("earnings"); }
export async function analystRating(symbol) { return todo("analystRating"); }
export async function priceTarget(symbol) { return todo("priceTarget"); }
export async function insiderStats(symbol) { return todo("insiderStats"); }
export async function transcriptDates(symbol) { return todo("transcriptDates"); }
export async function transcript(symbol, fiscalYear, quarter) { return todo("transcript"); }
export async function dailyPrices(symbol, from) { return todo("dailyPrices"); }
export async function institutionalHolders(symbol, year, quarter, limit = 10) { return todo("institutionalHolders"); }
export async function institutionalSummary(symbol, year, quarter) { return todo("institutionalSummary"); }
export async function screenIndustry(industry, limit = 15) { return todo("screenIndustry"); }
export async function treasury10y() { return todo("treasury10y"); }
export async function news(symbol, limit = 30) { return todo("news"); }
export async function compensation(symbol) { return todo("compensation"); }
export async function search(query, limit = 20) { return todo("search"); }
export async function indexConstituents(index) { return todo("indexConstituents"); }
export async function etfHoldings(etf) { return todo("etfHoldings"); }
export async function health() { return { ok: false, detail: "template provider" }; }
