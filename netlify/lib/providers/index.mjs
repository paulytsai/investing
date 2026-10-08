// Market-data provider selection. Everything outside this directory calls the methods
// listed in CONTRACT.md on the object returned by provider(); nothing else knows which
// vendor is behind it. To switch vendors, implement the contract in a new file (start
// from template.mjs), register it in REGISTRY and set MARKET_DATA_PROVIDER.
import * as fmp from "./fmp.mjs";

const REGISTRY = { fmp };

export class ProviderError extends Error {
  constructor(msg, { status = null, endpoint = null } = {}) {
    super(msg);
    this.name = "ProviderError";
    this.status = status;
    this.endpoint = endpoint;
  }
}

export function providerId() {
  const id = (process.env.MARKET_DATA_PROVIDER || "fmp").trim().toLowerCase();
  if (!REGISTRY[id]) throw new Error(`Unknown MARKET_DATA_PROVIDER "${id}" (known: ${Object.keys(REGISTRY).join(", ")})`);
  return id;
}

export function provider() {
  return REGISTRY[providerId()];
}

/** Resolve to `fallback` when an optional panel's request fails, logging the reason. */
export async function soft(promise, fallback = []) {
  try {
    return await promise;
  } catch (e) {
    console.warn(`market data soft failure: ${e.message}`);
    return fallback;
  }
}

/** Every method a provider must export, used by tests and the health check. */
export const CONTRACT = [
  "profile", "quote", "quotes", "incomeStatements", "balanceSheets", "cashFlows", "keyMetrics", "keyMetricsTtm", "ratios", "ratiosTtm", "incomeGrowth",
  "dividends", "splits", "executives", "estimates", "peers", "employees", "sharesFloat", "revenueSegments", "revenueGeography", "earnings",
  "analystRating", "priceTarget", "insiderStats", "transcriptDates", "transcript", "dailyPrices", "institutionalHolders", "institutionalSummary",
  "screenIndustry", "treasury10y", "news", "compensation", "search", "indexConstituents", "etfHoldings", "health",
];
