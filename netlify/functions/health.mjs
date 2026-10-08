// Deployment self-check: which secrets are present and whether the data providers answer.
import { json, handler } from "../lib/http.mjs";
import { cfg } from "../lib/config.mjs";
import { fmp } from "../lib/fmp.mjs";
import { edgar } from "../lib/edgar.mjs";
import { openStore } from "../lib/store.mjs";

async function probe(fn) {
  const t = Date.now();
  try {
    const r = await fn();
    return { ok: true, ms: Date.now() - t, ...(r || {}) };
  } catch (e) {
    return { ok: false, ms: Date.now() - t, error: String(e.message).slice(0, 300) };
  }
}

export default handler(async () => {
  const env = {
    FMP_API_KEY: !!cfg.fmpKey(),
    EDGAR_TOOLS_API_KEY: !!cfg.edgarKey(),
    ANTHROPIC_API_KEY: !!cfg.anthropicKey(),
    AUTH_SECRET: !!process.env.AUTH_SECRET,
    SITE_URL: cfg.siteUrl(),
    LEMONSQUEEZY_STORE: !!cfg.lemon().store,
    LEMONSQUEEZY_WEBHOOK_SECRET: !!cfg.lemon().webhookSecret,
    locales: cfg.locales(),
  };
  const [fmpProfile, edgarHealth, blobs] = await Promise.all([
    probe(async () => { const r = await fmp("profile", { symbol: "AAPL" }); return { rows: Array.isArray(r) ? r.length : 0 }; }),
    probe(async () => { const r = await edgar("health"); return { status: r?.status }; }),
    probe(async () => { const s = await openStore("healthcheck"); await s.set("ping", { t: Date.now() }); return { value: !!(await s.get("ping")) }; }),
  ]);
  return json({ env, fmp: fmpProfile, edgar: edgarHealth, blobs });
});

export const config = { path: "/api/health" };
