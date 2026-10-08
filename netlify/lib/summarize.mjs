// AI commentary: English is generated from transcripts, news, financials and price
// history; Japanese and Traditional Chinese are translations of the English record.
import Anthropic from "@anthropic-ai/sdk";
import { cfg } from "./config.mjs";
import { fmpSoft } from "./fmp.mjs";
import { openStore } from "./store.mjs";
import { dailyPrices } from "./stockdata.mjs";
import { englishSystemPrompt, translateSystemPrompt, OUTPUT_SCHEMA, TEXT_SCHEMA } from "./prompts.mjs";

const MAX_TRANSCRIPT_CHARS = 60000;
const TRANSCRIPTS_TO_USE = 4;
const VERSION = "v7";

export function summaryKey(symbol, lang, latestTranscriptDate) {
  return `${VERSION}:${symbol}:${lang}:${latestTranscriptDate || "none"}`;
}

export async function getCachedSummary(symbol, lang, latestTranscriptDate) {
  const store = await openStore("summaries");
  return store.get(summaryKey(symbol, lang, latestTranscriptDate));
}

function client() {
  const apiKey = cfg.anthropicKey();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  return new Anthropic({ apiKey, baseURL: cfg.anthropicBaseUrl() || undefined });
}

async function runJson({ system, user, schema, effort, maxTokens }) {
  const stream = client().beta.messages.stream({
    model: cfg.summaryModel(),
    max_tokens: maxTokens,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
    output_config: { effort, format: { type: "json_schema", schema } },
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") throw new Error("Model declined the request");
  if (message.stop_reason === "max_tokens") throw new Error("Output truncated");
  const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return { parsed: JSON.parse(text), message };
}

async function fetchTranscripts(symbol, transcripts) {
  const picks = transcripts.slice(0, TRANSCRIPTS_TO_USE);
  const results = await Promise.all(
    picks.map(async (t) => {
      const rows = await fmpSoft("earning-call-transcript", { symbol, year: t.fiscalYear, quarter: t.quarter });
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row?.content) return null;
      return { period: `Q${t.quarter} FY${t.fiscalYear}`, date: row.date || t.date, content: String(row.content).slice(0, MAX_TRANSCRIPT_CHARS) };
    }),
  );
  return results.filter(Boolean);
}

function financialDigest(bundle) {
  const rows = bundle.performance.map((r) => `${r.kind === "estimate" ? "E " : r.kind === "quarter" ? "Q " : "FY"} ${r.label}: revenue ${r.revenue ?? "-"}M, op.income ${r.operatingIncome ?? "-"}M, net ${r.netIncome ?? "-"}M, EPS ${r.eps ?? "-"}, DPS ${r.dps ?? "-"}`);
  const seg = bundle.company.segments.map((s) => `${s.name} ${s.sharePct ?? "?"}%`).join(", ");
  const f = bundle.financials; const c = bundle.cashflow;
  return [
    `Company: ${bundle.company.name} (${bundle.symbol}, ${bundle.company.exchange}); sector ${bundle.company.sector} / ${bundle.company.industry}; employees ${bundle.company.employees ?? "?"}; fiscal year ends month ${bundle.company.fiscalYearEndMonth ?? "?"}.`,
    `Price $${bundle.market.price ?? "?"}, market cap ${bundle.market.marketCapM ?? "?"}M USD, PER(TTM) ${bundle.market.per ?? "?"}, PBR ${bundle.market.pbr ?? "?"}, dividend yield ${bundle.market.dividendYieldPct ?? "?"}%.`,
    `Revenue segments (FY${bundle.company.segmentsFiscalYear ?? "?"}): ${seg || "n/a"}.`,
    `Financial table (million USD; E = analyst consensus estimate, Q = quarter):`,
    ...rows,
    f ? `Balance sheet ${f.asOf}: total assets ${f.totalAssets}M, equity ${f.equity}M, total debt ${f.totalDebt}M, net debt ${f.netDebt}M, cash+ST investments ${f.cashAndShortTerm}M, net debt/EBITDA ${f.netDebtToEbitda}, interest coverage ${f.interestCoverage}.` : "",
    c ? `Cash flow FY${c.fiscalYear}: operating ${c.operating}M, investing ${c.investing}M, financing ${c.financing}M, FCF ${c.freeCashFlow}M, buybacks ${c.buybacks}M, dividends paid ${c.dividendsPaid}M.` : "",
    bundle.indicators ? `ROE ${bundle.indicators.roePct}%, ROA ${bundle.indicators.roaPct}%, capex ${bundle.indicators.capex}M, R&D ${bundle.indicators.rnd}M.` : "",
    bundle.yoyQuarter ? `Latest quarter ${bundle.yoyQuarter.label}: revenue ${bundle.yoyQuarter.revenueGrowthPct}% YoY, net income ${bundle.yoyQuarter.netIncomeGrowthPct}% YoY.` : "",
    bundle.earningsHistory?.length ? `EPS vs consensus: ${bundle.earningsHistory.map((e) => `${e.date} actual ${e.epsActual} vs est ${e.epsEstimated}`).join("; ")}.` : "",
    bundle.materialEvents?.length ? `Recent 8-K filings: ${bundle.materialEvents.map((e) => `${e.filingDate} ${e.form} items ${e.items.join("/")}`).join("; ")}.` : "",
  ].filter(Boolean).join("\n");
}

function newsDigest(news) {
  return (Array.isArray(news) ? news : []).slice(0, 25)
    .map((n) => `- ${String(n.publishedDate || "").slice(0, 10)} [${n.publisher || n.site || ""}] ${n.title}${n.text ? ` — ${String(n.text).slice(0, 240)}` : ""}`)
    .join("\n");
}

/** Compact description of the price history for the technical read. */
function priceDigest(daily, bundle) {
  if (!Array.isArray(daily) || daily.length < 30) return "(no price history)";
  const asc = daily.slice().reverse(); // oldest first
  const last = asc[asc.length - 1];
  const yearAgo = new Date(Date.now() - 366 * 86400000).toISOString().slice(0, 10);
  const y = asc.filter((r) => r.d >= yearAgo);
  const avg = (n) => { const s = asc.slice(-n); return s.reduce((a, r) => a + r.p, 0) / s.length; };
  const hi = y.reduce((a, r) => (r.p > a.p ? r : a)); const lo = y.reduce((a, r) => (r.p < a.p ? r : a));
  const ath = asc.reduce((a, r) => (r.p > a.p ? r : a));
  // swing highs/lows: local extrema over +/-7 sessions in the last year, deduped within 2%
  const swings = (isHigh) => {
    const out = [];
    for (let i = 7; i < y.length - 7; i++) {
      const w = y.slice(i - 7, i + 8); const p = y[i].p;
      if (isHigh ? w.every((r) => r.p <= p) : w.every((r) => r.p >= p)) {
        if (!out.some((o) => Math.abs(o.p - p) / p < 0.02)) out.push(y[i]);
      }
    }
    return out.sort((a, b) => (isHigh ? b.p - a.p : a.p - b.p)).slice(0, 6);
  };
  const weekly = y.filter((_, i) => i % 5 === 0).map((r) => `${r.d.slice(2)}:${r.p.toFixed(1)}`).join(" ");
  const monthly = []; let lastMonth = "";
  for (const r of asc.slice(-1300)) { const m = r.d.slice(0, 7); if (m !== lastMonth) { monthly.push(r); lastMonth = m; } }
  const monthlyStr = monthly.map((r) => `${r.d.slice(2, 7)}:${r.p.toFixed(0)}`).join(" ");
  const earn = (bundle.earningsHistory || []).map((e) => {
    const i = asc.findIndex((r) => r.d >= e.date); if (i < 1 || i >= asc.length - 1) return null;
    const before = asc[i - 1].p; const after = asc[i + 1].p;
    return `${e.date} earnings: ${before.toFixed(1)} -> ${after.toFixed(1)} (${(((after - before) / before) * 100).toFixed(1)}%)`;
  }).filter(Boolean);
  const vol = y.slice().sort((a, b) => (b.v || 0) - (a.v || 0)).slice(0, 5).map((r) => `${r.d} vol ${Math.round((r.v || 0) / 1e6)}M close ${r.p.toFixed(1)}`);
  return [
    `Last close ${last.p.toFixed(2)} on ${last.d}. 50-day avg ${avg(50).toFixed(1)}, 200-day avg ${avg(200).toFixed(1)}.`,
    `52-week high ${hi.p.toFixed(2)} (${hi.d}), 52-week low ${lo.p.toFixed(2)} (${lo.d}). All-time high (10y window) ${ath.p.toFixed(2)} (${ath.d}).`,
    `Swing highs (last 12 months): ${swings(true).map((r) => `${r.p.toFixed(1)} on ${r.d}`).join("; ")}.`,
    `Swing lows (last 12 months): ${swings(false).map((r) => `${r.p.toFixed(1)} on ${r.d}`).join("; ")}.`,
    earn.length ? `Earnings-day moves (close before -> close after): ${earn.join("; ")}.` : "",
    `Highest-volume sessions (12 months): ${vol.join("; ")}.`,
    `Weekly closes, last 12 months (yy-mm-dd:price): ${weekly}`,
    `Monthly first closes, 5 years (yy-mm:price): ${monthlyStr}`,
  ].filter(Boolean).join("\n");
}

async function resolveCompetitors(symbol, list) {
  try {
    const syms = [...new Set((list || []).map((x) => String(x).toUpperCase().trim().replace(/[^A-Z0-9.\-]/g, "")).filter((x) => x && x !== symbol))].slice(0, 12);
    const profiles = await Promise.all(syms.map((x) => fmpSoft("profile", { symbol: x }).then((r) => (Array.isArray(r) ? r[0] : null))));
    const valid = profiles.filter((p) => p && p.marketCap > 0 && p.isActivelyTrading !== false && !p.isEtf && !p.isFund);
    const currencies = [...new Set(valid.map((p) => p.currency).filter((c) => c && c !== "USD"))];
    const fx = { USD: 1 };
    if (currencies.length) {
      const rows = await fmpSoft("batch-quote", { symbols: currencies.map((c) => `USD${c.replace("GBp", "GBP")}`).join(",") });
      for (const r of Array.isArray(rows) ? rows : []) if (r.symbol && r.price > 0) fx[r.symbol.slice(3)] = r.price;
      if (fx.GBP) fx.GBp = fx.GBP * 100;
    }
    return valid.map((p) => {
      const rate = fx[p.currency]; const capUsd = rate ? p.marketCap / rate : null;
      const us = ["NASDAQ", "NYSE", "AMEX"].some((x) => String(p.exchange || "").toUpperCase().startsWith(x));
      return { symbol: p.symbol, name: p.companyName, exchange: p.exchange, country: p.country, currency: p.currency, marketCapM: capUsd ? Math.round(capUsd / 1e6) : null, price: p.price, changePct: p.changePercentage ?? null, us };
    }).filter((c) => c.marketCapM).sort((a, b) => b.marketCapM - a.marketCapM);
  } catch (e) {
    console.warn("competitor lookup failed", e.message);
    return [];
  }
}

/** Generate the English record from source materials and store it. */
export async function generateEnglish(symbol, bundle) {
  const [transcripts, news, daily] = await Promise.all([
    fetchTranscripts(symbol, bundle.transcripts || []),
    fmpSoft("news/stock", { symbols: symbol, limit: 30 }),
    dailyPrices(symbol).catch(() => []),
  ]);
  const materials = [
    "## Financial data", financialDigest(bundle), "",
    "## Price history", priceDigest(daily, bundle), "",
    "## Recent news (newest first)", newsDigest(news) || "(none)", "",
    ...transcripts.flatMap((t) => [`## Earnings call transcript — ${t.period} (${t.date})`, t.content, ""]),
  ].join("\n");
  const { parsed, message } = await runJson({
    system: englishSystemPrompt(),
    user: `Write the commentary for ${bundle.company.name} (${symbol}). Return JSON only.\n\n${materials}`,
    schema: OUTPUT_SCHEMA, effort: "medium", maxTokens: 8000,
  });
  const competitors = await resolveCompetitors(symbol, parsed.competitors);
  const record = {
    symbol, lang: "en", ...parsed, competitors,
    transcriptsUsed: transcripts.map((t) => ({ period: t.period, date: t.date })),
    newsCount: Array.isArray(news) ? Math.min(news.length, 25) : 0,
    model: message.model, generatedAt: new Date().toISOString(),
    usage: { input: message.usage?.input_tokens, output: message.usage?.output_tokens },
  };
  const store = await openStore("summaries");
  await store.set(summaryKey(symbol, "en", bundle.latestTranscriptDate), record);
  return record;
}

/** Translate the English record into `lang` and store it. */
export async function translateSummary(en, lang, bundle) {
  const source = { feature: en.feature, longTerm: en.longTerm, recent: en.recent, bull: en.bull, bear: en.bear, technical: en.technical, asOf: en.asOf };
  const { parsed, message } = await runJson({
    system: translateSystemPrompt(lang),
    user: `Translate this JSON. Return JSON only.\n\n${JSON.stringify(source)}`,
    schema: TEXT_SCHEMA, effort: "low", maxTokens: 8000,
  });
  const record = { ...en, ...parsed, lang, translatedFrom: "en", model: message.model, generatedAt: new Date().toISOString(), usage: { input: message.usage?.input_tokens, output: message.usage?.output_tokens } };
  const store = await openStore("summaries");
  await store.set(summaryKey(en.symbol, lang, bundle.latestTranscriptDate), record);
  return record;
}

/** Make sure the record for `lang` exists: generate English first, then translate. */
export async function ensureSummary(symbol, lang, bundle) {
  let en = await getCachedSummary(symbol, "en", bundle.latestTranscriptDate);
  if (!en) en = await generateEnglish(symbol, bundle);
  if (lang === "en") return en;
  const existing = await getCachedSummary(symbol, lang, bundle.latestTranscriptDate);
  if (existing) return existing;
  return translateSummary(en, lang, bundle);
}
