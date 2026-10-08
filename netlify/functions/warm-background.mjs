// Background warmer (up to 15 minutes per run): refreshes data bundles and
// pre-generates missing commentary for the S&P 100 in every site language.
import { cfg } from "../lib/config.mjs";
import { stockBundle } from "../lib/stockdata.mjs";
import { ensureSummary, getCachedSummary } from "../lib/summarize.mjs";
import { openStore } from "../lib/store.mjs";
import { warmUniverse } from "../lib/universe.mjs";

const RUN_BUDGET_MS = 13 * 60 * 1000; // stay under the 15-minute background limit
const PACE_MS = Number(process.env.WARM_PACE_MS || 15000); // pause between English generations to respect token-per-minute limits
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (req.headers.get("x-internal-secret") !== cfg.internalSecret()) return new Response("Forbidden", { status: 403 });
  const started = Date.now();
  const maxGenerations = Number(process.env.WARM_PER_RUN || 8);
  const langs = [...new Set(["en", ...cfg.locales()])];
  const status = await openStore("jobs");
  const log = { startedAt: new Date(started).toISOString(), generated: [], translated: [], refreshed: 0, errors: [], finishedAt: null, current: null };
  await status.set("warm:last", { ...log, running: true });
  const coverage = (await status.get("warm:coverage")) || {};

  let generations = 0;
  for (const symbol of warmUniverse()) {
    if (Date.now() - started > RUN_BUDGET_MS) break;
    try {
      log.current = symbol;
      const bundle = await stockBundle(symbol); // cached 12h; refreshes the latest transcript date
      log.refreshed++;
      const missing = [];
      const ready = {};
      for (const lang of langs) { const ok = !!(await getCachedSummary(symbol, lang, bundle.latestTranscriptDate)); ready[lang] = ok; if (!ok) missing.push(lang); }
      coverage[symbol] = { ready, transcript: bundle.latestTranscriptDate || null, checkedAt: Date.now() };
      if (!missing.length) continue;
      const needsEnglish = missing.includes("en");
      if (needsEnglish && generations >= maxGenerations) continue; // leave English generations for the next run
      for (const lang of missing) {
        if (Date.now() - started > RUN_BUDGET_MS) break;
        await ensureSummary(symbol, lang, bundle);
        coverage[symbol].ready[lang] = true;
        if (lang === "en") { generations++; log.generated.push(symbol); await sleep(PACE_MS); } else log.translated.push(`${symbol}:${lang}`);
      }
    } catch (e) {
      log.errors.push(`${symbol}: ${String(e.status ? `HTTP ${e.status} ` : "")}${String(e.message).slice(0, 160)}`);
    }
    await status.set("warm:last", { ...log, running: true });
    await status.set("warm:coverage", coverage);
  }
  log.finishedAt = new Date().toISOString(); log.current = null;
  await status.set("warm:last", { ...log, running: false });
  await status.set("warm:coverage", coverage);
  return new Response("", { status: 202 });
};
