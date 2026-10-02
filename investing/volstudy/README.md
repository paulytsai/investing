# Multiple vs. fundamental volatility: S&P 100

The question: inside a Black-Scholes / dynamic-hedging framework, split a
stock's volatility into two parts, the valuation multiple and the
underlying fundamental:

    log P = log(P/E) + log(E)        dv = dm + df
    Var(dv) = Var(dm) + Var(df) + 2 Cov(dm, df)

Then test three things:

1. **Is the fundamental less volatile than the multiple?** By sector.
2. **Does the split help forecast forward volatility?**
3. **Is there an option trade?** Is an option mispriced when its implied
   *multiple* vol is too high given stable earnings, and is that more true
   in non-cyclical sectors?

Run everything with `python -m investing.volstudy` (add `--fetch` to refresh
data). Outputs land in `data/volstudy/out/` (gitignored).

## Data

| What | Source | Coverage |
| --- | --- | --- |
| Daily dividend-adjusted prices, daily market cap | FMP | 1999-2026 |
| Quarterly income statements (net income, operating income, EBITDA, revenue) | FMP | 1985-2026 |
| Earnings-announcement dates | FMP `earnings` | 1985-2026 |
| **Historical implied vol**: CBOE VXAPL, VXAZN, VXGOG, VXGS, VXIBM (30-day, VIX methodology, i.e. variance-swap rates) | CBOE | 2011-2026 |
| **Live implied vol**, all 102 names (`implied_vol_underlying`) | IBKR connector | snapshot 2026-10-01, in `snapshots/` |

**Option data limitations.** I have no historical option chains for most of
the S&P 100. FMP has no options endpoints. IBKR serves only live and
currently-listed contracts. Alpaca's options history (Feb 2024 onward) is
configured in this environment, but every request returns HTTP 401, so the
credential isn't working. The only real-price backtest possible here uses the
five CBOE single-stock vol indices. None of the five is a consumer staple,
so the sector question cannot be tested on real option prices yet (see
"Next steps").

## Method

* **Universe**: the current S&P 100 (102 tickers). Using today's list over a
  1999-2026 history adds survivorship bias.
* **Decomposition**: V = market cap. F = trailing-twelve-month fundamental,
  point-in-time: a quarter's figure enters on its *announcement* date. M = V/F.
  Quarters with non-positive TTM F are dropped. Four fundamentals: net income
  (P/E), operating income, EBITDA, revenue (P/S).
* **Daily split**: between announcements F is constant, so every daily return
  is pure multiple change. Variance on non-announcement days is the
  "multiple" (diffusive) vol, `dv`. The excess squared return in the 2-day
  window around each announcement is the "fundamental news" jump, `J`.
* **Forecasting**: pooled log-vol regressions on month-end samples, out of
  sample with an expanding window (fit on targets that ended before the test
  year, test 2008-2026).
* **Option test**: each month-end, short one month of variance at the CBOE
  implied vol K and hold 21 trading days. P&L per unit vega is
  (K² − RV²)/(2K), in vol points. Implied multiple vol strips the expected
  earnings jump from implied variance:
  `IVm² = IV² − 1{earnings within 30d}·J²/21`.
  Signal `sig_mult = IVm / forecast multiple vol − 1`, ranked per name using
  only prior months.

## Findings

### 1. The multiple carries almost all of the price variance

Median annualized vol across stocks, by sector. Quarterly changes,
2000-2026:

| Sector | n | Price | P/S | Revenue | Mcap/EBITDA | EBITDA | P/E | Net income | corr(dP/E, dE) |
|:--|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| Consumer Defensive | 10 | 0.20 | 0.22 | **0.04** | 0.23 | 0.12 | 0.33 | 0.27 | −0.80 |
| Healthcare | 15 | 0.25 | 0.25 | 0.07 | 0.41 | 0.33 | 0.60 | 0.56 | −0.92 |
| Industrials | 13 | 0.26 | 0.29 | 0.06 | 0.41 | 0.27 | 0.82 | 0.71 | −0.92 |
| Consumer Cyclical | 10 | 0.34 | 0.34 | 0.06 | 0.50 | 0.35 | 0.86 | 0.72 | −0.81 |
| Technology | 18 | 0.36 | 0.37 | 0.08 | 0.49 | 0.39 | 0.69 | 0.54 | −0.80 |
| Communication Svcs | 9 | 0.32 | 0.34 | 0.08 | 0.43 | 0.22 | 0.92 | 0.85 | −0.92 |
| Financial Services | 18 | 0.32 | 0.34 | 0.11 | 0.48 | 0.36 | 0.54 | 0.45 | −0.75 |
| Utilities | 3 | 0.18 | 0.24 | 0.19 | 0.29 | 0.22 | 0.44 | 0.40 | −0.91 |
| Energy | 3 | 0.26 | 0.35 | 0.24 | 0.47 | 0.45 | 0.64 | 0.68 | −0.92 |

