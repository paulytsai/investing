// GET /api/simple/:symbol?lang=  the plain-language read (five sentences). "pending" until the
// English digest exists; the page polls like it does for the digest.
import { json, handler, param, query, HttpError } from "../lib/http.mjs";
import { requireEntitled } from "../lib/entitlement.mjs";
import { stockBundle, normalizeSymbol } from "../lib/stockdata.mjs";
import { ensureSimple } from "../lib/simple.mjs";
import { cfg, SUPPORTED_LOCALES } from "../lib/config.mjs";

export default handler(async (req, context) => {
  await requireEntitled(req);
  const symbol = normalizeSymbol(param(context, "symbol"));
  const lang = query(req).get("lang") || cfg.defaultLocale();
  if (!SUPPORTED_LOCALES.includes(lang)) throw new HttpError(400, "invalid_locale");
  if (!cfg.anthropicKey()) return json({ status: "disabled" });
  const bundle = await stockBundle(symbol);
  const rec = await ensureSimple(symbol, lang, bundle);
  return json(rec ? { status: "ready", simple: rec } : { status: "pending" }, 200, { "cache-control": "no-store" });
});

export const config = { path: "/api/simple/:symbol" };
