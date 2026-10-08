// Warmer orchestration: the universe is split into shards, each run as its own
// background function (15-minute limit), so a full pass finishes in one go.
// Every run checks each ticker for a newer earnings-call transcript and
// regenerates the commentary when one has appeared.
import { cfg } from "./config.mjs";
import { openStore } from "./store.mjs";
import { warmUniverse } from "./universe.mjs";

const MAX_SHARDS = 16;

export function warmSettings() {
  return {
    shards: Math.min(MAX_SHARDS, Math.max(1, Number(process.env.WARM_SHARDS || 4))), // hourly run
    fullShards: Math.min(MAX_SHARDS, Math.max(1, Number(process.env.WARM_FULL_SHARDS || 10))), // "generate everything now"
    concurrency: Math.max(1, Number(process.env.WARM_CONCURRENCY || 2)),
    perRun: Number(process.env.WARM_PER_RUN || 8), // new English generations per shard per hourly run
    paceMs: Number(process.env.WARM_PACE_MS || 0),
  };
}

/** Start a warm run: one background function per shard. `full` lifts the per-run cap. */
export async function dispatchWarm({ full = false } = {}) {
  const st = warmSettings();
  const shards = full ? st.fullShards : st.shards;
  const jobs = await openStore("jobs");
  const dispatch = { startedAt: new Date().toISOString(), shards, full };
  await jobs.set("warm:dispatch", dispatch);
  for (let i = 0; i < shards; i++) await jobs.set(`warm:shard:${i}`, { startedAt: dispatch.startedAt, generated: [], translated: [], refreshed: 0, errors: [], current: null, running: true, queued: true });
  const url = `${cfg.siteUrl().replace(/\/$/, "")}/.netlify/functions/warm-background`;
  const results = await Promise.all(Array.from({ length: shards }, (_, shard) =>
    fetch(url, { method: "POST", headers: { "x-internal-secret": cfg.internalSecret(), "content-type": "application/json" }, body: JSON.stringify({ shard, shards, full }) })
      .then((r) => r.status).catch(() => 0)));
  return { dispatched: results.every((s) => s === 202 || (s >= 200 && s < 300)), shards, statuses: results };
}

/** Aggregate the shard logs of the latest dispatch into one status record. */
export async function warmStatus() {
  const jobs = await openStore("jobs");
  const dispatch = await jobs.get("warm:dispatch");
  if (!dispatch) return { last: await jobs.get("warm:last"), dispatch: null };
  const logs = (await Promise.all(Array.from({ length: dispatch.shards }, (_, i) => jobs.get(`warm:shard:${i}`)))).filter(Boolean);
  const last = {
    startedAt: dispatch.startedAt, full: dispatch.full, shards: dispatch.shards,
    generated: logs.flatMap((l) => l.generated || []), translated: logs.flatMap((l) => l.translated || []), errors: logs.flatMap((l) => l.errors || []),
    refreshed: logs.reduce((a, l) => a + (l.refreshed || 0), 0),
    running: logs.some((l) => l.running), current: logs.map((l) => l.current).filter(Boolean),
    finishedAt: logs.every((l) => l.finishedAt) ? logs.map((l) => l.finishedAt).sort().pop() : null,
  };
  return { last, dispatch };
}

/** Merge per-shard coverage records (latest check per symbol wins). */
export async function warmCoverage() {
  const jobs = await openStore("jobs");
  const parts = await Promise.all(Array.from({ length: MAX_SHARDS }, (_, i) => jobs.get(`warm:coverage:${i}`)));
  const legacy = await jobs.get("warm:coverage");
  const merged = {};
  for (const part of [legacy, ...parts]) {
    if (!part) continue;
    for (const [sym, rec] of Object.entries(part)) if (!merged[sym] || (rec.checkedAt || 0) > (merged[sym].checkedAt || 0)) merged[sym] = rec;
  }
  return merged;
}

export function shardSymbols(shard, shards) {
  return warmUniverse().filter((_, i) => i % shards === shard);
}
