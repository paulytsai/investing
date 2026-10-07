import { json, handler, query } from "../lib/http.mjs";
import { searchSymbols } from "../lib/stockdata.mjs";
import { currentUser } from "../lib/entitlement.mjs";
import { HttpError } from "../lib/http.mjs";

export default handler(async (req) => {
  if (!(await currentUser(req))) throw new HttpError(401, "unauthenticated");
  const q = query(req).get("q") || "";
  return json({ results: await searchSymbols(q) }, 200, { "cache-control": "private, max-age=60" });
});

export const config = { path: "/api/search" };
