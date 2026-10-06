#!/usr/bin/env node
// Sets up a Stripe TEST account for the app: the Plus and Pro products and their four prices (USD, with JPY and TWD
// currency options), idempotently. Products have fixed ids; prices are found by lookup key and only replaced when an
// amount changed (the new price takes the lookup key over and the old one is archived). Safe to run again.
//
//   STRIPE_SECRET_KEY=sk_test_... node --disable-warning=ExperimentalWarning scripts/stripe-setup.js [--portal] [--webhook URL] [--sync-db] [--dry-run]
//
//   --portal    also create or update the customer portal configuration the app uses (switching between Plus and Pro,
//               cancelling at period end, invoices, card and address updates)
//   --webhook   also create a webhook endpoint for URL (https://.../webhooks/stripe) with the events the app handles,
//               and print its signing secret for STRIPE_WEBHOOK_SECRET (only shown when the endpoint is created)
//   --sync-db   also load the prices into the app's database (DATA_DIR/app.db), as POST /api/billing/admin/sync-prices does
//   --dry-run   report what would change without changing anything
//
// For local webhooks without a public URL: stripe listen --forward-to localhost:8787/webhooks/stripe
import { config } from "../server/config.js";
import { stripe, STRIPE_VERSION } from "../server/billing/stripe.js";
import { PRICE_CATALOG, PRODUCTS, LOOKUP_KEYS, PORTAL_TAG, WEBHOOK_EVENTS, syncPricesFromStripe } from "../server/billing/index.js";

// US prices are quoted before tax; Japanese and Taiwanese consumer prices are quoted tax-inclusive (総額表示 / 含稅).
// Stripe can't change a price's tax behaviour later, so a change here means new prices (this script handles that).
const TAX_BEHAVIOR = { usd: "exclusive", jpy: "inclusive", twd: "inclusive" };
// Stripe Tax product code: software as a service, personal use (switch to txcd_10103001 for business use)
const TAX_CODE = "txcd_10103000";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const valueOf = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : (args.find((a) => a.startsWith(name + "="))?.split("=").slice(1).join("=") || null); };
const dry = flag("--dry-run");
const log = (...a) => console.log(...a);

async function main() {
  const key = config.stripeSecretKey;
  if (!key) throw new Error("Set STRIPE_SECRET_KEY (a test key, sk_test_... or rk_test_...).");
  if (!/^(sk|rk)_test_/.test(key)) throw new Error("This script only sets up a Stripe TEST account: STRIPE_SECRET_KEY must start with sk_test_ or rk_test_.");
  log(`Stripe API ${STRIPE_VERSION}${dry ? " (dry run)" : ""}`);

  // products, by fixed id
  for (const p of PRODUCTS) {
    let prod = null;
    try { prod = await stripe("GET", `/v1/products/${p.id}`); } catch (e) { if (e.status !== 404) throw e; }
    if (!prod) {
      log(`product ${p.id}: create`);
      if (!dry) await stripe("POST", "/v1/products", { id: p.id, name: p.name, description: p.description, tax_code: TAX_CODE, metadata: { plan_id: p.plan_id } }, { idempotencyKey: `cm-setup-product-${p.id}` });
    } else if (!prod.active || prod.name !== p.name || prod.metadata?.plan_id !== p.plan_id) {
      log(`product ${p.id}: update`);
      if (!dry) await stripe("POST", `/v1/products/${p.id}`, { active: true, name: p.name, metadata: { plan_id: p.plan_id } });
    } else log(`product ${p.id}: ok`);
  }

  // prices, by lookup key
  const existing = (await stripe("GET", "/v1/prices", { lookup_keys: LOOKUP_KEYS, limit: 100, expand: ["data.currency_options"] })).data || [];
  const priceIds = {};
  for (const want of PRICE_CATALOG) {
    const product = PRODUCTS.find((p) => p.plan_id === want.plan_id).id;
    const have = existing.find((x) => x.lookup_key === want.lookup_key);
    const amountOf = (price, cur) => (cur === price.currency ? price.unit_amount : price.currency_options?.[cur]?.unit_amount);
    const taxOf = (price, cur) => (cur === price.currency ? price.tax_behavior : price.currency_options?.[cur]?.tax_behavior);
    const same = have && have.product === product && have.currency === "usd" && have.recurring?.interval === want.interval &&
      Object.entries(want.currency_options).every(([cur, amt]) => amountOf(have, cur) === amt && taxOf(have, cur) === TAX_BEHAVIOR[cur]);
    if (same) { log(`price ${want.lookup_key}: ok (${have.id})`); priceIds[want.lookup_key] = have.id; continue; }
    log(`price ${want.lookup_key}: ${have ? `replace ${have.id}` : "create"}`);
    if (dry) continue;
    const { usd, ...others } = want.currency_options;
    const params = {
      product, currency: "usd", unit_amount: usd, tax_behavior: TAX_BEHAVIOR.usd, recurring: { interval: want.interval },
      lookup_key: want.lookup_key, transfer_lookup_key: true, nickname: `${want.plan_id} ${want.interval}ly`, metadata: { plan_id: want.plan_id },
      currency_options: Object.fromEntries(Object.entries(others).map(([cur, amt]) => [cur, { unit_amount: amt, tax_behavior: TAX_BEHAVIOR[cur] }])),
    };
    const sig = Object.values(want.currency_options).join("-") + "-" + Object.values(TAX_BEHAVIOR).join("-");
    const created = await stripe("POST", "/v1/prices", params, { idempotencyKey: `cm-setup-price-${want.lookup_key}-${sig}` });
    priceIds[want.lookup_key] = created.id;
    if (have && have.id !== created.id) await stripe("POST", `/v1/prices/${have.id}`, { active: false });
  }

  if (flag("--portal")) await portal(priceIds);
  const hook = valueOf("--webhook");
  if (hook) await webhook(hook);

  if (flag("--sync-db") && !dry) {
    const { openDb } = await import("../server/db.js");
    const db = openDb();
    const out = await syncPricesFromStripe(db);
    log(`app database (${config.dataDir}): ${out.prices.length} prices loaded${out.missing.length ? `, missing ${out.missing.join(", ")}` : ""}`);
  }

  log("\nNext:");
  if (!flag("--sync-db")) log("  - load the prices into the app: rerun with --sync-db, or as the owner POST /api/billing/admin/sync-prices");
  log("  - Stripe Tax must be active in the test dashboard (origin address and registrations) for Checkout's automatic tax");
  if (!flag("--portal")) log("  - customer portal: rerun with --portal, or save the default configuration in the dashboard (Settings > Billing > Customer portal)");
  if (!hook) log("  - webhooks: stripe listen --forward-to localhost:8787/webhooks/stripe, and put the whsec_... it prints in STRIPE_WEBHOOK_SECRET");
}

