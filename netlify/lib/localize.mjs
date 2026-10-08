// Short provider texts (one-line company descriptions) translated once into a site language and
// cached, so tables stay in the reader's language for names that have no AI digest yet.
import { createHash } from "node:crypto";
import { cached } from "./store.mjs";
import { cfg } from "./config.mjs";
import { runJson } from "./summarize.mjs";

const LANG_NAMES = { ja: "Japanese", "zh-TW": "Traditional Chinese (Taiwan)", en: "English" };
const SCHEMA = { type: "object", additionalProperties: false, required: ["translations"], properties: { translations: { type: "array", items: { type: "object", additionalProperties: false, required: ["key", "text"], properties: { key: { type: "string" }, text: { type: "string" } } } } } };
const hash = (t) => createHash("sha1").update(String(t)).digest("hex").slice(0, 16);

/**
 * items: [{ key, text }]. Returns { key: translatedText } for every item; English is returned
 * as is. Missing translations are fetched in one request per 40 items and cached for 30 days.
 */
export async function localizeTexts(items, lang, { peek = false } = {}) {
  const out = {};
  const list = (items || []).filter((i) => i && i.key && i.text);
  if (lang === "en" || !cfg.anthropicKey()) { for (const i of list) out[i.key] = i.text; return out; }
  const missing = [];
  for (const i of list) {
    const hit = await cached(`localized:${lang}:${hash(i.text)}`, 30 * 24 * 3600, async () => null, { version: "1", peek: true }).catch(() => null);
    if (hit) out[i.key] = hit; else missing.push(i);
  }
  // peek: a page request never waits on the model; it reports what is missing instead.
  if (peek) { out._missing = missing.length; for (const i of missing) out[i.key] = i.text; return out; }
  for (let n = 0; n < missing.length; n += 40) {
    const chunk = missing.slice(n, n + 40);
    try {
      const { parsed } = await runJson({
        system: `You translate one-line company descriptions from English into ${LANG_NAMES[lang] || lang} for a stock-research site. Keep each translation to one or two short sentences, keep company and product names as written in local financial media, no commentary. Return JSON with one translation per key.`,
        user: `Translate these. Return JSON only.\n\n${JSON.stringify(chunk.map((i) => ({ key: i.key, text: i.text })))}`,
        schema: SCHEMA, effort: "low", maxTokens: 8000, model: cfg.translationModel(),
      });
      const byKey = Object.fromEntries((parsed.translations || []).map((t) => [t.key, t.text]));
      for (const i of chunk) {
        const t = byKey[i.key];
        if (t && t.trim()) { out[i.key] = t.trim(); await cached(`localized:${lang}:${hash(i.text)}`, 30 * 24 * 3600, async () => t.trim(), { version: "1", force: true }).catch(() => {}); }
        else out[i.key] = i.text;
      }
    } catch (e) { console.warn(`localize ${lang} failed:`, e.message); for (const i of chunk) out[i.key] = i.text; }
  }
  return out;
}

/** "Arm Holdings plc American Depositary Shares" -> "Arm Holdings plc". */
export function cleanCompanyName(name) {
  return String(name || "").replace(/\s*[-–,]?\s*(American Depositary (Shares|Receipts)|ADR|ADS)(\s+each\b.*)?$/i, "").replace(/\s+(Common Stock|Ordinary Shares)$/i, "").trim();
}
