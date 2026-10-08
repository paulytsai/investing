// Deep-dive fundamental analysis (the fifth tab): generated in English from the
// transcripts, financials, geography, peer metrics and news, then translated.
import { fmpSoft } from "./fmp.mjs";
import { openStore } from "./store.mjs";
import { logEvent } from "./events.mjs";
import { runJson, fetchTranscripts, financialDigest, newsDigest, getCachedSummary } from "./summarize.mjs";
import { deepSystemPrompt, translateDeepPrompt, DEEP_SCHEMA } from "./prompts.mjs";

const VERSION = "d2";
const TRANSLATION_VERSION = "1";
const PIECES = ["narrative", "profitPools", "costPosition", "industry", "demand", "newMarkets"];
const filled = (v, min = 1) => typeof v === "string" && v.trim().length >= min;

export function deepKey(symbol, lang, latestTranscriptDate) {
  const v = lang === "en" ? VERSION : `${VERSION}t${TRANSLATION_VERSION}`;
  return `deep:${v}:${symbol}:${lang}:${latestTranscriptDate || "none"}`;
}

export function isDeepComplete(rec) {
  if (!rec || !Array.isArray(rec.battlefields) || rec.battlefields.length < 2) return false;
  if (rec.battlefields.some((b) => ["segment", "revenueShare", "competitors", "purchaseCriteria", "position"].some((k) => !filled(b[k], 3)))) return false;
  for (const k of PIECES) { const p = rec[k]; if (!p || !filled(p.headline, 3) || !filled(p.body, 120)) return false; }
  if (!filled(rec.caveats, 15)) return false;
  return true;
}

export async function getCachedDeep(symbol, lang, latestTranscriptDate) {
  const store = await openStore("summaries");
  const rec = await store.get(deepKey(symbol, lang, latestTranscriptDate));
  return isDeepComplete(rec) ? rec : null;
}

const pct = (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? "-" : `${(Number(v) * 100).toFixed(1)}%`);
const dec = (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? "-" : Number(v).toFixed(2));

/** Peer operating metrics (TTM) for the company and its closest competitors. */
async function peerTable(symbol, bundle) {
  const en = await getCachedSummary(symbol, "en", bundle.latestTranscriptDate).catch(() => null);
  const peers = ((en && en.competitors) || bundle.company.competitors || []).map((c) => c.symbol).filter(Boolean).slice(0, 8);
  const rows = await Promise.all([symbol, ...peers].map(async (s) => {
    const [r, k, g] = await Promise.all([fmpSoft("ratios-ttm", { symbol: s }), fmpSoft("key-metrics-ttm", { symbol: s }), fmpSoft("income-statement-growth", { symbol: s, limit: 1 })]);
    const R = Array.isArray(r) ? r[0] : null, K = Array.isArray(k) ? k[0] : null, G = Array.isArray(g) ? g[0] : null;
    if (!R && !K) return null;
    return `${s}${s === symbol ? " (this company)" : ""}: gross margin ${pct(R?.grossProfitMarginTTM)}, operating margin ${pct(R?.operatingProfitMarginTTM)}, net margin ${pct(R?.netProfitMarginTTM)}, R&D/revenue ${pct(K?.researchAndDevelopementToRevenueTTM)}, SG&A/revenue ${pct(K?.salesGeneralAndAdministrativeToRevenueTTM)}, capex/revenue ${pct(K?.capexToRevenueTTM)}, asset turnover ${dec(R?.assetTurnoverTTM)}, inventory days ${dec(K?.daysOfInventoryOutstandingTTM)}, ROIC ${pct(K?.returnOnInvestedCapitalTTM)}, EV/EBITDA ${dec(K?.evToEBITDATTM)}, revenue growth (latest FY) ${pct(G?.growthRevenue)}, operating income growth ${pct(G?.growthOperatingIncome)}`;
  }));
  return rows.filter(Boolean).join("\n") || "(no peer data)";
}

