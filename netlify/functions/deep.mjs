// Returns the cached deep-dive analysis for a ticker/language, or kicks off generation
// in a background function and reports "pending" so the page can poll.
import { json, handler, param, query, HttpError } from "../lib/http.mjs";
import { requireEntitled } from "../lib/entitlement.mjs";
import { stockBundle, normalizeSymbol } from "../lib/stockdata.mjs";
import { deepStatus } from "../lib/summaryjob.mjs";
import { getCachedDeep, deepKey } from "../lib/deep.mjs";
import { requestPolish, wantsPolish } from "../lib/polish.mjs";
import { cfg, SUPPORTED_LOCALES } from "../lib/config.mjs";

export default handler(async (req, context) => {
  await requireEntitled(req);
  const symbol = normalizeSymbol(param(context, "symbol"));
  const lang = query(req).get("lang") || cfg.defaultLocale();
  if (!SUPPORTED_LOCALES.includes(lang)) throw new HttpError(400, "invalid_locale");
  const bundle = await stockBundle(symbol);
  // ?peek=1: the cached record only, never starts a generation (used for the chips at the top of the page)
  if (query(req).get("peek") === "1") { const rec = await getCachedDeep(symbol, lang, bundle.latestTranscriptDate); if (rec && wantsPolish(rec, lang)) await requestPolish(deepKey(symbol, lang, bundle.latestTranscriptDate), { kind: "deep", lang }).catch((e) => console.warn("polish trigger", e.message)); return json(rec ? { status: "ready", summary: rec } : { status: "none" }, 200, { "cache-control": "no-store" }); }
  return json(await deepStatus(symbol, lang, bundle));
});

export const config = { path: "/api/deep/:symbol" };
