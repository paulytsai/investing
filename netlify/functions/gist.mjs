// GET /api/gist/deep/:id?lang=   one-line section summaries for a ticker's deep dive
// GET /api/gist/sector/:id?lang= the same for a sector report (the sample sector is public)
import { json, handler, param, query, HttpError } from "../lib/http.mjs";
import { currentUser, entitlement } from "../lib/entitlement.mjs";
import { stockBundle, normalizeSymbol } from "../lib/stockdata.mjs";
import { getCachedDeep } from "../lib/deep.mjs";
import { getCachedSector } from "../lib/sectoranalysis.mjs";
import { ensureGist } from "../lib/gist.mjs";
import { cfg, SUPPORTED_LOCALES } from "../lib/config.mjs";

export default handler(async (req, context) => {
  const kind = param(context, "kind"); const rawId = param(context, "id");
  const lang = query(req).get("lang") || cfg.defaultLocale();
  if (!SUPPORTED_LOCALES.includes(lang)) throw new HttpError(400, "invalid_locale");
  if (!cfg.anthropicKey()) return json({ status: "disabled" });
  const user = await currentUser(req).catch(() => null);
  const entitled = !!(user && entitlement(user).access);
  let record = null, id;
  if (kind === "deep") {
    id = normalizeSymbol(rawId);
    const demo = id === normalizeSymbol(process.env.DEMO_SYMBOL || "AAPL");
    if (!entitled && !demo) throw new HttpError(401, "unauthenticated");
    const bundle = await stockBundle(id, { peek: true }); if (!bundle) return json({ status: "none" });
    record = await getCachedDeep(id, lang, bundle.latestTranscriptDate);
  } else if (kind === "sector") {
    id = String(rawId || "").toLowerCase();
    if (!entitled && id !== cfg.sampleSector()) throw new HttpError(401, "unauthenticated");
    record = await getCachedSector(id, lang);
  } else throw new HttpError(404, "not_found");
  if (!record) return json({ status: "none" }, 200, { "cache-control": "no-store" });
  const gists = await ensureGist(kind, id, lang, record);
  return json({ status: "ready", gists }, 200, { "cache-control": "no-store" });
});

export const config = { path: "/api/gist/:kind/:id" };
