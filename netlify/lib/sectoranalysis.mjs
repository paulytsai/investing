// Sector research reports on the same specification as the company deep dive:
// three independent findings for the sector, the value chain as battlefields,
// supporting sections, a read on each constituent, risks, questions, checkpoints.
import { openStore } from "./store.mjs";
import { cfg } from "./config.mjs";
import { logEvent } from "./events.mjs";
import { stockBundle, liveQuote } from "./stockdata.mjs";
import { getCachedSummary, runJson } from "./summarize.mjs";
import { DEEP_SCHEMA, DEEP_SECTION_KEYS, DEEP_ASSESSMENTS, LANG_NAMES } from "./prompts.mjs";
import { sectorById, AI_LAYERS } from "./sectors.mjs";
import { deepIncompleteReason } from "./deep.mjs";

const VERSION = "s1";
const TRANSLATION_VERSION = "1";
const JOB_TTL_MS = 10 * 60 * 1000;
const filled = (v, min = 1) => typeof v === "string" && v.trim().length >= min;

/** Reports refresh monthly (and whenever the version changes). */
export function sectorPeriod() { return new Date().toISOString().slice(0, 7); }
export function sectorKey(id, lang, period = sectorPeriod()) {
  const v = lang === "en" ? VERSION : `${VERSION}t${TRANSLATION_VERSION}`;
  return `sector:${v}:${id}:${lang}:${period}`;
}

export const SECTOR_SCHEMA = {
  ...DEEP_SCHEMA,
  required: [...DEEP_SCHEMA.required, "constituents"],
  properties: { ...DEEP_SCHEMA.properties, constituents: { type: "array", items: { type: "object", additionalProperties: false, required: ["symbol", "role", "read"], properties: { symbol: { type: "string" }, role: { type: "string" }, read: { type: "string" } } } } },
};

export function sectorIncompleteReason(rec, lang) {
  const r = deepIncompleteReason(rec, lang); if (r) return r;
  const f = (lang || rec.lang || "en") === "en" ? 1 : 0.5;
  if (!Array.isArray(rec.constituents) || rec.constituents.length < 2) return "constituents < 2";
  if (rec.constituents.some((c) => !filled(c.symbol, 1) || !filled(c.role, 3 * f) || !filled(c.read, 20 * f))) return "constituent read short";
  return null;
}
export const isSectorComplete = (rec, lang) => sectorIncompleteReason(rec, lang) === null;

export async function getCachedSector(id, lang) {
  const store = await openStore("summaries");
  const rec = await store.get(sectorKey(id, lang));
  return isSectorComplete(rec, lang) ? rec : null;
}

const n1 = (v, d = 1) => (v === null || v === undefined || Number.isNaN(Number(v)) ? "-" : Number(v).toFixed(d));

/**
 * Data rows for the constituents. The page (`full` false) only reads bundles the warmer
 * already built and falls back to a quote for the rest, so it never blocks on 30 FMP
 * fetches; report generation (`full` true) builds any missing bundle, a few at a time.
 */
export async function constituentRows(sector, { full = false } = {}) {
  const layersOf = (sym) => AI_LAYERS.filter((l) => l.members.includes(sym)).map((l) => l.layer);
  const limit = full ? 3 : 12;
  let i = 0; const out = [];
  const worker = async () => { while (i < sector.members.length) { const sym = sector.members[i++]; out.push(await constituentRow(sym, { full, layersOf })); } };
  await Promise.all(Array.from({ length: Math.min(limit, sector.members.length) }, worker));
  return sector.members.map((sym) => out.find((r) => r.symbol === sym));
}

