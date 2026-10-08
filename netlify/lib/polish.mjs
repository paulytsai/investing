// Repair pass for the research reports: the prose must name a finding in words
// ("sector quality", "事業の方向性"), never by the one-letter code Q, T or V that only
// the "finding" fields carry, and a translation must not leave English assessment
// words ("weak", "demanding") inside Japanese or Chinese sentences. The pass finds the
// affected strings, has the translation model rewrite just those, and writes them back.
import { runJson } from "./summarize.mjs";
import { cfg } from "./config.mjs";
import { openStore } from "./store.mjs";
import { LANG_NAMES } from "./prompts.mjs";

export const FINDING_NAMES = {
  sector: {
    en: { Q: "sector quality", T: "sector trajectory", V: "market expectations and valuation" },
    ja: { Q: "セクターの質", T: "セクターの方向性", V: "市場の期待と評価" },
    "zh-TW": { Q: "產業品質", T: "產業走向", V: "市場預期與估值" },
  },
  deep: {
    en: { Q: "business quality", T: "business trajectory", V: "market expectations and valuation" },
    ja: { Q: "事業の質", T: "事業の方向性", V: "市場の期待と評価" },
    "zh-TW": { Q: "事業品質", T: "事業走向", V: "市場預期與估值" },
  },
};

// The site's own renderings of the assessment labels, so prose and the label pills agree.
export const LABEL_WORDS = {
  ja: { strong: "強い", adequate: "妥当", weak: "弱い", mixed: "混在", uncertain: "不確実", improving: "改善", stable: "安定", deteriorating: "悪化", demanding: "厳しい（高い期待）", moderate: "妥当", undemanding: "控えめ", indeterminate: "判定不能" },
  "zh-TW": { strong: "強", adequate: "尚可", weak: "弱", mixed: "混合", uncertain: "不確定", improving: "改善", stable: "穩定", deteriorating: "惡化", demanding: "要求高", moderate: "合理", undemanding: "要求低", indeterminate: "無法判定" },
};
// Bump when the pass itself improves: records polished by an older version run again.
export const POLISH_VERSION = 2;

// Fields that legitimately hold codes, labels or identifiers rather than prose.
const SKIP_KEYS = new Set(["finding", "assessment", "confidence", "key", "symbol", "id", "lang", "period", "model", "translatedFrom", "generatedAt", "polishedAt", "polishVersion", "usage", "transcriptsUsed", "snapshot", "verification"]);
// A standalone Q, T or V: not part of a word, a ticker-like token (AT&T, N.V., T-Mobile) or a quarter (Q3).
const STRAY = /(?<![A-Za-z0-9&＆.\-])[QTV](?![A-Za-z0-9\-])/;
const ENGLISH_LABELS = /\b(strong|adequate|weak|mixed|uncertain|improving|stable|deteriorating|demanding|moderate|undemanding|indeterminate)\b/i;

export function needsPolish(text, lang = "en") {
  if (typeof text !== "string") return false;
  if (STRAY.test(text)) return true;
  return lang !== "en" && ENGLISH_LABELS.test(text);
}

/** Every prose string in the record that needs the pass, with its path. */
export function flaggedStrings(record, lang = "en") {
  const out = [];
  const walk = (v, path) => {
    if (typeof v === "string") { if (needsPolish(v, lang)) out.push({ path, text: v }); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, [...path, i])); return; }
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { if (!SKIP_KEYS.has(k)) walk(x, [...path, k]); }
  };
  walk(record, []);
  return out;
}

export function setPath(obj, path, value) {
  let o = obj;
  for (const k of path.slice(0, -1)) o = o[k];
  o[path[path.length - 1]] = value;
}

