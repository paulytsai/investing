// The plain-language read: five short sentences for someone new to stocks, written in the
// reader's language from the English digest plus code-computed facts. Cached per ticker,
// language and transcript date, like the digest itself.
import { openStore } from "./store.mjs";
import { cfg } from "./config.mjs";
import { runJson, getCachedSummary } from "./summarize.mjs";
import { getCachedDeep } from "./deep.mjs";
import { logEvent } from "./events.mjs";

const VERSION = "1";
const LANG_NAMES = { ja: "Japanese", en: "English", "zh-TW": "Traditional Chinese (Taiwan)" };
export const SIMPLE_KEYS = ["what", "growth", "profit", "price", "watch"];
const SCHEMA = { type: "object", additionalProperties: false, required: SIMPLE_KEYS, properties: Object.fromEntries(SIMPLE_KEYS.map((k) => [k, { type: "string" }])) };

export function simpleKey(symbol, lang, latestTranscriptDate) { return `simple:${VERSION}:${symbol}:${lang}:${latestTranscriptDate || "none"}`; }

const n1 = (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v).toFixed(1));

/** Facts the model may use, all computed here; nothing for it to calculate. */
export function simpleFacts(bundle) {
  const v = bundle.valuation || {}, m = bundle.market || {}, g = bundle.growth || {};
  const sg = (g.salesGrowth || []).slice(-1)[0];
  const pe5 = v.history && v.history.range5 && v.history.range5.pe;
  const where = pe5 && pe5.now != null ? (pe5.now < pe5.low ? "below its 5-year range" : pe5.now > pe5.high ? "above its 5-year range" : pe5.percentile != null ? (pe5.percentile <= 33 ? "near the low end of its 5-year range" : pe5.percentile >= 67 ? "near the high end of its 5-year range" : "in the middle of its 5-year range") : "inside its 5-year range") : null;
  return {
    company: bundle.company.name, symbol: bundle.symbol, price: m.price, marketCapM: m.marketCapM,
    revenueGrowthPct: sg ? n1(sg.pct) : null, revenueGrowthPeriod: sg ? `FY${sg.label}` : null, revenueCagr5Pct: n1(g.revenueCagr5Pct),
    operatingMarginPct: n1(g.operatingMarginPct), netMarginPct: n1(v.netMarginPct), roicPct: n1(v.roicPct),
    pe: n1(v.pe), peForward: n1(v.peForward), peRange5: pe5 ? { low: n1(pe5.low), median: n1(pe5.median), high: n1(pe5.high), where } : null,
    dividendYieldPct: n1(v.dividendYieldPct), netDebtEbitda: n1(v.netDebtEbitda), fcfYieldPct: n1(v.fcfYieldPct),
    analystConsensus: m.analystRating ? m.analystRating.consensus : null, nextEarnings: bundle.nextEarnings || null,
  };
}

export async function getCachedSimple(symbol, lang, latestTranscriptDate) {
  const store = await openStore("summaries");
  const rec = await store.get(simpleKey(symbol, lang, latestTranscriptDate));
  return rec && SIMPLE_KEYS.every((k) => typeof rec[k] === "string" && rec[k].trim().length > 10) ? rec : null;
}

/** Cached record, or generate it now (a few seconds on Sonnet) when the English digest exists; null when the digest is not ready yet. */
export async function ensureSimple(symbol, lang, bundle) {
  const date = bundle.latestTranscriptDate;
  const existing = await getCachedSimple(symbol, lang, date);
  if (existing) return existing;
  const en = await getCachedSummary(symbol, "en", date);
  if (!en) return null;
  const deep = (await getCachedDeep(symbol, "en", date).catch(() => null)) || null;
  const facts = simpleFacts(bundle);
  const labels = deep && deep.findings ? { quality: deep.findings.quality.assessment, trajectory: deep.findings.trajectory.assessment, valuation: deep.findings.valuation.assessment } : null;
  const digest = { feature: en.feature, longTerm: en.longTerm, recent: en.recent, story: en.story, bull: en.bull, bear: en.bear };
  const { parsed, message } = await runJson({
    system: `You write a plain-language briefing for a reader who has never read a financial statement, in ${LANG_NAMES[lang] || lang}. Use only the facts and the digest you are given; never calculate or invent a number. Everyday words; when a term such as P/E is unavoidable, add a five-word gloss in brackets. No advice, no recommendation, no "should". Each field is one or two short sentences (20-45 words in English, 40-90 characters in Japanese or Chinese). Fields: "what" = what the company sells and to whom; "growth" = is it growing, with the latest figure and period; "profit" = is it making money, with the margin; "price" = is the share price expensive or cheap versus the company's own past, using the P/E range given (say where it sits, do not judge beyond that); "watch" = the one thing to watch next and when. Return JSON.`,
    user: `Facts (computed by the site): ${JSON.stringify(facts)}\n${labels ? `Research findings (labels from the full report): ${JSON.stringify(labels)}\n` : ""}Digest (English): ${JSON.stringify(digest)}\nWrite the five fields in ${LANG_NAMES[lang] || lang}. Return JSON only.`,
    schema: SCHEMA, effort: "low", maxTokens: 2000, model: cfg.translationModel(),
  });
  const record = { symbol, lang, ...parsed, facts: { pe: facts.pe, peRange5: facts.peRange5, revenueGrowthPct: facts.revenueGrowthPct, revenueGrowthPeriod: facts.revenueGrowthPeriod, operatingMarginPct: facts.operatingMarginPct }, labels, model: message.model, generatedAt: new Date().toISOString(), usage: { input: message.usage?.input_tokens, output: message.usage?.output_tokens } };
  const store = await openStore("summaries");
  await store.set(simpleKey(symbol, lang, date), record);
  await logEvent("ai_simple", { detail: `${symbol}_${message.usage?.input_tokens || 0}_${message.usage?.output_tokens || 0}` });
  return record;
}
