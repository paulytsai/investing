// Public sample page data (no login): one fixed ticker, all chart ranges, cached AI text.
import { json, handler, query, HttpError } from "../lib/http.mjs";
import { logEvent } from "../lib/events.mjs";
import { stockBundle, chartSeries, normalizeSymbol } from "../lib/stockdata.mjs";
import { summaryStatus, deepStatus } from "../lib/summaryjob.mjs";
import { cfg, SUPPORTED_LOCALES } from "../lib/config.mjs";

const RANGES = ["1m", "3m", "6m", "1y", "3y", "5y", "10y"];

export default handler(async (req) => {
  const symbol = normalizeSymbol(process.env.DEMO_SYMBOL || "AAPL");
  const lang = query(req).get("lang") || cfg.defaultLocale();
  if (!SUPPORTED_LOCALES.includes(lang)) throw new HttpError(400, "invalid_locale");
  const bundle = await stockBundle(symbol);
  await logEvent("demo_view", { detail: symbol, req });
  const [charts, summary, deep] = await Promise.all([
    Promise.all(RANGES.map((r) => chartSeries(symbol, r).then((c) => [r, { points: c.points, ma50: c.ma50, ma200: c.ma200 }]))),
    summaryStatus(symbol, lang, bundle),
    deepStatus(symbol, lang, bundle),
  ]);
  return json({ bundle, charts: Object.fromEntries(charts), summary, deep }, 200, { "cache-control": "public, max-age=600" });
});

export const config = { path: "/api/demo" };
