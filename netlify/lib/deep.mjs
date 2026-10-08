// Deep-dive fundamental analysis (the fifth tab): generated in English from the
// transcripts, financials, geography, peer metrics and news, then translated.
import { fmpSoft } from "./fmp.mjs";
import { openStore } from "./store.mjs";
import { logEvent } from "./events.mjs";
import { runJson, fetchTranscripts, financialDigest, newsDigest, getCachedSummary } from "./summarize.mjs";
import { deepSystemPrompt, translateDeepPrompt, DEEP_SCHEMA, DEEP_SECTION_KEYS, DEEP_ASSESSMENTS } from "./prompts.mjs";

const VERSION = "d3";
const TRANSLATION_VERSION = "1";

const filled = (v, min = 1) => typeof v === "string" && v.trim().length >= min;

export function deepKey(symbol, lang, latestTranscriptDate) {
  const v = lang === "en" ? VERSION : `${VERSION}t${TRANSLATION_VERSION}`;
  return `deep:${v}:${symbol}:${lang}:${latestTranscriptDate || "none"}`;
}

// CJK text carries the same content in roughly half the characters, so thresholds scale by language.
export function deepIncompleteReason(rec, lang) {
  const L = lang || (rec && rec.lang) || "en";
  const f = L === "en" ? 1 : 0.5;
  if (!rec || !rec.findings) return "no findings";
  for (const k of ["quality", "trajectory", "valuation"]) {
    const x = rec.findings[k];
    if (!x) return `findings.${k} missing`;
    if (!DEEP_ASSESSMENTS[k].includes(String(x.assessment).toLowerCase().replace(/\s+/g, ""))) return `findings.${k}.assessment=${x.assessment}`;
    if (!filled(x.mechanism, 100 * f)) return `findings.${k}.mechanism short`;
    if (!filled(x.evidence, 60 * f)) return `findings.${k}.evidence short`;
    if (!filled(x.counterevidence, 40 * f)) return `findings.${k}.counterevidence short`;
    if (!["high", "medium", "low"].includes(String(x.confidence).toLowerCase())) return `findings.${k}.confidence=${x.confidence}`;
    if (!filled(x.decisive, 30 * f)) return `findings.${k}.decisive short`;
  }
  if (!filled(rec.findings.divergences, 60 * f)) return "divergences short";
  if (!Array.isArray(rec.battlefields) || rec.battlefields.length < 2) return "battlefields < 2";
  if (rec.battlefields.some((b) => ["segment", "revenueShare", "competitors", "purchaseCriteria", "position"].some((k) => !filled(b[k], 2)))) return "battlefield field short";
  if (!rec.story || !filled(rec.story.headline, 2) || !filled(rec.story.body, 150 * f)) return "story short";
  if (!Array.isArray(rec.sections)) return "sections missing";
  for (const k of DEEP_SECTION_KEYS) { const p = rec.sections.find((x) => x && x.key === k); if (!p) return `section ${k} missing`; if (!filled(p.headline, 2) || !filled(p.body, 100 * f)) return `section ${k} short`; }
  if (!Array.isArray(rec.risks) || rec.risks.length < 3) return "risks < 3";
  if (rec.risks.some((r) => !filled(r.risk, 20 * f) || !filled(r.indicator, 8 * f) || !["Q", "T", "V"].includes(String(r.finding).toUpperCase()))) return "risk field invalid";
  if (!Array.isArray(rec.questions) || rec.questions.length < 3 || rec.questions.some((q) => !filled(q, 15 * f))) return "questions invalid";
  if (!Array.isArray(rec.checkpoints) || rec.checkpoints.length < 3) return "checkpoints < 3";
  if (rec.checkpoints.some((c) => ["premise", "kpi", "latest", "failure", "next"].some((k) => !filled(c[k], 3 * f)) || !["Q", "T", "V"].includes(String(c.finding).toUpperCase()))) return "checkpoint field invalid";
  if (!filled(rec.caveats, 15 * f)) return "caveats short";
  return null;
}
export function isDeepComplete(rec, lang) { return deepIncompleteReason(rec, lang) === null; }

