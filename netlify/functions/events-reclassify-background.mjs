// Netlify background function: moves past crawler and script traffic out of the usage figures.
import { cfg } from "../lib/config.mjs";
import { reclassifyEvents } from "../lib/events.mjs";

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (req.headers.get("x-internal-secret") !== cfg.internalSecret()) return new Response("Forbidden", { status: 403 });
  let body = {}; try { body = await req.json(); } catch {}
  try { const r = await reclassifyEvents(Math.min(30, Math.max(1, Number(body.days || 30)))); console.log("reclassified", JSON.stringify(r)); }
  catch (e) { console.error("reclassify failed", e); }
  return new Response("", { status: 202 });
};
