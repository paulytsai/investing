// Central environment configuration for the Netlify functions.
// Every value is read lazily so a missing optional key only fails the feature that needs it.

const SUPPORTED_LOCALES = ["ja", "en", "zh-TW"];

function env(name, fallback = undefined) {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return v.trim();
}

export function require(name) {
  const v = env(name);
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export const cfg = {
  // Locales offered on this deployment, e.g. "ja,en" for the Japanese site
  // and "zh-TW,en" for the Traditional Chinese site. First one is the default.
  locales() {
    const raw = env("SITE_LOCALES", "ja,en");
    const list = raw.split(",").map((s) => s.trim()).filter((s) => SUPPORTED_LOCALES.includes(s));
    return list.length ? list : ["ja", "en"];
  },
  defaultLocale() {
    const d = env("SITE_DEFAULT_LOCALE");
    const list = cfg.locales();
    return d && list.includes(d) ? d : list[0];
  },
  siteUrl() {
    return env("SITE_URL") || env("URL") || "http://localhost:8888";
  },
  authSecret() {
    const v = env("AUTH_SECRET");
    if (v) return v;
    // On Netlify (Lambda runtime / Blobs context present) a real secret is mandatory.
    if (env("NETLIFY") || env("AWS_LAMBDA_FUNCTION_NAME") || env("NETLIFY_BLOBS_CONTEXT")) require("AUTH_SECRET");
    return "dev-only-insecure-secret";
  },
  trialDays() {
    return Number(env("TRIAL_DAYS", "30"));
  },
  fmpKey() {
    return env("FMP_API_KEY");
  },
  edgarKey() {
    return env("EDGAR_TOOLS_API_KEY");
  },
  anthropicKey() {
    return env("ANTHROPIC_API_KEY") || env("ANTHROPIC_KEY");
  },
  anthropicBaseUrl() {
    return env("ANTHROPIC_BASE_URL");
  },
  summaryModel() {
    return env("SUMMARY_MODEL", "claude-opus-5-5");
  },
  // Translations only carry the English text across, so a cheaper model does them.
  translationModel() {
    return env("TRANSLATION_MODEL", "claude-sonnet-5-5");
  },
  lemon() {
    return {
      store: env("LEMONSQUEEZY_STORE"), // store subdomain, e.g. "mystore"
      variantId: env("LEMONSQUEEZY_VARIANT_ID", "2220324"), // Kabukaizu monthly plan
      checkoutUrl: env("LEMONSQUEEZY_CHECKOUT_URL"), // optional full buy link override
      webhookSecret: env("LEMONSQUEEZY_WEBHOOK_SECRET"),
      apiKey: env("LEMONSQUEEZY_API_KEY"),
      priceLabel: env("PRICE_LABEL", "US$10"),
    };
  },
  // The plan's price as shown on the site and in structured data. Each edition has its own
  // Lemon Squeezy store in its own currency (JPY, TWD, USD), so the three values are per site.
  price() {
    const currency = (env("PRICE_CURRENCY", "USD") || "USD").toUpperCase();
    const amount = env("PRICE_AMOUNT", "10");
    const annualAmount = env("PRICE_AMOUNT_ANNUAL");
    return {
      label: env("PRICE_LABEL", "US$10"), amount: String(amount), currency,
      // Annual plan (shown only when the Stripe annual price is set): amount per year and its label.
      annual: annualAmount && env("STRIPE_PRICE_ID_ANNUAL") ? { label: env("PRICE_LABEL_ANNUAL", annualAmount), amount: String(annualAmount) } : null,
    };
  },
  // Stripe Billing (preferred): the site's monthly price in its own currency; Managed
  // Payments makes Stripe the merchant of record (tax handled) when activated in the dashboard.
  stripe() {
    return {
      secretKey: env("STRIPE_SECRET_KEY"),
      priceId: env("STRIPE_PRICE_ID"),
      priceIdAnnual: env("STRIPE_PRICE_ID_ANNUAL"), // optional yearly price on the same product
      webhookSecret: env("STRIPE_WEBHOOK_SECRET"),
      managedPayments: env("STRIPE_MANAGED_PAYMENTS", "1") !== "0",
    };
  },
  internalSecret() {
    return env("INTERNAL_SECRET") || cfg.authSecret();
  },
  /** Accounts that always exist and never pay; passwords come from the environment. */
  builtinAccounts() {
    const list = [];
    if (env("ADMIN_PASSWORD")) list.push({ username: env("ADMIN_USERNAME", "admin"), password: env("ADMIN_PASSWORD"), role: "admin" });
    if (env("FRIEND_PASSWORD")) list.push({ username: env("FRIEND_USERNAME", "Friend"), password: env("FRIEND_PASSWORD"), role: "friend" });
    return list;
  },
  // One brand per deployment: Kabukaizu (ja), Guhaitu (zh-TW) and US Stock Almanac (en only).
  brand() {
    const d = cfg.defaultLocale();
    const id = env("SITE_BRAND") || (d === "zh-TW" ? "guhaitu" : d === "en" ? "usstockalmanac" : "kabukaizu");
    if (id === "guhaitu") return { id, name: "Guhaitu", seal: "股海圖", sub: "US Stock Almanac", sealImage: "/img/seal-guhaitu.png", favicon: "/favicon-guhaitu.png", touchIcon: "/apple-touch-icon-guhaitu.png", domain: "guhaitu.com" };
    if (id === "usstockalmanac") return { id, name: "US Stock Almanac", seal: "US Stock Almanac", sub: "Any US stock on one page", sealImage: "/img/seal-usa.png", favicon: "/favicon-usa.png", touchIcon: "/apple-touch-icon-usa.png", domain: "usstockalmanac.com" };
    return { id: "kabukaizu", name: "Kabukaizu", seal: "株海図", sub: "US Stock Almanac", sealImage: "/img/seal.png", favicon: "/favicon.png", touchIcon: "/apple-touch-icon.png", domain: "kabukaizu.com" };
  },
  // Optional: read the AI commentary and data caches from another Netlify site's Blobs
  // (the Kabukaizu site), so a second edition does not regenerate every digest.
  sharedBlobs() {
    const siteID = env("SHARED_BLOBS_SITE_ID"), token = env("SHARED_BLOBS_TOKEN");
    return siteID && token ? { siteID, token } : null;
  },
  isProduction() {
    return env("CONTEXT") === "production";
  },
};

export { SUPPORTED_LOCALES };
