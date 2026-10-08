import test from "node:test";
import assert from "node:assert/strict";
import { CONTRACT, provider, providerId, ProviderError, soft } from "../netlify/lib/providers/index.mjs";
import * as template from "../netlify/lib/providers/template.mjs";

test("the configured provider implements every contract method", () => {
  const p = provider();
  assert.equal(providerId(), "fmp");
  for (const m of CONTRACT) assert.equal(typeof p[m], "function", `${m} missing`);
});

test("the template exports every contract method and throws ProviderError", async () => {
  for (const m of CONTRACT) assert.equal(typeof template[m], "function", `${m} missing`);
  await assert.rejects(() => template.quote("AAPL"), (e) => e instanceof ProviderError);
  assert.equal(await soft(template.quote("AAPL"), null), null);
});

test("an unknown MARKET_DATA_PROVIDER is rejected", () => {
  process.env.MARKET_DATA_PROVIDER = "nope";
  assert.throws(() => providerId(), /Unknown MARKET_DATA_PROVIDER/);
  delete process.env.MARKET_DATA_PROVIDER;
});
