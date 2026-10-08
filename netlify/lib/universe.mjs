// Tickers to pre-generate. S&P 100 constituents, plus WARM_SYMBOLS from the environment.
export const SP100 = [
  "AAPL", "ABBV", "ABT", "ACN", "ADBE", "AIG", "AMD", "AMGN", "AMT", "AMZN", "AVGO", "AXP", "BA", "BAC", "BK", "BKNG", "BLK", "BMY", "BRK-B", "C",
  "CAT", "CHTR", "CL", "CMCSA", "COF", "COP", "COST", "CRM", "CSCO", "CVS", "CVX", "DE", "DHR", "DIS", "DUK", "EMR", "FDX", "GD", "GE", "GILD",
  "GM", "GOOG", "GOOGL", "GS", "HD", "HON", "IBM", "INTC", "INTU", "ISRG", "JNJ", "JPM", "KO", "LIN", "LLY", "LMT", "LOW", "MA", "MCD", "MDLZ",
  "MDT", "MET", "META", "MMM", "MO", "MRK", "MS", "MSFT", "NEE", "NFLX", "NKE", "NOW", "NVDA", "ORCL", "PEP", "PFE", "PG", "PLTR", "PM", "PYPL",
  "QCOM", "RTX", "SBUX", "SCHW", "SO", "SPG", "T", "TGT", "TMO", "TMUS", "TSLA", "TXN", "UBER", "UNH", "UNP", "UPS", "USB", "V", "VZ", "WFC", "WMT", "XOM",
];

import { sectorSymbols, sp500BySector } from "./sectors.mjs";

/** Static part of the universe: S&P 100, the curated AI names and WARM_SYMBOLS. */
export function baseUniverse() {
  const extra = String(process.env.WARM_SYMBOLS || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (process.env.WARM_ONLY_EXTRA === "1") return extra; // testing: restrict to WARM_SYMBOLS
  return [...new Set([...extra, ...SP100, ...sectorSymbols()])];
}

/**
 * Tickers to pre-generate: the static names first, then every other current S&P 500
 * constituent (from the market-data provider, cached a day). Falls back to the static list
 * when the index list is unavailable.
 */
/** The whole coverage universe (S&P 500 + the static names), whether or not pre-generation is switched on. */
export async function fullUniverse() {
  const base = baseUniverse();
  if (process.env.WARM_ONLY_EXTRA === "1") return base;
  let rest = [];
  try { rest = Object.values(await sp500BySector()).flat().sort(); } catch (e) { console.warn("S&P 500 list unavailable:", e.message); }
  return [...new Set([...base, ...rest])];
}

/** What the warmer actually works through: the full universe when WARM_SP500=1, otherwise only the static names. */
export async function warmUniverse() {
  if (process.env.WARM_SP500 !== "1") return baseUniverse(); // S&P 500 pre-generation is off unless WARM_SP500=1 (about $1 per new ticker)
  return fullUniverse();
}

export function sp500WarmingOn() { return process.env.WARM_SP500 === "1"; }
