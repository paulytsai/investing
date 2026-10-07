// Returns the cached AI commentary for a ticker/language, or kicks off generation
// in a background function and reports "pending" so the page can poll.
import { json, handler, param, query, HttpError } from "../lib/http.mjs";
import { requireEntitled } from "../lib/entitlement.mjs";
import { stockBundle, normalizeSymbol } from "../lib/stockdata.mjs";
import { getCachedSummary } from "../lib/summarize.mjs";
import { openStore } from "../lib/store.mjs";
import { cfg, SUPPORTED_LOCALES } from "../lib/config.mjs";

const JOB_TTL_MS = 8 * 60 * 1000;

export default handler(async (req, context) => {
  await requireEntitled(req);
  const symbol = normalizeSymbol(param(context, "symbol"));
  const lang = query(req).get("lang") || cfg.defaultLocale();
  if (!SUPPORTED_LOCALES.includes(lang)) throw new HttpError(400, "invalid_locale");
  if (!cfg.anthropicKey()) return json({ status: "disabled" });

  const bundle = await stockBundle(symbol);
  const cachedSummary = await getCachedSummary(symbol, lang, bundle.latestTranscriptDate);
  if (cachedSummary) return json({ status: "ready", summary: cachedSummary });

  const jobs = await openStore("jobs");
  const jobKey = `summary:${symbol}:${lang}:${bundle.latestTranscriptDate || "none"}`;
  const existing = await jobs.get(jobKey);
  const now = Date.now();
  if (existing && existing.status === "error" && now - existing.updatedAt < 60 * 1000) {
    return json({ status: "error", message: existing.message });
  }
  if (existing && existing.status === "running" && now - existing.startedAt < JOB_TTL_MS) {
    return json({ status: "pending", startedAt: existing.startedAt });
  }

  await jobs.set(jobKey, { status: "running", startedAt: now, updatedAt: now });
  const url = `${cfg.siteUrl().replace(/\/$/, "")}/.netlify/functions/summary-generate-background`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-secret": cfg.internalSecret() },
      body: JSON.stringify({ symbol, lang, jobKey }),
    });
    if (!res.ok && res.status !== 202) throw new Error(`trigger failed: HTTP ${res.status}`);
  } catch (e) {
    await jobs.set(jobKey, { status: "error", message: e.message, updatedAt: Date.now() });
    return json({ status: "error", message: e.message });
  }
  return json({ status: "pending", startedAt: now });
});

export const config = { path: "/api/summary/:symbol" };
