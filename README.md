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
| `FRED_API_KEY` | https://fred.stlouisfed.org/docs/api/api_key.html |
| `NEWS_API_KEY` | https://newsapi.org/account |
| `ALPACA_API_KEY` / `ALPACA_SECRET_KEY` | https://app.alpaca.markets/paper/dashboard/overview |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com/settings/keys |
| `IBKR_*` | Configured in TWS / IB Gateway; no key, uses a local socket |
