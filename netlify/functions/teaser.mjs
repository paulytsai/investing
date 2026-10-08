// Public preview of a ticker page (no login): identity, profile, the past year's story
// and a few headline figures. Everything else stays behind the subscription.
import { json, handler, param, query, HttpError } from "../lib/http.mjs";
import { stockBundle, normalizeSymbol } from "../lib/stockdata.mjs";
import { getCachedSummary } from "../lib/summarize.mjs";
import { cfg, SUPPORTED_LOCALES } from "../lib/config.mjs";
import { logEvent } from "../lib/events.mjs";

export async function teaserData(symbol, lang) {
  const b = await stockBundle(symbol);
  const s = await getCachedSummary(symbol, lang, b.latestTranscriptDate).catch(() => null);
  const en = lang === "en" ? s : await getCachedSummary(symbol, "en", b.latestTranscriptDate).catch(() => null);
  const c = b.company; const m = b.market; const v = b.valuation || {};
  return {
    symbol: b.symbol, lang, asOf: b.asOf,
    company: { name: c.name, exchange: c.exchangeFullName || c.exchange, sector: c.sector, industry: c.industry, address: c.address, employees: c.employees, website: c.website, ceo: c.ceo, description: c.businessSummary || c.description || "", indices: c.indices || [], segments: (c.segments || []).slice(0, 6), fiscalYearEndMonth: c.fiscalYearEndMonth },
    market: { price: m.price, change: m.change, changePct: m.changePct, marketCapM: m.marketCapM, per: v.pe ?? m.per, peForward: v.peForward, pbr: m.pbr, dividendYieldPct: m.dividendYieldPct, yearHigh: v.yearHigh, yearLow: v.yearLow, quoteTime: m.quoteTime },
    feature: s ? s.feature : null,
    story: s ? s.story : null,
    headlines: s ? { longTerm: s.longTerm?.headline, recent: s.recent?.headline, bull: s.bull?.headline, bear: s.bear?.headline } : null,
    competitors: ((s && s.competitors) || c.competitors || []).slice(0, 8).map((x) => ({ symbol: x.symbol, name: x.name, us: x.us !== false })),
    generatedAt: s ? s.generatedAt : null, transcript: b.latestTranscriptDate, nextEarnings: b.nextEarnings,
    englishStory: en && en !== s ? en.story : null,
  };
}

export default handler(async (req, context) => {
  const symbol = normalizeSymbol(param(context, "symbol"));
  const lang = query(req).get("lang") || cfg.defaultLocale();
  if (!SUPPORTED_LOCALES.includes(lang)) throw new HttpError(400, "invalid_locale");
  const data = await teaserData(symbol, lang);
  await logEvent("teaser", { detail: symbol, req });
  return json(data, 200, { "cache-control": "public, max-age=1800" });
});

export const config = { path: "/api/teaser/:symbol" };
