// One-sentence summaries for the collapsible sections of a research report (deep dive or
// sector report): the value chain, the analysis chapters, risks, questions, checkpoints and,
// for sectors, the constituent reads. Written by Sonnet in the report's own language from the
// report itself, cached per report version.
import { openStore } from "./store.mjs";
import { cfg } from "./config.mjs";
import { runJson } from "./summarize.mjs";
import { logEvent } from "./events.mjs";

const VERSION = "1";
const LANG_NAMES = { ja: "Japanese", en: "English", "zh-TW": "Traditional Chinese (Taiwan)" };
export const GIST_KEYS = ["battlefields", "analysis", "risks", "questions", "checkpoints", "constituents"];
const SCHEMA = { type: "object", additionalProperties: false, required: GIST_KEYS, properties: Object.fromEntries(GIST_KEYS.map((k) => [k, { type: "string" }])) };

export function gistKey(kind, id, lang, generatedAt) { return `gist:${VERSION}:${kind}:${id}:${lang}:${String(generatedAt || "").slice(0, 19)}`; }

/** Cached gists for this exact report, or generate them now (a few seconds). */
export async function ensureGist(kind, id, lang, record) {
  if (!record) return null;
  const key = gistKey(kind, id, lang, record.generatedAt);
  const store = await openStore("summaries");
  const hit = await store.get(key);
  if (hit && hit.gists) return hit.gists;
  const src = {
    battlefields: (record.battlefields || []).map((b) => ({ segment: b.segment, share: b.revenueShare, position: b.position })),
    chapters: (record.sections || []).map((s) => ({ key: s.key, headline: s.headline, body: String(s.body || "").slice(0, 600) })),
    risks: (record.risks || []).map((r) => r.risk),
    questions: record.questions || [],
    checkpoints: (record.checkpoints || []).map((c) => ({ premise: c.premise, kpi: c.kpi, failure: c.failure })),
    constituents: (record.constituents || []).map((c) => `${c.symbol}: ${c.role}`),
  };
  const { parsed, message } = await runJson({
    system: `You summarise sections of an equity research report for a one-line preview shown while the section is collapsed. Write in ${LANG_NAMES[lang] || lang}. Each field is exactly one concise sentence (at most 25 words in English, 60 characters in Japanese or Chinese) that states the substance, not the topic: name the main point, the biggest risk, the decisive question. Use only what the report says; no advice. If a section is empty, return an empty string for it. Return JSON.`,
    user: `Report sections:\n${JSON.stringify(src)}\n\nFields: "battlefields" (who captures the profit across the segments), "analysis" (the one thing the chapters together establish), "risks" (the principal risk), "questions" (the decisive question), "checkpoints" (what to watch and the failure condition), "constituents" (how the constituents divide, or empty). Return JSON only.`,
    schema: SCHEMA, effort: "low", maxTokens: 1500, model: cfg.translationModel(),
  });
  const gists = Object.fromEntries(GIST_KEYS.map((k) => [k, String(parsed[k] || "").trim()]));
  await store.set(key, { kind, id, lang, gists, model: message.model, generatedAt: new Date().toISOString() });
  await logEvent("ai_gist", { detail: `${id}_${message.usage?.input_tokens || 0}_${message.usage?.output_tokens || 0}` });
  return gists;
}
