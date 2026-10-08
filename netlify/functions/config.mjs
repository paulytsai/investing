import { json, handler } from "../lib/http.mjs";
import { cfg } from "../lib/config.mjs";

export default handler(async () => {
  const lemon = cfg.lemon();
  return json({
    locales: cfg.locales(),
    defaultLocale: cfg.defaultLocale(),
    trialDays: cfg.trialDays(),
    priceLabel: lemon.priceLabel,
    billingEnabled: !!(lemon.checkoutUrl || (lemon.store && lemon.variantId)),
    summariesEnabled: !!cfg.anthropicKey(),
    brand: cfg.brand(),
  });
});

export const config = { path: "/api/config" };
