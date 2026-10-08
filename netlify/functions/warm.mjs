// Manual control for the warmer: GET /api/warm shows the last run;
// POST /api/warm?key=INTERNAL_SECRET starts one (&full=1 generates everything missing at once).
import { json, handler, query, HttpError } from "../lib/http.mjs";
import { cfg } from "../lib/config.mjs";
import { warmUniverse } from "../lib/universe.mjs";
import { dispatchWarm, warmStatus, warmSettings } from "../lib/warmer.mjs";

export default handler(async (req) => {
  if (req.method === "POST") {
    if (query(req).get("key") !== cfg.internalSecret()) throw new HttpError(403, "forbidden");
    return json(await dispatchWarm({ full: query(req).get("full") === "1" }));
  }
  const { last } = await warmStatus();
  return json({ universe: (await warmUniverse()).length, locales: [...new Set(["en", ...cfg.locales()])], settings: warmSettings(), schedule: "hourly at :17", last });
});

export const config = { path: "/api/warm" };