async function constituentRow(symbol, { full, layersOf }) {
  try {
    let b = await stockBundle(symbol, { peek: !full });
    if (!b) {
      const q = await liveQuote(symbol).catch(() => ({}));
      return { symbol, name: q.name || symbol, exchange: q.exchange || null, country: null, marketCapM: q.marketCap ? Math.round(q.marketCap / 1e6) : null, price: q.price ?? null, changePct: q.changePercentage ?? q.changesPercentage ?? null, peForward: null, evEbitda: null, opMarginPct: null, grossMarginPct: null, roicPct: null, revenueGrowthPct: null, growthLabel: null, yearHigh: q.yearHigh ?? null, yearLow: q.yearLow ?? null, layers: layersOf(symbol), feature: null, storyHeadline: null, pending: true, _en: null, _fin: null, _rev: "" };
    }
    {
      const v = b.valuation || {}, m = b.market || {};
      const fy = (b.performance || []).filter((r) => r.kind === "annual" || r.kind === "fy" || (!r.kind && r.label));
      const growth = (b.growth && b.growth.salesGrowth && b.growth.salesGrowth[b.growth.salesGrowth.length - 1]) || null;
      const s = await getCachedSummary(symbol, cfg.defaultLocale(), b.latestTranscriptDate).catch(() => null);
      const en = await getCachedSummary(symbol, "en", b.latestTranscriptDate).catch(() => null);
      return { symbol, name: b.company.name, exchange: b.company.exchange, country: b.company.country || "US", marketCapM: m.marketCapM, price: m.price, changePct: m.changePct, peForward: v.peForward, evEbitda: v.evEbitda, opMarginPct: v.opMarginPct, grossMarginPct: v.grossMarginPct, roicPct: v.roicPct, revenueGrowthPct: growth ? growth.pct : null, growthLabel: growth ? growth.label : null, yearHigh: v.yearHigh, yearLow: v.yearLow, layers: layersOf(symbol), feature: s ? s.feature : (en ? en.feature : null), storyHeadline: s && s.story ? s.story.headline : null,
        _en: en ? { feature: en.feature, story: en.story, longTerm: en.longTerm && en.longTerm.headline, recent: en.recent && en.recent.headline, bull: en.bull && en.bull.headline, bear: en.bear && en.bear.headline } : null, _fin: b.financials ? { netDebtToEbitda: b.financials.netDebtToEbitda, capex: b.indicators && b.indicators.capex, rnd: b.indicators && b.indicators.rnd } : null, _rev: (b.performance || []).slice(0, 7).map((r) => `${r.kind === "estimate" ? "E" : ""}${r.label}:${r.revenue}`).join(" ") };
    }
  } catch (e) { return { symbol, error: e.message }; }
}

function sectorMaterials(sector, rows, lang) {
  const name = sector.name.en;
  const good = rows.filter((r) => !r.error);
  const table = ["symbol | name | mkt cap $M | fwd P/E | EV/EBITDA | gross margin | op margin | ROIC | latest FY revenue growth | revenue by FY (E=consensus, $M) | net debt/EBITDA | AI layers",
    ...good.map((r) => `${r.symbol} | ${r.name} | ${r.marketCapM ?? "-"} | ${n1(r.peForward)} | ${n1(r.evEbitda)} | ${n1(r.grossMarginPct)}% | ${n1(r.opMarginPct)}% | ${n1(r.roicPct)}% | ${r.revenueGrowthPct == null ? "-" : n1(r.revenueGrowthPct) + "% (" + r.growthLabel + ")"} | ${r._rev} | ${r._fin ? n1(r._fin.netDebtToEbitda) : "-"} | ${r.layers.join(",") || "-"}`)].join("\n");
  const digests = good.filter((r) => r._en).map((r) => `### ${r.symbol} ${r.name}\nProfile: ${r._en.feature}\nPast year: ${r._en.story ? `${r._en.story.headline}. ${r._en.story.body}` : "-"}\nHeadlines: long-term "${r._en.longTerm}"; recent "${r._en.recent}"; bull "${r._en.bull}"; bear "${r._en.bear}"`).join("\n\n");
  const layers = sector.layers ? `## The five layers\n${sector.layers.map((l) => `Layer ${l.layer} ${l.name.en}: ${l.members.join(", ")}`).join("\n")}\n` : "";
  return [`## Sector: ${name}${sector.desc ? ` — ${sector.desc.en}` : ""}`, `Research date ${new Date().toISOString().slice(0, 10)}. Constituents are the listed names tracked by this site; private companies may be referenced from the digests but have no data here.`, layers, "## Constituent data (Financial Modeling Prep, latest)", table, "", "## Company digests (generated by this site from earnings calls and news)", digests || "(none yet)"].join("\n");
}

