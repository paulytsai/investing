// Background warmer shard (up to 15 minutes): refreshes data bundles, picks up
// new earnings-call transcripts and pre-generates missing commentary for its
// slice of the universe in every site language, a few tickers at a time.
import { cfg } from "../lib/config.mjs";
import { stockBundle, latestTranscriptDate } from "../lib/stockdata.mjs";
import { ensureSummary, getCachedSummary } from "../lib/summarize.mjs";
import { ensureDeep, getCachedDeep } from "../lib/deep.mjs";
import { openStore } from "../lib/store.mjs";
import { warmSettings, shardSymbols } from "../lib/warmer.mjs";

const RUN_BUDGET_MS = 13 * 60 * 1000; // stay under the 15-minute background limit
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (req.headers.get("x-internal-secret") !== cfg.internalSecret()) return new Response("Forbidden", { status: 403 });
  let body = {}; try { body = await req.json(); } catch {}
  const shards = Math.max(1, Number(body.shards || 1)), shard = Math.min(shards - 1, Math.max(0, Number(body.shard || 0)));
  const full = !!body.full;
  const st = warmSettings();
  const started = Date.now();
  const maxGenerations = full ? Infinity : st.perRun;
  const langs = [...new Set(["en", ...cfg.locales()])];
  const status = await openStore("jobs");
  const log = { startedAt: new Date(started).toISOString(), shard, shards, full, generated: [], translated: [], refreshed: 0, errors: [], finishedAt: null, current: null, running: true };
  const save = async () => { try { await status.set(`warm:shard:${shard}`, log); } catch (e) { console.warn("warm log save failed", e.message); } };
  const saveCoverage = async () => { try { await status.set(`warm:coverage:${shard}`, coverage); } catch (e) { console.warn("coverage save failed", e.message); } };
  await save();
  const coverage = (await status.get(`warm:coverage:${shard}`)) || {};
  const queue = await shardSymbols(shard, shards);
  const overBudget = () => Date.now() - started > RUN_BUDGET_MS;
  let generations = 0;
  const active = new Set();

  async function work(symbol) {
    active.add(symbol); log.current = [...active].join(",");
    try {
      let bundle = await stockBundle(symbol); // cached 12h
      // A newer transcript than the bundle knows about: rebuild the bundle so the commentary follows the latest call.
      const newest = await latestTranscriptDate(symbol).catch(() => null);
      if (newest && bundle.latestTranscriptDate && newest > bundle.latestTranscriptDate) bundle = await stockBundle(symbol, { force: true });
      log.refreshed++;
      const missing = [];
      const ready = {};
      for (const lang of langs) { const ok = !!(await getCachedSummary(symbol, lang, bundle.latestTranscriptDate)); ready[lang] = ok; if (!ok) missing.push(lang); }
      const missingDeep = [];
      for (const lang of langs) { const ok = !!(await getCachedDeep(symbol, lang, bundle.latestTranscriptDate)); ready[`deep-${lang}`] = ok; if (!ok) missingDeep.push(lang); }
      coverage[symbol] = { ready, transcript: bundle.latestTranscriptDate || null, checkedAt: Date.now() };
      if (!missing.length && !missingDeep.length) return;
      if (missing.includes("en") || missingDeep.includes("en")) {
        if (generations >= maxGenerations) return; // leave English generations for the next run
        generations++;
      }
      for (const lang of missing) {
        if (overBudget()) break;
        await ensureSummary(symbol, lang, bundle);
        coverage[symbol].ready[lang] = true;
        if (lang === "en") { log.generated.push(symbol); if (st.paceMs) await sleep(st.paceMs); } else log.translated.push(`${symbol}:${lang}`);
      }
      for (const lang of missingDeep) {
        if (overBudget()) break;
        await ensureDeep(symbol, lang, bundle);
        coverage[symbol].ready[`deep-${lang}`] = true;
        if (lang === "en") log.generated.push(`${symbol}:deep`); else log.translated.push(`${symbol}:deep:${lang}`);
      }
    } catch (e) {
      log.errors.push(`${symbol}: ${String(e.status ? `HTTP ${e.status} ` : "")}${String(e.message).slice(0, 160)}`);
    } finally {
      active.delete(symbol); log.current = [...active].join(",") || null;
      await save();
      await saveCoverage();
    }
  }

  async function worker() {
    while (queue.length && !overBudget()) await work(queue.shift());
  }
  await Promise.all(Array.from({ length: st.concurrency }, worker));
  log.finishedAt = new Date().toISOString(); log.current = null; log.running = false;
  await save();
  await saveCoverage();
  return new Response("", { status: 202 });
};
