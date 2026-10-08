// Netlify background function: generates one sector report (English first, then the language).
import { cfg } from "../lib/config.mjs";
import { ensureSector } from "../lib/sectoranalysis.mjs";
import { openStore } from "../lib/store.mjs";

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (req.headers.get("x-internal-secret") !== cfg.internalSecret()) return new Response("Forbidden", { status: 403 });
  let body; try { body = await req.json(); } catch { return new Response("Bad request", { status: 400 }); }
  const jobs = await openStore("jobs");
  try { await ensureSector(body.id, body.lang); await jobs.set(body.jobKey, { status: "done", updatedAt: Date.now() }); }
  catch (e) { console.error("sector generation failed", e); await jobs.set(body.jobKey, { status: "error", message: e.message, updatedAt: Date.now() }); }
  return new Response("", { status: 202 });
};
