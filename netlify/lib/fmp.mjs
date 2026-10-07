// Financial Modeling Prep "stable" API client.
import { cfg } from "./config.mjs";

const BASE = "https://financialmodelingprep.com/stable";

export class FmpError extends Error {}

export async function fmp(endpoint, params = {}, { timeoutMs = 9000 } = {}) {
  const url = new URL(`${BASE}/${endpoint.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  const key = cfg.fmpKey();
  if (key) url.searchParams.set("apikey", key);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "us-shikiho/0.1" } });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      throw new FmpError(`FMP ${endpoint} HTTP ${res.status}: ${body}`);
    }
    const data = await res.json();
    if (data && typeof data === "object" && !Array.isArray(data) && data["Error Message"]) {
      throw new FmpError(data["Error Message"]);
    }
    return data;
  } finally {
    clearTimeout(t);
  }
}

/** Same as fmp() but resolves to `fallback` on failure (used for optional panels). */
export async function fmpSoft(endpoint, params, fallback = []) {
  try {
    return await fmp(endpoint, params);
  } catch (e) {
    console.warn(`FMP soft failure ${endpoint}: ${e.message}`);
    return fallback;
  }
}

export function first(arr) {
  return Array.isArray(arr) && arr.length ? arr[0] : null;
}
