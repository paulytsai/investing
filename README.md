# investing

Two things live in this repository:

1. **Kabukaizu — US Stock Almanac** — a paid, one-page reference
   site for US-listed stocks, hosted on Netlify. Everything under `public/`,
   `netlify/`, `scripts/` and `tests/`.
2. Python API clients used for research (`investing/`), described at the end.

---

## Kabukaizu

One page per ticker, in four tabs:

| Tab | Contents |
| --- | --- |
| 概要 Overview | Key figures (market cap, forward P/E, yield, operating margin, 3-year sales growth, 52-week range), company profile, **長期トレンド** and **直近動向** (concise AI text), **強気・弱気シナリオ** (dense, evidence-first bull and bear cases), company details, competitors (AI-curated tickers verified against live quotes) |
| 業績・財務 Results & financials | 5 fiscal years + 2 consensus-estimate years + last 4 quarters (revenue, operating, pretax, net, EPS, DPS); dividends and yield; ROE/ROA/capex/D&A/R&D; cash flow; balance sheet |
| 株主・役員 Holders & management | Top-10 13F holders, institutional %, float, insider activity, officers, splits, yearly/monthly high-low-volume, SEC filings, 8-K events |
| バリュエーション Valuation | Damodaran-style FCFF DCF on consensus estimates (per-share value, WACC build-up, 5-year forecast table, WACC × growth sensitivity, collapsible methodology note) and every current valuation metric (P/E trailing and forward, PEG, P/S, P/B, P/FCF, EV multiples, yields, margins, returns, leverage) |

Above the tabs: a price chart with 1M / 3M / 6M / 1Y / 3Y / 5Y / 10Y ranges.

### Languages

One codebase, deployed as separate Netlify sites with different `SITE_LOCALES` (Japanese is the default on the main site; the UI never follows the browser language):

| Site | `SITE_LOCALES` | Toggle shown |
| --- | --- | --- |
| Japanese site (Kabukaizu, 株海図 seal) | `ja,en` | 日本語 / English |
| Traditional Chinese site (Guhaitu, 股海圖 seal) | `zh-TW,en` | 繁體中文 / English |

`SITE_BRAND` (`kabukaizu` or `guhaitu`) picks the wordmark, seal and favicon;
it defaults from `SITE_DEFAULT_LOCALE`.

UI strings live in `public/i18n.js`. AI commentary is generated and cached per
ticker **and** per language, so switching the toggle shows native-language text,
not a translation.

### Accounts, trial, billing

* Users sign up with username, email and password (scrypt-hashed). Sessions are
  HMAC-signed HttpOnly cookies. Storage is **Netlify Blobs** (`users`, `cache`,
  `summaries`, `jobs`, `billing_events` stores) — no external database.
* A **7-day free trial** starts at signup. After that, data endpoints return
  `402` until a Lemon Squeezy subscription is active.
* **Lemon Squeezy**: the Subscribe button opens the hosted checkout
  (`https://<store>.lemonsqueezy.com/checkout/buy/<variant>` with the user's
  email and id attached). The webhook at `/api/webhooks/lemonsqueezy` verifies
  the `X-Signature` HMAC and stores the subscription state on the user. Access
  is granted for `active`, `on_trial`, `past_due`, and `cancelled` until
  `ends_at`.

### Built-in accounts and the admin panel

`ADMIN_PASSWORD` and `FRIEND_PASSWORD` (with optional `ADMIN_USERNAME`,
`FRIEND_USERNAME`) define two accounts that are created on first login and
never pay. The admin account sees `/#/admin`: users and their status, signups,
active users, page views per day and per ticker, AI runs with estimated cost,
warmer status and a button to run it, and a recent-activity feed. Usage is
recorded as lightweight events in the `events` Blob store (one key per event,
no values), kept for 30 days of reporting.

Under アカウント → お支払い a subscriber can cancel (ends at period end, through
the Lemon Squeezy API when `LEMONSQUEEZY_API_KEY` is set, otherwise via the
portal) or delete the account outright after re-entering the password.

### Data sources

* **Financial Modeling Prep** (`/stable`): profile, quote, statements, key
  metrics, dividends, splits, executives, analyst estimates, peers, employee
  count, float, segment revenue, 13F holders, insider statistics, earnings
  surprises, daily prices, earnings-call transcripts, news.
* **edgar.tools** (`api.edgar.tools/v1`): SEC entity profile (CIK, SIC, state of
  incorporation, fiscal year end, 10-K business summary), filing list, 8-K
  material events, filing-derived ratios.
* **Claude** (`claude-opus-5-5` via the Anthropic SDK) writes the English
  commentary (profile, long-term trend, recent quarters, what changed versus
  the trend, bull and bear cases,
  a technical read of support and resistance, and a worldwide competitor
  list) from the last four transcripts, ~25 news items, the financial table
  and a digest of the price history. Japanese and Traditional Chinese are
  translations of that English record in a second, cheaper call, so all
  languages say the same thing. Output is schema-constrained JSON. Generation runs in a
  Netlify **background function** (up to 15 min) and the page polls until it is
  ready; results are cached until a newer transcript appears. One generation
  costs roughly US$0.30 (≈66k input tokens).

Caching (Netlify Blobs): stock bundle 12 h, daily prices 6 h, quote 5 min.

