// Generates the AI commentary (特色 / 長期トレンド / 直近動向) for a ticker in one language.
import Anthropic from "@anthropic-ai/sdk";
import { cfg } from "./config.mjs";
import { fmp, fmpSoft } from "./fmp.mjs";
import { openStore } from "./store.mjs";
import { systemPrompt, OUTPUT_SCHEMA } from "./prompts.mjs";

const MAX_TRANSCRIPT_CHARS = 60000; // one call is ~50k chars
const TRANSCRIPTS_TO_USE = 4;

export function summaryKey(symbol, lang, latestTranscriptDate) {
  return `${symbol}:${lang}:${latestTranscriptDate || "none"}`;
}

export async function getCachedSummary(symbol, lang, latestTranscriptDate) {
  const store = await openStore("summaries");
  return store.get(summaryKey(symbol, lang, latestTranscriptDate));
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
  const f = bundle.financials;
  const c = bundle.cashflow;
  return [
    `Company: ${bundle.company.name} (${bundle.symbol}, ${bundle.company.exchange}); sector ${bundle.company.sector} / ${bundle.company.industry}; employees ${bundle.company.employees ?? "?"}; fiscal year ends month ${bundle.company.fiscalYearEndMonth ?? "?"}.`,
    `Price $${bundle.market.price ?? "?"}, market cap ${bundle.market.marketCapM ?? "?"}M USD, PER(TTM) ${bundle.market.per ?? "?"}, PBR ${bundle.market.pbr ?? "?"}, dividend yield ${bundle.market.dividendYieldPct ?? "?"}%.`,
    `Revenue segments (FY${bundle.company.segmentsFiscalYear ?? "?"}): ${seg || "n/a"}.`,
    `Financial table (million USD; E = analyst consensus estimate, Q = quarter):`,
    ...rows,
    f ? `Balance sheet ${f.asOf}: total assets ${f.totalAssets}M, equity ${f.equity}M (equity ratio ${f.equityRatioPct}%), total debt ${f.totalDebt}M, cash+ST investments ${f.cashAndShortTerm}M.` : "",
    c ? `Cash flow FY${c.fiscalYear}: operating ${c.operating}M, investing ${c.investing}M, financing ${c.financing}M, FCF ${c.freeCashFlow}M, buybacks ${c.buybacks}M, dividends paid ${c.dividendsPaid}M.` : "",
    bundle.indicators ? `ROE ${bundle.indicators.roePct}% (TTM ${bundle.indicators.roeTTMPct}%), ROA ${bundle.indicators.roaPct}%, capex ${bundle.indicators.capex}M, R&D ${bundle.indicators.rnd}M.` : "",
    bundle.yoyQuarter ? `Latest quarter ${bundle.yoyQuarter.label}: revenue ${bundle.yoyQuarter.revenueGrowthPct}% YoY, net income ${bundle.yoyQuarter.netIncomeGrowthPct}% YoY.` : "",
    bundle.earningsHistory?.length ? `EPS vs consensus: ${bundle.earningsHistory.map((e) => `${e.date} actual ${e.epsActual} vs est ${e.epsEstimated}`).join("; ")}.` : "",
    bundle.materialEvents?.length ? `Recent 8-K filings: ${bundle.materialEvents.map((e) => `${e.filingDate} ${e.form} items ${e.items.join("/")}`).join("; ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function newsDigest(news) {
  return (Array.isArray(news) ? news : [])
    .slice(0, 25)
    .map((n) => `- ${String(n.publishedDate || "").slice(0, 10)} [${n.publisher || n.site || ""}] ${n.title}${n.text ? ` — ${String(n.text).slice(0, 240)}` : ""}`)
    .join("\n");
}

/**
 * Generate and store the summary. Returns the stored object.
 * `bundle` is the stockBundle() output; `lang` one of ja/en/zh-TW.
 */
export async function generateSummary(symbol, lang, bundle) {
  const apiKey = cfg.anthropicKey();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const client = new Anthropic({ apiKey, baseURL: cfg.anthropicBaseUrl() || undefined });

  const [transcripts, news] = await Promise.all([
    fetchTranscripts(symbol, bundle.transcripts || []),
    fmpSoft("news/stock", { symbols: symbol, limit: 30 }),
  ]);

  const materials = [
    "## Financial data",
    financialDigest(bundle),
    "",
    "## Recent news (newest first)",
    newsDigest(news) || "(none)",
    "",
    ...transcripts.flatMap((t) => [`## Earnings call transcript — ${t.period} (${t.date})`, t.content, ""]),
  ].join("\n");

  const userText = `Write the three commentary pieces for ${bundle.company.name} (${symbol}). Return JSON only.\n\n${materials}`;

  const stream = client.beta.messages.stream({
    model: cfg.summaryModel(),
    max_tokens: 6000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: systemPrompt(lang), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userText }],
    output_config: { effort: "medium", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") throw new Error("Model declined to write the summary");
  if (message.stop_reason === "max_tokens") throw new Error("Summary output truncated");
  const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const parsed = JSON.parse(text);

  const record = {
    symbol,
    lang,
    ...parsed,
    transcriptsUsed: transcripts.map((t) => ({ period: t.period, date: t.date })),
    newsCount: Array.isArray(news) ? Math.min(news.length, 25) : 0,
    model: message.model,
    generatedAt: new Date().toISOString(),
    usage: { input: message.usage?.input_tokens, output: message.usage?.output_tokens, cacheRead: message.usage?.cache_read_input_tokens },
  };
  const store = await openStore("summaries");
  await store.set(summaryKey(symbol, lang, bundle.latestTranscriptDate), record);
  return record;
}