export async function getCachedDeep(symbol, lang, latestTranscriptDate) {
  const store = await openStore("summaries");
  const rec = await store.get(deepKey(symbol, lang, latestTranscriptDate));
  return isDeepComplete(rec, lang) ? rec : null;
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

const M = (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? "-" : `${Math.round(Number(v) / 1e6).toLocaleString("en-US")}M`);
const n2 = (v, d = 2) => (v === null || v === undefined || Number.isNaN(Number(v)) ? "-" : Number(v).toFixed(d));

/** Ten fiscal years of statements and returns, oldest first (for the historical reconstruction and detective pass). */
async function historyDigest(symbol) {
  const [inc, cf, bs, km] = await Promise.all([
    fmpSoft("income-statement", { symbol, period: "annual", limit: 10 }), fmpSoft("cash-flow-statement", { symbol, period: "annual", limit: 10 }),
    fmpSoft("balance-sheet-statement", { symbol, period: "annual", limit: 10 }), fmpSoft("key-metrics", { symbol, period: "annual", limit: 10 }),
  ]);
  const by = (rows) => Object.fromEntries((Array.isArray(rows) ? rows : []).map((r) => [String(r.fiscalYear || r.calendarYear || String(r.date).slice(0, 4)), r]));
  const I = by(inc), C = by(cf), B = by(bs), K = by(km);
  const years = Object.keys(I).sort();
  if (!years.length) return "(no history)";
  return ["FY: revenue, gross margin, operating income (margin), net income, diluted EPS, diluted shares, OCF, capex, FCF, buybacks, dividends, acquisitions, cash+ST inv, total debt, equity, ROIC, capex/revenue, R&D/revenue",
    ...years.map((y) => { const i = I[y] || {}, c = C[y] || {}, b = B[y] || {}, k = K[y] || {};
      return `FY${y}: ${M(i.revenue)}, GM ${pct(i.grossProfit && i.revenue ? i.grossProfit / i.revenue : null)}, OI ${M(i.operatingIncome)} (${pct(i.operatingIncome && i.revenue ? i.operatingIncome / i.revenue : null)}), NI ${M(i.netIncome)}, EPS ${n2(i.epsDiluted ?? i.eps)}, shares ${M(i.weightedAverageShsOutDil)}, OCF ${M(c.operatingCashFlow)}, capex ${M(c.capitalExpenditure)}, FCF ${M(c.freeCashFlow)}, buybacks ${M(c.commonStockRepurchased)}, dividends ${M(c.dividendsPaid ?? c.commonDividendsPaid)}, acquisitions ${M(c.acquisitionsNet)}, cash ${M(b.cashAndShortTermInvestments)}, debt ${M(b.totalDebt)}, equity ${M(b.totalStockholdersEquity)}, ROIC ${pct(k.returnOnInvestedCapital)}, capex/rev ${pct(k.capexToRevenue)}, R&D/rev ${pct(k.researchAndDevelopementToRevenue)}`; })].join("\n");
}

async function compensationDigest(symbol) {
  const rows = await fmpSoft("governance-executive-compensation", { symbol });
  const list = Array.isArray(rows) ? rows : [];
  const latest = Math.max(...list.map((r) => Number(r.year) || 0));
  return list.filter((r) => Number(r.year) === latest).sort((a, b) => (b.total || 0) - (a.total || 0)).slice(0, 4)
    .map((r) => `${latest} ${r.nameAndPosition}: total ${M(r.total)} (salary ${M(r.salary)}, stock awards ${M(r.stockAward)}, incentive ${M(r.incentivePlanCompensation)})`).join("\n") || "(none)";
}

function marketDigest(bundle) {
  const v = bundle.valuation || {}, m = bundle.market || {}, d = bundle.dcf, p = bundle.prices || {};
  const yearly = (p.yearly || []).map((y) => `${y.label}: high ${y.high} low ${y.low}`).join("; ");
  const est = (bundle.performance || []).filter((r) => r.kind === "estimate").map((r) => `${r.label}: revenue ${r.revenue}M, op.income ${r.operatingIncome}M, EPS ${r.eps}`).join("; ");
  const lines = [
    `Dated market data ${bundle.asOf}: price $${m.price}, market cap ${m.marketCapM}M, trailing P/E ${v.pe}, forward P/E ${v.peForward} (FY2 ${v.peForward2}), P/S ${v.ps}, P/B ${v.pb}, P/FCF ${v.pfcf}, EV/EBITDA ${v.evEbitda}, EV/sales ${v.evSales}, FCF yield ${v.fcfYieldPct}%, dividend yield ${v.dividendYieldPct}%, beta ${v.beta}, 52-week ${v.yearLow}-${v.yearHigh}, all-time high ${v.allTimeHigh ? `${v.allTimeHigh.price} (${v.allTimeHigh.date})` : "-"}.`,
    `TTM returns: ROIC ${v.roicPct}%, ROE ${v.roePct}%, gross margin ${v.grossMarginPct}%, operating margin ${v.opMarginPct}%, net debt/EBITDA ${v.netDebtEbitda}.`,
    `Yearly price range history: ${yearly || "-"}.`,
    `Consensus estimates: ${est || "-"}. Analyst rating: ${m.analystRating ? `${m.analystRating.consensus} (buy ${m.analystRating.buy}, hold ${m.analystRating.hold}, sell ${m.analystRating.sell})` : "-"}; price-target consensus ${m.analystTarget ? `$${m.analystTarget.consensus} (range ${m.analystTarget.low}-${m.analystTarget.high})` : "-"}.`,
    d ? `Site DCF (FCFF, 10-year, consensus-based, mechanical): value per share $${n2(d.perShare)} vs price $${n2(d.price)}; WACC ${n2(d.inputs.wacc)}% now to ${n2(d.inputs.waccMature)}% mature, terminal growth ${n2(d.inputs.g)}%, terminal ROIC ${n2(d.story.terminalRoic)}% (current ROIC ${n2(d.story.currentRoic)}%), year-10 revenue ${M(d.story.endRevenue)} (CAGR ${n2(d.story.revenueCagrPct)}%), target margin ${n2(d.story.targetMarginPct)}%, failure probability ${n2(d.story.failurePct)}%, terminal value share ${n2(d.terminalShare * 100, 0)}%. Reverse DCF (moat years implied by the price: years beyond year 10 that today's ROIC must persist before fading to WACC for the model to reach the price): ${d.story.impliedMoat ? (d.story.impliedMoat.noExcess ? "n/a (ROIC at or below WACC)" : d.story.impliedMoat.reached ? `${d.story.impliedMoat.years} years` : "more than 100 years (excess returns alone cannot explain the price)") : "-"}. Sensitivity (value per share) to 10-year revenue CAGR x year-10 margin: ${d.sensitivity && d.sensitivity.storyGrid ? d.sensitivity.storyGrid.map((row, i) => `CAGR ${n2(d.sensitivity.storyAxis.cagr[i], 1)}%: ${row.map((x) => `$${n2(x, 0)}`).join("/")}`).join("; ") + ` (margins ${d.sensitivity.storyAxis.margin.map((x) => n2(x, 1) + "%").join("/")})` : "-"}.` : "Site DCF: not available.",
    bundle.holders && bundle.holders.summary ? `Institutional ownership ${bundle.holders.summary.ownershipPct ?? "-"}% (${bundle.holders.summary.investorsHolding ?? "-"} holders); top holders: ${(bundle.holders.holders || []).slice(0, 5).map((h) => `${h.name} ${h.sharesM}M`).join(", ")}.` : "",
    bundle.insider ? `Insider trading (last period): ${JSON.stringify(bundle.insider)}` : "",
    bundle.officers && bundle.officers.length ? `Officers: ${bundle.officers.slice(0, 6).map((o) => `${o.name} (${o.title})`).join("; ")}.` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

export async function generateDeepEnglish(symbol, bundle) {
  const [transcripts, news, peers, geo, history, comp] = await Promise.all([
    fetchTranscripts(symbol, bundle.transcripts || []),
    fmpSoft("news/stock", { symbols: symbol, limit: 30 }),
    peerTable(symbol, bundle).catch(() => "(no peer data)"),
    geoDigest(symbol).catch(() => "(none)"),
    historyDigest(symbol).catch(() => "(no history)"),
    compensationDigest(symbol).catch(() => "(none)"),
  ]);
  const materials = [
    `## Research date ${bundle.asOf}; latest transcript ${bundle.latestTranscriptDate}; fiscal year ends month ${bundle.company.fiscalYearEndMonth}; reporting currency USD`,
    "## Financial data (recent)", financialDigest(bundle), "",
    "## Ten-year history (from Financial Modeling Prep; reconcile to filings where material)", history, "",
    "## Market, consensus, ownership and the site's DCF / reverse-DCF outputs", marketDigest(bundle), "",
    "## Revenue by geography", geo, "",
    "## Peer metrics (trailing twelve months)", peers, "",
    "## Executive compensation (latest proxy year)", comp, "",
    "## Business description", bundle.company.businessSummary || bundle.company.description || "(none)", "",
    "## Recent news (newest first)", newsDigest(news) || "(none)", "",
    ...transcripts.flatMap((t) => [`## Earnings call transcript — ${t.period} (${t.date})`, t.content, ""]),
  ].join("\n");
  const request = (extra) => runJson({
    system: deepSystemPrompt(),
    user: `Apply the research specification to ${bundle.company.name} (${symbol}) as of ${bundle.asOf}. Return JSON only.${extra}\n\n${materials}`,
    schema: DEEP_SCHEMA, effort: "high", maxTokens: 16000,
  });
  let { parsed, message } = await request("");
  if (!isDeepComplete(parsed)) {
    console.warn(`incomplete deep analysis for ${symbol} (${deepIncompleteReason(parsed)}); retrying`);
    ({ parsed, message } = await request(" Every field must be filled in full with substantive text; empty or placeholder strings are not acceptable."));
    if (!isDeepComplete(parsed)) throw new Error(`Model returned an incomplete analysis (${deepIncompleteReason(parsed)})`);
  }
  for (const k of ["quality", "trajectory", "valuation"]) { const x = parsed.findings[k]; x.assessment = String(x.assessment).toLowerCase().replace(/\s+/g, ""); x.confidence = String(x.confidence).toLowerCase(); }
  for (const r of parsed.risks) r.finding = String(r.finding).toUpperCase();
  for (const c of parsed.checkpoints) c.finding = String(c.finding).toUpperCase();
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
  const source = Object.fromEntries(Object.keys(DEEP_SCHEMA.properties).map((k) => [k, en[k]]));
  const { parsed, message } = await runJson({
    system: translateDeepPrompt(lang),
    user: `Translate this JSON. Return JSON only.\n\n${JSON.stringify(source)}`,
    schema: DEEP_SCHEMA, effort: "medium", maxTokens: 16000,
  });
  if (!isDeepComplete(parsed, lang)) throw new Error(`Translation to ${lang} came back incomplete`);
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
