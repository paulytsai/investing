// Manual control for the warmer: GET /api/warm shows the last run; POST /api/warm?key=INTERNAL_SECRET starts one.
import { json, handler, query, HttpError } from "../lib/http.mjs";
import { cfg } from "../lib/config.mjs";
import { openStore } from "../lib/store.mjs";
import { warmUniverse } from "../lib/universe.mjs";

export default handler(async (req) => {
  const jobs = await openStore("jobs");
  if (req.method === "POST") {
    if (query(req).get("key") !== cfg.internalSecret()) throw new HttpError(403, "forbidden");
    const url = `${cfg.siteUrl().replace(/\/$/, "")}/.netlify/functions/warm-background`;
    const res = await fetch(url, { method: "POST", headers: { "x-internal-secret": cfg.internalSecret() } });
    return json({ dispatched: res.status === 202 || res.ok, status: res.status });
  }
  const last = await jobs.get("warm:last");
  return json({ universe: warmUniverse().length, locales: [...new Set(["en", ...cfg.locales()])], perRun: Number(process.env.WARM_PER_RUN || 8), schedule: "hourly at :17", last });
});

export const config = { path: "/api/warm" };
