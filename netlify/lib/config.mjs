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
    return Number(env("TRIAL_DAYS", "7"));
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
  lemon() {
    return {
      store: env("LEMONSQUEEZY_STORE"), // store subdomain, e.g. "mystore"
      variantId: env("LEMONSQUEEZY_VARIANT_ID", "2220324"), // Kabukaizu monthly plan
      checkoutUrl: env("LEMONSQUEEZY_CHECKOUT_URL"), // optional full buy link override
      webhookSecret: env("LEMONSQUEEZY_WEBHOOK_SECRET"),
      apiKey: env("LEMONSQUEEZY_API_KEY"),
      priceLabel: env("PRICE_LABEL", "US$10 / month"),
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
  brand() {
    const id = env("SITE_BRAND") || (cfg.defaultLocale() === "zh-TW" ? "guhaitu" : "kabukaizu");
    return id === "guhaitu"
      ? { id, name: "Guhaitu", seal: "股海圖", sub: "US Stock Almanac", sealImage: "/img/seal-guhaitu.png", favicon: "/favicon-guhaitu.png", touchIcon: "/apple-touch-icon-guhaitu.png" }
      : { id: "kabukaizu", name: "Kabukaizu", seal: "株海図", sub: "US Stock Almanac", sealImage: "/img/seal.png", favicon: "/favicon.png", touchIcon: "/apple-touch-icon.png" };
  },
  isProduction() {
    return env("CONTEXT") === "production";
  },
};

export { SUPPORTED_LOCALES };
