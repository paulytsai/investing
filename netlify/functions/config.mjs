import { json, handler } from "../lib/http.mjs";
import { cfg } from "../lib/config.mjs";
import { billingProvider } from "../lib/billing.mjs";

export default handler(async () => {
  const lemon = cfg.lemon();
  return json({
    locales: cfg.locales(),
    defaultLocale: cfg.defaultLocale(),
    sampleSector: cfg.sampleSector(),
    trialDays: cfg.trialDays(),
    priceLabel: lemon.priceLabel,
    priceCurrency: cfg.price().currency,
    priceAmount: Number(cfg.price().amount) || null,
    annual: billingProvider() === "stripe" ? cfg.price().annual : null,
    billingEnabled: billingProvider() !== null,
    billingProvider: billingProvider(),
    summariesEnabled: !!cfg.anthropicKey(),
    brand: cfg.brand(),
  });
});

export const config = { path: "/api/config" };
