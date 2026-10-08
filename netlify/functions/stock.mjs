import { json, handler, param } from "../lib/http.mjs";
import { logEvent } from "../lib/events.mjs";
import { requireEntitled } from "../lib/entitlement.mjs";
import { stockBundle, normalizeSymbol, liveQuote } from "../lib/stockdata.mjs";

export default handler(async (req, context) => {
  const { user } = await requireEntitled(req);
  const symbol = normalizeSymbol(param(context, "symbol"));
  const bundle = await stockBundle(symbol);
  await logEvent("view", { user, detail: symbol, req });
  // Refresh the headline quote more often than the rest of the bundle.
  try {
    const q = await liveQuote(symbol);
    if (q?.price) {
      bundle.market = { ...bundle.market, price: q.price, change: q.change, changePct: q.changePct, dayHigh: q.dayHigh, dayLow: q.dayLow, volume: q.volume, marketCapM: Math.round((q.marketCap || 0) / 1e6) || bundle.market.marketCapM, quoteTime: q.time || bundle.market.quoteTime };
    }
  } catch {}
  return json(bundle);
});

export const config = { path: "/api/stock/:symbol" };
