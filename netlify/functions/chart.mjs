import { json, handler, param, query } from "../lib/http.mjs";
import { requireEntitled } from "../lib/entitlement.mjs";
import { chartSeries, normalizeSymbol } from "../lib/stockdata.mjs";

export default handler(async (req, context) => {
  await requireEntitled(req);
  const symbol = normalizeSymbol(param(context, "symbol"));
  const range = (query(req).get("range") || "1y").toLowerCase();
  return json(await chartSeries(symbol, range), 200, { "cache-control": "private, max-age=600" });
});

export const config = { path: "/api/chart/:symbol" };