// the customer portal: invoices, card and address, cancel at period end, and switching between the four prices
async function portal(priceIds) {
  if (Object.keys(priceIds).length < PRICE_CATALOG.length) { log("portal: skipped (prices missing; run without --dry-run first)"); return; }
  const products = PRODUCTS.map((p) => ({ product: p.id, prices: PRICE_CATALOG.filter((x) => x.plan_id === p.plan_id).map((x) => priceIds[x.lookup_key]) }));
  const params = {
    business_profile: { headline: "Company model: plans and billing" },
    default_return_url: /^https:/.test(config.baseUrl) ? `${config.baseUrl}/account` : undefined,
    features: {
      customer_update: { enabled: true, allowed_updates: ["email", "address", "tax_id"] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: "at_period_end", cancellation_reason: { enabled: true, options: ["too_expensive", "missing_features", "switched_service", "unused", "other"] } },
      subscription_update: { enabled: true, default_allowed_updates: ["price"], products, proration_behavior: "create_prorations" },
    },
    metadata: { app: PORTAL_TAG },
  };
  const list = (await stripe("GET", "/v1/billing_portal/configurations", { active: true, limit: 100 })).data || [];
  const mine = list.find((x) => x.metadata?.app === PORTAL_TAG);
  log(`portal configuration: ${mine ? `update ${mine.id}` : "create"}`);
  if (dry) return;
  try {
    const out = await stripe("POST", mine ? `/v1/billing_portal/configurations/${mine.id}` : "/v1/billing_portal/configurations", params);
    log(`  ${out.id} (the app finds it by metadata.app = ${PORTAL_TAG})`);
  } catch (e) { log(`  couldn't save it (${e.message}); set up the portal in the dashboard instead`); }
}

async function webhook(url) {
  if (!/^https:\/\//.test(url)) throw new Error("--webhook needs an https URL (for local testing use: stripe listen --forward-to localhost:8787/webhooks/stripe)");
  const list = (await stripe("GET", "/v1/webhook_endpoints", { limit: 100 })).data || [];
  const have = list.find((x) => x.url === url);
  if (have) {
    const missing = WEBHOOK_EVENTS.filter((e) => !have.enabled_events.includes(e) && !have.enabled_events.includes("*"));
    log(`webhook ${url}: exists (${have.id})${missing.length ? `, adding ${missing.join(", ")}` : ""}; its secret is in the dashboard`);
    if (missing.length && !dry) await stripe("POST", `/v1/webhook_endpoints/${have.id}`, { enabled_events: [...new Set([...have.enabled_events, ...WEBHOOK_EVENTS])] });
    return;
  }
  log(`webhook ${url}: create`);
  if (dry) return;
  const out = await stripe("POST", "/v1/webhook_endpoints", { url, enabled_events: WEBHOOK_EVENTS, api_version: STRIPE_VERSION, description: "Company model web app" });
  log(`  ${out.id}\n  STRIPE_WEBHOOK_SECRET=${out.secret}   (shown once: put it in .env now)`);
}

main().catch((e) => { console.error(`stripe-setup: ${e.message}`); process.exit(1); });