export function sectorSystemPrompt() {
  return `You are a research analyst applying a research specification to an industry sector for a one-page reference site. Research only: never issue buy, sell, hold, overweight, underweight or allocation recommendations, and never produce a composite score or ranking of the sector or its companies.

Three independent findings for the sector, kept separate and never averaged:
- Sector Quality (Q): how economically sound and durable the sector's profit pool is over five to ten years: value-chain profit capture, industry structure and concentration, entry barriers, pricing power, switching costs, scale and scarce assets, returns on capital, reinvestment needs, financing resilience. Labels: strong, adequate, weak, mixed or uncertain. Price and multiples do not enter Q.
- Sector Trajectory (T): are the sector's operating economics improving or deteriorating, and why: demand, volume and price, capacity additions and utilisation, inventories, capex cycle, supply discipline, margins, estimate revisions; distinguish observed direction (dated) from forecast direction (one to five years) and structural from cyclical and one-time changes. Labels: improving, stable, deteriorating or mixed/uncertain.
- Market Expectations and Valuation (V): what the group's dated multiples imply versus plausible scenarios, using own-history and cross-sector context, dispersion inside the group, consensus growth, and the operating requirements behind the price. Labels: demanding, moderate, undemanding or indeterminate.
Then a divergences paragraph.

Evidence discipline: give material numbers their period; separate reported data, consensus, management assertions (from the digests) and your own reading; say "indeterminate" where evidence is thin; never fabricate. Terse plain prose with concrete numbers and causal reasoning; no bullet points or markdown inside strings. About 1,200-1,500 words in total.

Return JSON with:
- "findings": "quality", "trajectory", "valuation" (each: "assessment"; "mechanism" 60-90 words; "evidence" 40-70 words, dated; "counterevidence" 30-60 words; "confidence" high/medium/low; "decisive" one sentence naming the decisive variable and the observation that would change the conclusion) and "divergences" (40-80 words).
- "story": headline (3-7 words) + body (110-150 words): what the sector sells and to whom, the value chain and where profit is captured, the reachable opportunity and the competitive structure, ending with the two-minute falsifiable story.
- "battlefields": 3-6 rows, one per value-chain stage or sub-segment (for the AI stack, one per layer): "segment", "revenueShare" (share of the sector's profit pool or revenue, or "n/a" with the reason), "competitors" (the main listed and private players), "purchaseCriteria" (what decides the sale), "position" (who captures the profit and why, 15-25 words).
- "sections": exactly 8 items in this order, each {"key", "headline", "body"}: "history" (70-100 words: phases of the sector's development, the events behind the big moves, what is unexplained), "detective" (70-100 words: what the aggregate numbers say versus the sector narrative: margins, returns, cash conversion, capital intensity, dispersion between leaders and laggards), "moat" (70-100 words: where durable advantages sit in the chain, toll-booth versus commodity layers, pricing evidence, bypass risk), "outlook" (70-100 words: demand driver equations, capacity and reinvestment, base and alternative scenarios, maturation), "cycle" (50-80 words: cycle position, supply response, capex timeline, confirming and reversing indicators), "management" (50-80 words: capital allocation patterns across the group: capex, M&A, buybacks, dilution, governance issues), "valuationDetail" (70-100 words: group multiples versus history and other sectors, dispersion, what the price requires, sensitivities), "consensus" (50-80 words: consensus, revisions, the optimistic and sceptical narratives and what distinguishes them).
- "constituents": one item per listed constituent in the data table: "symbol", "role" (its place in the chain, 2-6 words), "read" (20-35 words: position, what drives it, the main exposure).
- "risks": 3-5 items: "risk" (mechanism and effect), "indicator" (early indicator), "finding" (Q, T or V).
- "questions": 3 decisive research questions, the first being the central economic question.
- "checkpoints": 3-5 rows: "premise", "finding" (Q, T or V), "kpi", "latest" (with period), "failure", "next".
- "caveats": at most 50 words on data limits and assumptions.`;
}

function translateSectorPrompt(lang) {
  const name = LANG_NAMES[lang] || lang;
  const jaRules = lang === "ja" ? " Use the plain declarative style (である調); full-width brackets and Japanese punctuation; dollar amounts as 億ドル/百万ドル where natural; keep tickers and company names as written in Japanese financial media." : "";
  const zhRules = lang === "zh-TW" ? " Use Traditional Chinese with Taiwan investment-media vocabulary; keep tickers and company names as is; dollar amounts as 億美元 where natural." : "";
  return `You translate a sector research report from English into ${name} for retail investors. Translate faithfully: same facts, figures, periods, structure and terseness.${jaRules}${zhRules} Return JSON with exactly the same keys and array lengths. Translate every free-text string; keep "key", "symbol", "assessment", "confidence" and "finding" values exactly as given in English.`;
}

