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

## Filing watcher

`scripts/watch_filings.py` alerts you when a watched investor files a large-shareholding report
(大量保有報告書 or 変更報告書). An initial report means the investor just crossed 5%: a new position.
Watched filers live in `config/watchlist.json` (the Murakami family, Takateru Murakami's MI companies,
Effissimo and Strategic Capital); add any EDINET filer code there.

Each check makes one request for the day's full filing list, so polling every 10–15 minutes is cheap.
Most filings land between 15:00 and 17:00 JST on weekdays.

```sh
python scripts/watch_filings.py --seed --days 7       # first run: remember recent filings, no alerts
python scripts/watch_filings.py                       # check today and yesterday, alert on anything new
python scripts/watch_filings.py --loop 600            # run forever, checking every 10 minutes
python scripts/watch_filings.py --days 30 --dry-run   # preview what would have alerted
```

Alerts print to stdout and go to any channel set in `.env` or the environment: `NTFY_TOPIC`
(phone push through the free ntfy app; use a long random topic name, since anyone who knows it can read it),
`SLACK_WEBHOOK_URL`, or `SMTP_HOST` + `SMTP_USER` + `SMTP_PASS` + `ALERT_EMAIL_TO`.

### Option A: GitHub Actions (no server)

`.github/workflows/watch-filings.yml` runs the check every 15 minutes during Japanese business hours on weekdays.

1. Merge the workflow into the default branch. GitHub only runs scheduled workflows from there.
2. Add the alert settings as repository secrets (Settings → Secrets and variables → Actions), for example `NTFY_TOPIC`.
3. Run it once by hand from the Actions tab to seed its memory. Later runs alert only on new filings.

GitHub can delay scheduled runs by several minutes at busy times, so alerts may lag the filing a little.

### Option B: your own server

On any always-on Linux machine (a small cloud VM is enough), clone the repo, fill in `.env`, seed once,
then either add a cron entry (server clock in UTC; this is 09:00–18:59 JST on weekdays):

```cron
*/10 0-9 * * 1-5  cd /opt/investing && /usr/bin/python3 scripts/watch_filings.py >> watch.log 2>&1
```

or run it as a systemd service that keeps itself alive:

```ini
# /etc/systemd/system/watch-filings.service
[Unit]
Description=Large-shareholding filing watcher
After=network-online.target

[Service]
WorkingDirectory=/opt/investing
ExecStart=/usr/bin/python3 scripts/watch_filings.py --loop 600
Restart=always

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl enable --now watch-filings
journalctl -u watch-filings -f
```
