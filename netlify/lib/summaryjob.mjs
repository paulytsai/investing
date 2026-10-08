// Shared "return cached summary or start a background job" logic.
import { getCachedSummary } from "./summarize.mjs";
import { openStore } from "./store.mjs";
import { cfg } from "./config.mjs";

const JOB_TTL_MS = 8 * 60 * 1000;

export async function summaryStatus(symbol, lang, bundle) {
  if (!cfg.anthropicKey()) return { status: "disabled" };
  const cachedSummary = await getCachedSummary(symbol, lang, bundle.latestTranscriptDate);
  if (cachedSummary) return { status: "ready", summary: cachedSummary };

  const jobs = await openStore("jobs");
  const jobKey = `summary:v3:${symbol}:${lang}:${bundle.latestTranscriptDate || "none"}`;
  const existing = await jobs.get(jobKey);
  const now = Date.now();
  if (existing && existing.status === "error" && now - existing.updatedAt < 60 * 1000) return { status: "error", message: existing.message };
  if (existing && existing.status === "running" && now - existing.startedAt < JOB_TTL_MS) return { status: "pending", startedAt: existing.startedAt };

  await jobs.set(jobKey, { status: "running", startedAt: now, updatedAt: now });
  const url = `${cfg.siteUrl().replace(/\/$/, "")}/.netlify/functions/summary-generate-background`;
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-internal-secret": cfg.internalSecret() }, body: JSON.stringify({ symbol, lang, jobKey }) });
    if (!res.ok && res.status !== 202) throw new Error(`trigger failed: HTTP ${res.status}`);
  } catch (e) {
    await jobs.set(jobKey, { status: "error", message: e.message, updatedAt: Date.now() });
    return { status: "error", message: e.message };
  }
  return { status: "pending", startedAt: now };
}
