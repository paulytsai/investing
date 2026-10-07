// edgar.tools REST client (SEC filing record). https://api.edgar.tools/v1
import { cfg } from "./config.mjs";

const BASE = "https://api.edgar.tools/v1";

export async function edgar(path, params = {}, { timeoutMs = 9000 } = {}) {
  const url = new URL(`${BASE}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  const headers = { accept: "application/json", "user-agent": "us-shikiho/0.1" };
  const key = cfg.edgarKey();
  if (key) headers.authorization = `Bearer ${key}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      throw new Error(`edgar.tools ${path} HTTP ${res.status}: ${body}`);
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export async function edgarSoft(path, params, fallback = null) {
  try {
    return await edgar(path, params);
  } catch (e) {
    console.warn(`edgar.tools soft failure ${path}: ${e.message}`);
    return fallback;
  }
}

/** Company profile by ticker: cik, sic, state of incorporation, fiscal year end, 10-K business summary. */
export async function edgarCompany(symbol) {
  const data = await edgarSoft(`companies/${encodeURIComponent(symbol)}`);
  const c = data?.entity?.company;
  if (!c) return null;
  return {
    cik: c.cik,
    name: c.name,
    sicCode: c.sic_code,
    sicDescription: c.sic_description,
    sector: c.sector,
    industry: c.ff_industry_48_desc || c.ff_industry_12_desc,
    filerCategory: c.category,
    stateOfIncorporation: c.state_of_incorporation,
    fiscalYearEnd: c.fiscal_year_end, // "MMDD"
    businessSummary: c.business_summary,
    summaryFilingDate: c.summary_filing_date,
    exchanges: (data.entity.tickers || []).map((t) => t.exchange),
  };
}

export async function edgarFilings(cik, { form, limit = 10 } = {}) {
  const data = await edgarSoft(`companies/${cik}/filings`, { form, limit });
  return (data?.filings || []).map((f) => ({
    accession: f.accession_number,
    form: f.form,
    filingDate: f.filing_date,
    description: f.description,
    url: f.sec_url,
  }));
}

export async function edgarMaterialEvents(cik, { days = 365, limit = 12 } = {}) {
  const data = await edgarSoft(`companies/${cik}/material-events`, { days, limit });
  return (data?.events || []).map((e) => ({
    accession: e.accession,
    filingDate: e.filing_date,
    form: e.form,
    isAmendment: !!e.is_amendment,
    items: e.items || [],
    description: e.description,
  }));
}

export async function edgarRatios(cik) {
  const data = await edgarSoft(`companies/${cik}/ratios`);
  return data?.ratios || null;
}