**Pre-generation.** `warm-schedule` runs hourly and starts `warm-background`
(up to 15 minutes), which walks the S&P 100 (`netlify/lib/universe.mjs`, plus
`WARM_SYMBOLS`), refreshes each bundle and generates any missing commentary in
English and the site's locales, at most `WARM_PER_RUN` new English generations
per run (default 8, so the full list fills in about half a day). Because the
cache key includes the date of the latest earnings call, a new call makes the
warmer regenerate that stock on its next pass. `GET /api/warm` shows the last
run; `POST /api/warm?key=<INTERNAL_SECRET>` starts one on demand.

### Project layout

```
public/                 static front end (no build step)
  index.html, app.js    hash-routed single-page app
  i18n.js               ja / en / zh-TW strings
  chart.js              dependency-free SVG chart
netlify/functions/      Netlify Functions v2 (Request -> Response)
  auth.mjs              /api/auth/{signup,login,logout,me,locale}
  stock.mjs             /api/stock/:symbol      full data bundle (profile, results, valuation, DCF)
  chart.mjs             /api/chart/:symbol?range=1m|3m|6m|1y|3y|5y|10y
  summary.mjs           /api/summary/:symbol?lang=ja   cached AI commentary or "pending"
  summary-generate-background.mjs   does the Claude call
  search.mjs            /api/search?q=
  billing.mjs           /api/billing/{checkout,portal}
  lemonsqueezy-webhook.mjs          /api/webhooks/lemonsqueezy
  config.mjs            /api/config (locales, price label, feature flags)
netlify/lib/            store (Blobs + local file fallback), users, session,
                        entitlement, fmp, edgar, stockdata, summarize, prompts, lemonsqueezy
scripts/dev.mjs         local dev server (no Netlify CLI needed)
tests/                  node:test unit tests
```

### Local development

```sh
npm install
cp .env.example .env     # fill FMP_API_KEY, EDGAR_TOOLS_API_KEY, ANTHROPIC_API_KEY, AUTH_SECRET
npm run dev              # http://localhost:8888 — storage falls back to .data/
npm test
```

`netlify dev` also works once the site is linked.

### Deploying to Netlify

1. Create a Netlify site from this repo (build command: none; publish `public`;
   functions `netlify/functions` — already in `netlify.toml`). Node 20+.
2. Set environment variables (Site settings → Environment variables):
   `FMP_API_KEY`, `EDGAR_TOOLS_API_KEY`, `ANTHROPIC_API_KEY`, `AUTH_SECRET`,
   `SITE_LOCALES`, `SITE_DEFAULT_LOCALE`, `PRICE_LABEL`, and the
   `LEMONSQUEEZY_*` values below. `SITE_URL` is optional (Netlify's `URL` is
   used by default; set it when using a custom domain so the background
   function is called on the right host).
3. Netlify Blobs is enabled automatically for sites using Functions.
4. For the Traditional Chinese edition, create a **second Netlify site** from the
   same repo with `SITE_LOCALES=zh-TW,en`, `SITE_DEFAULT_LOCALE=zh-TW`, its own
   domain, its own `AUTH_SECRET`, and its own Lemon Squeezy webhook. User
   accounts are per site.
5. Synchronous functions default to a 10 s limit; the stock bundle normally
   loads in 3–6 s on a cold cache. If you see timeouts, ask Netlify support to
   raise the function timeout to 26 s.

### Lemon Squeezy setup

1. Create a **subscription product** billed monthly at US$10. In store settings
   enable *localized pricing* so the checkout shows a rounded local-currency
   price (e.g. ¥2,300, NT$480) — the app itself only shows `PRICE_LABEL`.
2. Copy the product variant id into `LEMONSQUEEZY_VARIANT_ID` and the store
   subdomain into `LEMONSQUEEZY_STORE` (or paste a full buy link into
   `LEMONSQUEEZY_CHECKOUT_URL`).
3. Settings → Webhooks → add `https://<your-site>/api/webhooks/lemonsqueezy`,
   choose a signing secret (`LEMONSQUEEZY_WEBHOOK_SECRET`) and subscribe to all
   `subscription_*` events (created, updated, cancelled, resumed, expired,
   paused, unpaused, payment_success, payment_failed, payment_recovered).
4. Optional: an API key in `LEMONSQUEEZY_API_KEY` lets the "Manage billing"
   button mint a fresh customer-portal link; without it the link from the last
   webhook is used (those expire after 24 h).

Test mode works the same way — use test-mode keys and a test-mode webhook.

---

## Python API clients

Keys live in `.env` (see `.env.example`); read them through `investing.config.settings`.

| Client | Module | Example |
| --- | --- | --- |
| Financial Modeling Prep | `investing/fmp.py` | `python -m investing.fmp AAPL` |
| J-Quants (JPX) | `investing/jquants.py` | `python -m investing.jquants 7203` |
| X (Twitter) v2 | `investing/xapi.py` | `python -m investing.xapi "from:XDevelopers"` |

```python
from investing.fmp import profile, quote, get
profile("AAPL")["marketCap"]
get("income-statement", symbol="AAPL", period="annual", limit=5)
```

Variables set in the real environment take precedence over `.env`, so CI and
deployments can inject secrets without a file.