/** Revenue by geography for the last two fiscal years. */
async function geoDigest(symbol) {
  const rows = await fmpSoft("revenue-geographic-segmentation", { symbol, structure: "flat" });
  const list = (Array.isArray(rows) ? rows : []).slice(0, 2);
  return list.map((r) => { const total = Object.values(r.data || {}).reduce((a, v) => a + (Number(v) || 0), 0); return `FY${r.fiscalYear}: ${Object.entries(r.data || {}).map(([k, v]) => `${k} ${Math.round(Number(v) / 1e6)}M (${total ? ((Number(v) / total) * 100).toFixed(0) : "?"}%)`).join(", ")}`; }).join("\n") || "(none)";
}

export async function generateDeepEnglish(symbol, bundle) {
  const [transcripts, news, peers, geo] = await Promise.all([
    fetchTranscripts(symbol, bundle.transcripts || []),
    fmpSoft("news/stock", { symbols: symbol, limit: 30 }),
    peerTable(symbol, bundle).catch(() => "(no peer data)"),
    geoDigest(symbol).catch(() => "(none)"),
  ]);
  const materials = [
    "## Financial data", financialDigest(bundle), "",
    "## Revenue by geography", geo, "",
    "## Peer metrics (trailing twelve months, from Financial Modeling Prep)", peers, "",
    "## Business description", bundle.company.businessSummary || bundle.company.description || "(none)", "",
    "## Recent news (newest first)", newsDigest(news) || "(none)", "",
    ...transcripts.flatMap((t) => [`## Earnings call transcript — ${t.period} (${t.date})`, t.content, ""]),
  ].join("\n");
  const request = (extra) => runJson({
    system: deepSystemPrompt(),
    user: `Write the fundamental analysis for ${bundle.company.name} (${symbol}). Return JSON only.${extra}\n\n${materials}`,
    schema: DEEP_SCHEMA, effort: "high", maxTokens: 12000,
  });
  let { parsed, message } = await request("");
  if (!isDeepComplete(parsed)) {
    console.warn(`incomplete deep analysis for ${symbol}; retrying`);
    ({ parsed, message } = await request(" Every field must be filled in full with substantive text; empty or placeholder strings are not acceptable."));
    if (!isDeepComplete(parsed)) throw new Error("Model returned an incomplete analysis");
  }
  const record = {
    symbol, lang: "en", ...parsed,
    transcriptsUsed: transcripts.map((t) => ({ period: t.period, date: t.date })),
    model: message.model, generatedAt: new Date().toISOString(),
    usage: { input: message.usage?.input_tokens, output: message.usage?.output_tokens },
  };
  const store = await openStore("summaries");
  await store.set(deepKey(symbol, "en", bundle.latestTranscriptDate), record);
  await logEvent("ai_deep", { detail: `${symbol}_${message.usage?.input_tokens || 0}_${message.usage?.output_tokens || 0}` });
  return record;
}

export async function translateDeep(en, lang, bundle) {
  const source = { narrative: en.narrative, battlefields: en.battlefields, profitPools: en.profitPools, costPosition: en.costPosition, industry: en.industry, demand: en.demand, newMarkets: en.newMarkets, caveats: en.caveats };
  const { parsed, message } = await runJson({
    system: translateDeepPrompt(lang),
    user: `Translate this JSON. Return JSON only.\n\n${JSON.stringify(source)}`,
    schema: DEEP_SCHEMA, effort: "medium", maxTokens: 12000,
  });
  if (!isDeepComplete(parsed)) throw new Error(`Translation to ${lang} came back incomplete`);
  const record = { ...en, ...parsed, lang, translatedFrom: "en", model: message.model, generatedAt: new Date().toISOString(), usage: { input: message.usage?.input_tokens, output: message.usage?.output_tokens } };
  const store = await openStore("summaries");
  await store.set(deepKey(en.symbol, lang, bundle.latestTranscriptDate), record);
  await logEvent("ai_translate", { detail: `${en.symbol}_deep_${lang}` });
  return record;
}

export async function ensureDeep(symbol, lang, bundle) {
  let en = await getCachedDeep(symbol, "en", bundle.latestTranscriptDate);
  if (!en) en = await generateDeepEnglish(symbol, bundle);
  if (lang === "en") return en;
  const existing = await getCachedDeep(symbol, lang, bundle.latestTranscriptDate);
  if (existing) return existing;
  return translateDeep(en, lang, bundle);
}