function systemPrompt(kind, lang) {
  const names = FINDING_NAMES[kind]?.[lang] || FINDING_NAMES[kind].en;
  const language = lang === "en" ? "English" : (LANG_NAMES[lang] || lang);
  const glossary = LABEL_WORDS[lang] ? Object.entries(LABEL_WORDS[lang]).map(([k, v]) => `${k} = ${v}`).join(", ") : "";
  const labelRule = lang === "en" ? "" : ` The text is in ${language}: where an English assessment word (strong, adequate, weak, mixed, uncertain, improving, stable, deteriorating, demanding, moderate, undemanding, indeterminate) was left inside a sentence, replace it with the ${language} word the site uses (${glossary}), adjusted to the sentence; never keep the English word, not even in parentheses.`;
  return `You copy-edit strings from a ${kind === "sector" ? "sector" : "company"} research report written in ${language}. In these strings a standalone letter Q, T or V may be shorthand for one of the three findings: Q means "${names.Q}", T means "${names.T}", V means "${names.V}". Replace each such shorthand with the full finding name in ${language}, adjusting grammar so the sentence reads naturally; "T and V" becomes the two names. Leave letters that are stock tickers or part of a name untouched (V for Visa, T for AT&T, T-Mobile, Q1 and the like) and change nothing else: same facts, figures, periods and length.${labelRule} Return JSON {"items": [...]} with exactly the same number of strings in the same order, each the edited (or unchanged) string.`;
}

const SCHEMA = { type: "object", additionalProperties: false, required: ["items"], properties: { items: { type: "array", items: { type: "string" } } } };

/**
 * Rewrites the flagged strings of a report in place. Returns { record, changed } where
 * changed is the number of strings the model altered. Marks the record polishedAt so a
 * legitimate ticker letter (Visa's V) does not trigger the pass again and again.
 */
export async function polishFindings(record, { kind, lang = "en" }) {
  const flagged = flaggedStrings(record, lang);
  const stamp = () => { record.polishedAt = new Date().toISOString(); record.polishVersion = POLISH_VERSION; return record; };
  if (!flagged.length) return { record: stamp(), changed: 0 };
  const request = (extra) => runJson({ system: systemPrompt(kind, lang), user: `Edit these strings. Return JSON only.${extra}\n\n${JSON.stringify({ items: flagged.map((f) => f.text) })}`, schema: SCHEMA, effort: "medium", maxTokens: 16000, model: cfg.translationModel() });
  let { parsed } = await request("");
  if (!Array.isArray(parsed.items) || parsed.items.length !== flagged.length) ({ parsed } = await request(` The input has ${flagged.length} strings; return exactly ${flagged.length}.`));
  if (!Array.isArray(parsed.items) || parsed.items.length !== flagged.length) { console.warn(`polish: ${kind} ${lang} returned ${parsed.items?.length} strings for ${flagged.length}; left unchanged`); return { record: stamp(), changed: 0 }; }
  let changed = 0;
  flagged.forEach((f, i) => { const v = parsed.items[i]; if (typeof v === "string" && v.trim() && v !== f.text) { setPath(record, f.path, v); changed++; } });
  return { record: stamp(), changed };
}

/** Polishes one stored record (by its summaries-store key) and saves it when anything changed. */
export async function polishStored(key, { kind, lang }) {
  const store = await openStore("summaries");
  const rec = await store.get(key);
  if (!rec) return { key, changed: 0, missing: true };
  const { record, changed } = await polishFindings(rec, { kind, lang });
  await store.set(key, record);
  return { key, changed, flagged: flaggedStrings(rec, lang).length };
}

/** Fire-and-forget request for the background pass on a stored record (once per ten minutes per key). */
export async function requestPolish(key, { kind, lang }) {
  if (!cfg.anthropicKey()) return;
  const jobs = await openStore("jobs");
  const jobKey = `job:polish:${key}`;
  const existing = await jobs.get(jobKey);
  if (existing && Date.now() - existing.startedAt < 10 * 60 * 1000) return;
  await jobs.set(jobKey, { startedAt: Date.now() });
  const url = `${cfg.siteUrl().replace(/\/$/, "")}/.netlify/functions/polish-background`;
  await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-internal-secret": cfg.internalSecret() }, body: JSON.stringify({ items: [{ key, kind, lang }] }) }).catch((e) => console.warn("polish trigger failed", e.message));
}

/** A cached record that still carries shorthand and has never been through the pass. */
export function wantsPolish(record, lang) {
  return !!record && (record.polishVersion || 0) < POLISH_VERSION && flaggedStrings(record, lang).length > 0;
}
