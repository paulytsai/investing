import { json, handler, query } from "../lib/http.mjs";
import { logEvent } from "../lib/events.mjs";
import { searchSymbols } from "../lib/stockdata.mjs";
import { currentUser } from "../lib/entitlement.mjs";
import { HttpError } from "../lib/http.mjs";

export default handler(async (req) => {
  const user = await currentUser(req);
  if (!user) throw new HttpError(401, "unauthenticated");
  const q = query(req).get("q") || "";
  await logEvent("search", { user, detail: q });
  return json({ results: await searchSymbols(q) }, 200, { "cache-control": "private, max-age=60" });
});

export const config = { path: "/api/search" };
