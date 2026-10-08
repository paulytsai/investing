// GET /api/sectors            public list of sectors with their constituents
// GET /api/sector/:id?lang=   constituent data for everyone; the AI report for entitled users
import { json, handler, param, query, HttpError } from "../lib/http.mjs";
import { currentUser, entitlement } from "../lib/entitlement.mjs";
import { allSectors, sectorById } from "../lib/sectors.mjs";
import { constituentRows, sectorStatus } from "../lib/sectoranalysis.mjs";
import { cfg, SUPPORTED_LOCALES } from "../lib/config.mjs";
import { logEvent } from "../lib/events.mjs";

export default handler(async (req, context) => {
  const id = param(context, "id");
  if (!id || id === "list") return json({ sectors: allSectors().map((s) => ({ id: s.id, group: s.group, name: s.name, desc: s.desc || null, members: s.members, layers: s.layers || null })) }, 200, { "cache-control": "public, max-age=3600" });
  const sector = sectorById(id);
  if (!sector) throw new HttpError(404, "not_found");
  const lang = query(req).get("lang") || cfg.defaultLocale();
  if (!SUPPORTED_LOCALES.includes(lang)) throw new HttpError(400, "invalid_locale");
  const user = await currentUser(req).catch(() => null);
  const entitled = !!(user && entitlement(user).access);
  const rows = (await constituentRows(sector)).map(({ _en, _fin, _rev, ...r }) => r);
  const analysis = entitled ? await sectorStatus(id, lang) : { status: "locked" };
  await logEvent("sector_view", { user, detail: id, req });
  return json({ sector: { id: sector.id, group: sector.group, name: sector.name, desc: sector.desc || null, layers: sector.layers || null }, constituents: rows, analysis }, 200, { "cache-control": "no-store" });
});

export const config = { path: ["/api/sector/:id", "/api/sectors"] };
