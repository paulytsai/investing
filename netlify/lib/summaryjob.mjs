// Shared "return cached record or start a background job" logic for the AI
// digest and the deep-dive analysis.
import { getCachedSummary, summaryKey } from "./summarize.mjs";
import { getCachedDeep, deepKey } from "./deep.mjs";
import { openStore } from "./store.mjs";
import { cfg } from "./config.mjs";
import { requestPolish, wantsPolish } from "./polish.mjs";

const JOB_TTL_MS = 8 * 60 * 1000;
const KINDS = {
  summary: { cached: getCachedSummary, key: summaryKey, fn: "summary-generate-background" },
  deep: { cached: getCachedDeep, key: deepKey, fn: "deep-generate-background" },
};

async function jobStatus(kind, symbol, lang, bundle) {
  const K = KINDS[kind];
  if (!cfg.anthropicKey()) return { status: "disabled" };
  const cached = await K.cached(symbol, lang, bundle.latestTranscriptDate);
  if (cached) { if (kind === "deep" && wantsPolish(cached, lang)) requestPolish(K.key(symbol, lang, bundle.latestTranscriptDate), { kind: "deep", lang }).catch(() => {}); return { status: "ready", summary: cached }; }

  const jobs = await openStore("jobs");
  const jobKey = `job:${K.key(symbol, lang, bundle.latestTranscriptDate)}`;
  const existing = await jobs.get(jobKey);
  const now = Date.now();
  if (existing && existing.status === "error" && now - existing.updatedAt < 60 * 1000) return { status: "error", message: existing.message };
  if (existing && existing.status === "running" && now - existing.startedAt < JOB_TTL_MS) return { status: "pending", startedAt: existing.startedAt };

  await jobs.set(jobKey, { status: "running", startedAt: now, updatedAt: now });
  const url = `${cfg.siteUrl().replace(/\/$/, "")}/.netlify/functions/${K.fn}`;
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-internal-secret": cfg.internalSecret() }, body: JSON.stringify({ symbol, lang, jobKey }) });
    if (!res.ok && res.status !== 202) throw new Error(`trigger failed: HTTP ${res.status}`);
  } catch (e) {
    await jobs.set(jobKey, { status: "error", message: e.message, updatedAt: Date.now() });
    return { status: "error", message: e.message };
  }
  return { status: "pending", startedAt: now };
}

export const summaryStatus = (symbol, lang, bundle) => jobStatus("summary", symbol, lang, bundle);
export const deepStatus = (symbol, lang, bundle) => jobStatus("deep", symbol, lang, bundle);
