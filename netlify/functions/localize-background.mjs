// Netlify background function: translates a sector's English-fallback company descriptions into one language.
import { cfg } from "../lib/config.mjs";
import { localizeSector } from "../lib/sectoranalysis.mjs";

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (req.headers.get("x-internal-secret") !== cfg.internalSecret()) return new Response("Forbidden", { status: 403 });
  let body = {}; try { body = await req.json(); } catch {}
  try { const r = await localizeSector(String(body.id || ""), String(body.lang || "ja")); console.log("localized", JSON.stringify(r)); }
  catch (e) { console.error("localization failed", e); }
  return new Response("", { status: 202 });
};
