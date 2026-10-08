// Netlify background function: rewrites finding shorthand (Q/T/V) and untranslated labels in stored reports.
// Body: { items: [{ key, kind, lang }] }, { kind: "sector", id: "all"|<id>, lang: "all"|<lang> }
// or { kind: "deep", all: true, after?: <key> } (every current-version deep dive; chains itself past the 15-minute limit).
import { cfg } from "../lib/config.mjs";
import { polishStored } from "../lib/polish.mjs";
import { sectorKey } from "../lib/sectoranalysis.mjs";
import { allSectors } from "../lib/sectors.mjs";
import { deepKey } from "../lib/deep.mjs";
import { openStore } from "../lib/store.mjs";

const BUDGET_MS = 11 * 60 * 1000;

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
  let chain = null;
  if (!items.length && body.kind === "deep" && body.all) {
    const prefixes = [deepKey("_", "en", "_"), deepKey("_", "ja", "_")].map((k) => k.split(":_:")[0] + ":"); // deep:d4: and deep:d4t1:
    const keys = (await (await openStore("summaries")).list("deep:")).filter((k) => prefixes.some((p) => k.startsWith(p))).sort();
    const rest = body.after ? keys.filter((k) => k > body.after) : keys;
    items = rest.map((key) => ({ key, kind: "deep", lang: key.split(":")[3] || "en" }));
    chain = (after) => fetch(`${cfg.siteUrl().replace(/\/$/, "")}/.netlify/functions/polish-background`, { method: "POST", headers: { "content-type": "application/json", "x-internal-secret": cfg.internalSecret() }, body: JSON.stringify({ kind: "deep", all: true, after }) });
  }
  const started = Date.now();
  let last = null, n = 0;
  for (const it of items) {
    if (Date.now() - started > BUDGET_MS) { console.log(`polish: budget spent after ${n} records, chaining from ${last}`); if (chain) await chain(last); break; }
    try { const r = await polishStored(it.key, { kind: it.kind || "sector", lang: it.lang || "en" }); console.log("polished", JSON.stringify(r)); }
    catch (e) { console.error("polish failed", it.key, e.message); }
    last = it.key; n++;
  }
  return new Response("", { status: 202 });
};