export async function generateSectorEnglish(id) {
  const sector = sectorById(id); if (!sector) throw new Error("unknown sector");
  const rows = await constituentRows(sector, { full: true });
  const materials = sectorMaterials(sector, rows, "en");
  const request = (extra) => runJson({ system: sectorSystemPrompt(), user: `Apply the specification to the sector "${sector.name.en}". Return JSON only.${extra}\n\n${materials}`, schema: SECTOR_SCHEMA, effort: "high", maxTokens: 32000 });
  let { parsed, message } = await request("").catch((e) => { if (!/truncated/.test(e.message)) throw e; console.warn(`sector report ${id} truncated; retrying with a word budget`); return request(" Keep the whole report within 1,600 words; every string must respect its word range."); });
  if (!isSectorComplete(parsed, "en")) {
    console.warn(`incomplete sector report for ${id} (${sectorIncompleteReason(parsed, "en")}); retrying`);
    ({ parsed, message } = await request(" Every field must be filled in full with substantive text."));
    if (!isSectorComplete(parsed, "en")) throw new Error(`Model returned an incomplete sector report (${sectorIncompleteReason(parsed, "en")})`);
  }
  for (const k of ["quality", "trajectory", "valuation"]) { const x = parsed.findings[k]; x.assessment = String(x.assessment).toLowerCase().replace(/\s+/g, ""); x.confidence = String(x.confidence).toLowerCase(); }
  for (const r of parsed.risks) r.finding = String(r.finding).toUpperCase();
  for (const c of parsed.checkpoints) c.finding = String(c.finding).toUpperCase();
  const record = { id, lang: "en", period: sectorPeriod(), ...parsed, model: message.model, generatedAt: new Date().toISOString(), usage: { input: message.usage?.input_tokens, output: message.usage?.output_tokens } };
  const store = await openStore("summaries");
  await store.set(sectorKey(id, "en"), record);
  await logEvent("ai_sector", { detail: `${id}_${message.usage?.input_tokens || 0}_${message.usage?.output_tokens || 0}` });
  return record;
}

export async function translateSector(en, lang) {
  const source = Object.fromEntries(Object.keys(SECTOR_SCHEMA.properties).map((k) => [k, en[k]]));
  const { parsed, message } = await runJson({ system: translateSectorPrompt(lang), user: `Translate this JSON. Return JSON only.\n\n${JSON.stringify(source)}`, schema: SECTOR_SCHEMA, effort: "medium", maxTokens: 32000 });
  if (!isSectorComplete(parsed, lang)) throw new Error(`Translation to ${lang} came back incomplete (${sectorIncompleteReason(parsed, lang)})`);
  const record = { ...en, ...parsed, lang, translatedFrom: "en", model: message.model, generatedAt: new Date().toISOString(), usage: { input: message.usage?.input_tokens, output: message.usage?.output_tokens } };
  const store = await openStore("summaries");
  await store.set(sectorKey(en.id, lang), record);
  await logEvent("ai_translate", { detail: `${en.id}_sector_${lang}` });
  return record;
}

export async function ensureSector(id, lang) {
  let en = await getCachedSector(id, "en");
  if (!en) en = await generateSectorEnglish(id);
  if (lang === "en") return en;
  const existing = await getCachedSector(id, lang);
  if (existing) return existing;
  return translateSector(en, lang);
}

/** Cached report or a background job, like the company digest. */
export async function sectorStatus(id, lang) {
  if (!cfg.anthropicKey()) return { status: "disabled" };
  const cached = await getCachedSector(id, lang);
  if (cached) return { status: "ready", summary: cached };
  const jobs = await openStore("jobs");
  const jobKey = `job:${sectorKey(id, lang)}`;
  const existing = await jobs.get(jobKey);
  const now = Date.now();
  if (existing && existing.status === "error" && now - existing.updatedAt < 60 * 1000) return { status: "error", message: existing.message };
  if (existing && existing.status === "running" && now - existing.startedAt < JOB_TTL_MS) return { status: "pending", startedAt: existing.startedAt };
  await jobs.set(jobKey, { status: "running", startedAt: now, updatedAt: now });
  const url = `${cfg.siteUrl().replace(/\/$/, "")}/.netlify/functions/sector-generate-background`;
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-internal-secret": cfg.internalSecret() }, body: JSON.stringify({ id, lang, jobKey }) });
    if (!res.ok && res.status !== 202) throw new Error(`trigger failed: HTTP ${res.status}`);
  } catch (e) {
    await jobs.set(jobKey, { status: "error", message: e.message, updatedAt: Date.now() });
    return { status: "error", message: e.message };
  }
  return { status: "pending", startedAt: now };
}
