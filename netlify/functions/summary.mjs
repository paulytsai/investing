// Returns the cached AI commentary for a ticker/language, or kicks off generation
// in a background function and reports "pending" so the page can poll.
import { json, handler, param, query, HttpError } from "../lib/http.mjs";
import { requireEntitled } from "../lib/entitlement.mjs";
import { stockBundle, normalizeSymbol } from "../lib/stockdata.mjs";
import { summaryStatus } from "../lib/summaryjob.mjs";
import { cfg, SUPPORTED_LOCALES } from "../lib/config.mjs";

export default handler(async (req, context) => {
  await requireEntitled(req);
  const symbol = normalizeSymbol(param(context, "symbol"));
  const lang = query(req).get("lang") || cfg.defaultLocale();
  if (!SUPPORTED_LOCALES.includes(lang)) throw new HttpError(400, "invalid_locale");
  const bundle = await stockBundle(symbol);
  return json(await summaryStatus(symbol, lang, bundle));
});

export const config = { path: "/api/summary/:symbol" };
