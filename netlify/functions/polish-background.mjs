// Netlify background function: rewrites finding shorthand (Q/T/V) and untranslated labels in stored reports.
// Body: { items: [{ key, kind, lang }] } or { kind: "sector", id: "all"|<id>, lang: "all"|<lang> }.
import { cfg } from "../lib/config.mjs";
import { polishStored } from "../lib/polish.mjs";
import { sectorKey } from "../lib/sectoranalysis.mjs";
import { allSectors } from "../lib/sectors.mjs";

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (req.headers.get("x-internal-secret") !== cfg.internalSecret()) return new Response("Forbidden", { status: 403 });
  let body = {}; try { body = await req.json(); } catch {}
  let items = Array.isArray(body.items) ? body.items : [];
  if (!items.length && body.kind === "sector") {
    const ids = body.id && body.id !== "all" ? [String(body.id)] : (await allSectors()).map((s) => s.id);
    const langs = body.lang && body.lang !== "all" ? [String(body.lang)] : cfg.locales();
    items = ids.flatMap((id) => langs.map((lang) => ({ key: sectorKey(id, lang), kind: "sector", lang })));
  }
  for (const it of items) {
    try { const r = await polishStored(it.key, { kind: it.kind || "sector", lang: it.lang || "en" }); console.log("polished", JSON.stringify(r)); }
    catch (e) { console.error("polish failed", it.key, e.message); }
  }
  return new Response("", { status: 202 });
};
