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

## Murakami-linked large holdings

`scripts/murakami_holdings.py` lists the current 5%+ positions of Murakami-linked investors in Japanese
stocks. It covers the Murakami family entities, Murakami Takateru's MI companies, and Effissimo and
Strategic Capital, which were founded by ex-Murakami Fund staff. It reads EDINET large-shareholding
filings as indexed by ufocatch.com and checks listing status with J-Quants.

```sh
python scripts/murakami_holdings.py            # writes reports/murakami_holdings_<date>.csv and .md
python scripts/murakami_holdings.py --refresh  # re-download instead of using ~/.cache/ufocatch
```