* **The hypothesis holds, though partly by construction**: multiple vol exceeds fundamental vol for every
  stock on revenue (100%) and for about 95% of stocks on EBITDA or net income
  at the quarterly horizon. Staples have the most stable fundamentals
  (revenue vol 4%, EBITDA 12%). Energy and Utilities are the exceptions,
  where fundamental vol is close to the multiple's.
* **GAAP earnings are noisy, and the market looks through them.** TTM net
  income vol (55% median) is about *twice* price vol (29%), and
  corr(ΔP/E, ΔE) is about −0.87. Nearly every earnings change is offset by
  an opposite move in the multiple. In the accounting identity the P/E and E
  variances are both larger than price variance, and the covariance term
  cancels most of them. So "the P/E is more volatile than E" is true, but
  mostly because P/E inherits the earnings noise.
* **Trailing fundamentals explain almost none of the price move.** R² of the
  quarterly price change on the TTM fundamental change is 0-1% (2-5% at the
  annual horizon). Prices move on *expected* fundamentals and discount
  rates, which is Shiller's excess-volatility result. For an options trader
  this means the driver of day-to-day vol is the multiple, i.e. sentiment and
  discount rate. Realized fundamentals matter mainly as the jump on
  announcement days. Because fundamentals barely move with price, multiple
  vol ≈ price vol (P/S vol 0.31 vs price vol 0.30), so "multiple vol >
  fundamental vol" mostly restates "price vol > fundamental vol".

### 2. The split helps forecasts a little; the earnings calendar does most of the work

Out-of-sample R² of log forward realized vol, 2008-2026, ~21.6k
stock-months:

| Horizon | HAR (total vol) | HAR + earnings calendar & jump size (no split) | SPLIT (multiple vol + earnings jump) | FUND (SPLIT + accounting vol, P/S z-score) |
|:--|--:|--:|--:|--:|
| 21 days | 0.477 | 0.510 | **0.522** | 0.522 |
| 63 days | 0.469 | 0.478 | **0.481** | 0.474 |

Of the +0.045 gain at 21 days, +0.033 comes from knowing an earnings date
falls in the window and how big the stock usually moves on earnings. That
needs no split. Separating ex-earnings ("multiple") vol from earnings-day
vol adds the remaining +0.012. At 63 days the split adds +0.003. Trailing
accounting-fundamental vol adds **nothing**.

### 3. Real option prices: the signal works as a timing tool, not as a better forecast

CBOE 30-day implied vol, five names, 2011-2026, 940 name-months:

* **Unconditional short 1-month variance** earned +1.48 vol pts/month per
  unit vega (t = 4.3, hit rate 72%, Sharpe 0.48). That is the standard
  variance risk premium, positive for all five names.
* **The model's fair IV is calibrated**: mean fair IV − realized = +0.4 pts,
  versus IV − realized = +2.9 pts. But **IV is the better forecaster**
  (R² 0.49 vs 0.34). In an encompassing regression the model adds nothing
  (t = 0.7). The market already prices what the decomposition knows.
* **Ranking by IV vs. a forecast tells you *when* the premium is rich, but
  the split isn't what does it.** Short-variance P&L, top minus bottom
  tercile:

  | Signal | Same-month spread (vol pts/mo) | t | Pooled spread | Pooled ex-2020 |
  |:--|--:|--:|--:|--:|
  | Naive: IV / trailing 63d RV | 2.8 | 1.7 | −1.5 | 0.2 |
  | Simple: IV / (trailing ex-earnings vol + typical earnings jump), no model | 3.3 | 3.0 | 0.7 | 2.4 |
  | IV / model total-vol forecast | 4.2 | 3.0 | 0.6 | 2.1 |
  | Implied multiple vol / forecast multiple vol | 4.2 | 3.2 | 1.1 | 2.7 |

  The multiple-vol signal is 0.86 correlated with the plain forecast signal
  and performs about the same, so the edge comes from comparing IV with a
  sensible forecast that knows the earnings calendar. The same-month spread
  uses only the ~60 of 188 months where the five names fill both terciles.
  Over all months (pooled) the spread is about 1 vol pt and depends on
  2020, when the "rich" tercile lost 12.5 vol pts in the crash. Top beat
  bottom in 11 of 15 years. Four signals were tried on five names, so treat
  this as suggestive.
