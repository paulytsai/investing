# investing

## API keys

1. Copy the template and fill in the keys you use:

   ```sh
   cp .env.example .env
   ```

2. `.env` is gitignored. Never commit real keys. Only `.env.example` (placeholders) is tracked.

3. Read keys in code through the shared loader:

   ```python
   from investing.config import settings

   polygon_key = settings.require("POLYGON_API_KEY")   # raises if unset
   fred_key = settings.get("FRED_API_KEY")             # None if unset
   ```

Variables set in the real environment take precedence over `.env`, so CI and
deployments can inject secrets without a file.

### Where to get keys

| Variable | Provider |
| --- | --- |
| `ALPHA_VANTAGE_API_KEY` | https://www.alphavantage.co/support/#api-key |
| `POLYGON_API_KEY` | https://polygon.io/dashboard/api-keys |
| `FINNHUB_API_KEY` | https://finnhub.io/dashboard |
| `FMP_API_KEY` | https://site.financialmodelingprep.com/developer/docs |
| `TIINGO_API_KEY` | https://www.tiingo.com/account/api/token |
| `EODHD_API_KEY` | https://eodhd.com/cp/settings/api |
| `JQUANTS_API_KEY` | https://jpx-jquants.com/ (dashboard, API key) |
| `FRED_API_KEY` | https://fred.stlouisfed.org/docs/api/api_key.html |
| `NEWS_API_KEY` | https://newsapi.org/account |
| `X_BEARER_TOKEN` | https://developer.x.com/en/portal/dashboard (app > Keys and tokens) |
| `ALPACA_API_KEY` / `ALPACA_SECRET_KEY` | https://app.alpaca.markets/paper/dashboard/overview |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com/settings/keys |
| `IBKR_*` | Configured in TWS / IB Gateway; no key, uses a local socket |

## Financial Modeling Prep client

`investing/fmp.py` wraps the FMP `stable` API and reads `FMP_API_KEY` from `.env`.

```sh
python -m investing.fmp AAPL        # prints the company profile as JSON
```

```python
from investing.fmp import profile, quote, get

profile("AAPL")["marketCap"]
quote("MSFT")["price"]
get("income-statement", symbol="AAPL", period="annual", limit=5)
```

## J-Quants client

`investing/jquants.py` wraps the J-Quants (JPX) v2 API and reads `JQUANTS_API_KEY` from `.env`.
It follows `pagination_key` automatically.

```sh
python -m investing.jquants 7203    # prints listed-issue master data as JSON
```

```python
from investing.jquants import master, daily_bars, fins_summary, get

master("7203")[0]["CoNameEn"]
daily_bars("7203", "20260901", "20260930")
fins_summary("7203")
get("markets/calendar", **{"from": "20260901", "to": "20260930"})
```

## X (Twitter) client

`investing/xapi.py` wraps the X API v2 and reads `X_BEARER_TOKEN` from `.env`.

```sh
python -m investing.xapi "from:XDevelopers"    # prints recent tweets as JSON
```

```python
from investing.xapi import search_recent, user_by_username, user_tweets, get

search_recent("$AAPL lang:en -is:retweet", max_results=50)
u = user_by_username("XDevelopers")
user_tweets(u["id"], max_results=10)
get("tweets/counts/recent", query="$NVDA", granularity="day")
```

## Volatility decomposition study

`investing/volstudy/` splits S&P 100 volatility into valuation-multiple and
fundamental components, tests vol forecasts, and backtests against CBOE
single-stock implied vol. Needs `pandas numpy statsmodels`. Findings are in
[`investing/volstudy/README.md`](investing/volstudy/README.md).

```sh
python -m investing.volstudy --fetch
```
