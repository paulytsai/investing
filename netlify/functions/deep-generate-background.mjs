// Netlify background function (name ends with -background: runs up to 15 minutes).
import { cfg } from "../lib/config.mjs";
import { stockBundle, normalizeSymbol } from "../lib/stockdata.mjs";
import { ensureDeep } from "../lib/deep.mjs";
import { openStore } from "../lib/store.mjs";

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (req.headers.get("x-internal-secret") !== cfg.internalSecret()) return new Response("Forbidden", { status: 403 });
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const jobs = await openStore("jobs");
  const { jobKey, lang } = body;
  try {
    const symbol = normalizeSymbol(body.symbol);
    const bundle = await stockBundle(symbol);
    await ensureDeep(symbol, lang, bundle);
    await jobs.set(jobKey, { status: "done", updatedAt: Date.now() });
  } catch (e) {
    console.error("deep analysis generation failed", e);
    await jobs.set(jobKey, { status: "error", message: e.message, updatedAt: Date.now() });
  }
  return new Response("", { status: 202 });
};