* **Stable vs. volatile fundamentals**: with five names this can't be
  tested reliably. For what it's worth, the most stable-revenue names (IBM,
  GOOGL) earned the *smallest* premium (0.7, 1.0 pts) and GS/AAPL the largest
  (1.7, 2.1).

### 4. Do multiple-vol spikes fade faster when fundamentals are stable?

Your trade needs this to be true. All 102 names,
`log(fwd 21d multiple vol / current) ~ log(current / 1y level)`:

* Spikes revert hard everywhere: β = −0.43 (t = −11). After the 21-day
  multiple vol rises above 1.5× its 1-year level, the next month's is about
  27% lower on average.
* **Stable fundamentals revert only slightly faster.** Stable-revenue tercile
  β = −0.45, volatile tercile −0.40. The continuous interaction
  (shock × log revenue vol) is significant (t = 2.6), but the effect is
  economically small. A staples dummy is not significant (t = −0.6).
  Healthcare reverts fastest (−0.51). Energy, Utilities and Financials revert
  slowest (−0.33 to −0.36).

### 5. Live cross-section (IBKR, 2026-10-01)

`study_live.py` applies the Part 3 models to today's 30-day implied vols.
Median `sig_mult` by sector (> 0 means implied multiple vol is rich vs.
forecast):

| Healthcare | Basic Mat. | Financials | Utilities | Real Estate | Energy | Cons. Cyclical | Industrials | Technology | **Staples** | Comm. Svcs |
|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| +0.23 | +0.21 | +0.16 | +0.16 | +0.13 | +0.12 | +0.10 | +0.08 | +0.02 | **+0.01** | −0.10 |

Staples options are **not** rich today. PG (+0.17), CL and KO (+0.12–0.14)
screen modestly rich. MO, MDLZ and WMT screen cheap. Names to check by hand:
UNH's past earnings jumps exceed its entire implied variance (the signal
floors at −0.96). NKE reported around 30 Sep, after the price data ends.
This is a single snapshot with no P&L. Its value is as the first row of a
forward-tracked log.

## Bottom line

* **"The fundamental is less volatile than the multiple"**: yes, but it is
  close to automatic. Price moves are barely correlated with changes in
  trailing fundamentals, so multiple vol is essentially price vol under a
  new name. The split relabels the variance; it does not explain it.
* **Where the split helps**: knowing that fundamentals change only on
  earnings days lets you treat those days as scheduled jumps. That improves
  1-month forecasts (R² 0.48 → 0.52), but three quarters of the gain needs
  only the earnings calendar. The split itself adds about 1 point.
  Accounting fundamental vol adds nothing.
* **Arbitrage**: none. The edge is the variance risk premium, which is pay
  for crash risk. Comparing IV with a good forecast helps time it modestly,
  and the multiple-specific version does no better than a simple one. The
  "stable earnings → richer options" link is weak and untested on real
  staples option prices.

## Next steps

1. **Fix the Alpaca credential** (HTTP 401). Alpaca has option bars from Feb
   2024 for every name, which would allow a real staples-vs-cyclicals test
   on ~2.5 years of actual option prices.
2. Log the IBKR snapshot daily (`snapshots/`) to build a forward IV panel
   for all 100 names.
3. Replace TTM GAAP earnings with consensus forward EPS (needs historical
   estimate snapshots, e.g. I/B/E/S). The "fundamental" the market prices is
   the expected one.
4. Add a market-vol factor (VIX) and test delta-hedged straddles rather
   than variance swaps once chain data is available.

## Files

| File | Purpose |
| --- | --- |
| `data.py` | FMP + CBOE loaders with on-disk cache; S&P 100 list |
| `decompose.py` | Point-in-time TTM fundamentals, daily log V / M / F panel, variance decomposition |
| `features.py` | Ex-ante vol features (multiple vol, earnings jump, accounting vol) and forward RV targets |
| `study_decomp.py` | Part 1 |
| `study_forecast.py` | Part 2 |
| `study_iv.py` | Part 3 |
| `study_reversion.py` | Part 4 |
| `study_live.py` | Part 5 (reads `snapshots/ibkr_iv_snapshot_*.csv`) |
