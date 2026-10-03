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
| Street EPS and pre-report consensus per quarter; current FY consensus (avg/high/low); annual cash flows | FMP | 1993-2026 |
| ATM option quotes at 4-6 expiries, 16 names | IBKR | 2026-10-02 close, in `snapshots/` |
| Treasury yields (1y 4.44%, 10y 5.24%) | FRED | 2026-10-01 |
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

### 6. With consensus-basis (street) EPS, earnings are a much better anchor

FMP's per-report "actual" EPS is the adjusted street figure analysts
forecast, point-in-time at each report. TTM street EPS, quarterly changes,
2000-2026, medians across stocks:

| | GAAP net income | Street EPS |
|:--|--:|--:|
| Fundamental vol (quarterly, annualized) | 0.55 | **0.19** |
| Staples fundamental vol | 0.27 | **0.07** |
| corr(Δ multiple, Δ earnings) | −0.87 | −0.55 |
| R² of price change on earnings change, quarterly / annual | 0.00 / 0.05 | 0.00 / 0.04 |

Street EPS strips out most of the one-off noise, so the earnings line is
smooth and the multiple no longer just mirrors accounting items. But
*trailing* earnings still explain almost none of the price move. Prices
move on expectations of future earnings.

**Earnings-day moves are mostly about the outlook, not the quarter.**
Across ~10,000 reports, a 1% EPS beat moves the stock 0.12% (staples 0.24%)
net of the market, and the surprise explains 4% of the 2-day move (staples
12%). Beats average +0.9%, misses −1.8%. A typical surprise accounts for
about 1 point of a 3-8% earnings-day move. The rest is guidance and the
revised trajectory.

### 7. Do options and the valuation multiple tell the same earnings story?

For 16 names, `study_fit.py` builds one card from three independent views.

* **Valuation**: price plus the consensus EPS path go through a reverse
  DCF. EPS follows consensus, then grows at *g* to year 10, then 3%.
  Payout fades to the mature-company level. A multiple embeds growth *and*
  a discount rate, so the card shows both: the growth the price implies at
  a CAPM rate (10-year 5.24% + β × 5%), and the return it implies if growth
  follows consensus and fades to 3%.
* **Options** (IBKR quotes, 2026-10-02 close): implied vol is computed from
  call/put mids. The earnings move comes from the expiries either side of
  the next report, J² = T_post·(IV_post² − IV_pre²). The ~1-year expiry
  gives 1-year vol; removing its four earnings jumps leaves normal-day
  ("multiple") vol.
* **History and analysts**: past earnings-day moves, typical EPS surprise,
  street EPS growth vol, and analyst high/low for next year.

| | Fwd P/E | Consensus EPS growth | 10y EPS growth | Growth price implies (CAPM r) | Return price implies | Options earnings move | Past move (last 12) | Move from typical EPS surprise | Options 1y vol | EPS growth vol (hist) |
|:--|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| KO | 24.7 | 7.4% | 5.2% | **13.0%** | **5.3%** | 2.9% | 3.3% | 1.1% | 22% | 7% |
| PG | 20.5 | 5.9% | 5.9% | 10.2% | 6.0% | 4.2% | 2.9% | 1.1% | 22% | 6% |
| PEP | 14.3 | 5.0% | 6.0% | 3.3% | 8.2% | 3.3%* | 4.3% | 0.8% | 25% | 5% |
| WMT | 33.5 | 11.9% | 6.3% | **20.4%** | **4.5%** | 5.8% | 6.6% | 1.7% | 29% | 10% |
| JNJ | 20.9 | n/a | 5.6% | 9.1% | 5.8% | 3.4% | 2.2% | 0.6% | 26% | 6% |
| UNH | 17.0 | 16.1% | 11.2% | 0.9% | 10.5% | 7.5% | 12.0% | 1.1% | 34% | 14% |
| JPM | 13.2 | 6.4% | 15.4% | 8.2% | 8.7% | 3.9% | 3.3% | 1.2% | 26% | 21% |
| GS | 12.7 | 6.4% | 15.7% | 7.2% | 9.7% | 4.9% | 4.2% | 1.7% | 34% | 48% |
| AAPL | 34.7 | 11.1% | 15.1% | **24.8%** | **4.5%** | 3.8% | 4.1% | 0.4% | 28% | 25% |
| MSFT | 25.1 | 22.0% | 20.1% | 18.3% | 8.5% | 6.2% | 6.6% | 0.6% | 32% | 11% |
| NVDA | 17.6 | 16.2% | 67.6% | 22.2% | 9.3% | 6.3% | 5.8% | 0.7% | 38% | 84% |
| GOOGL | 21.0 | 13.7% | 29.3% | 18.5% | 7.7% | 6.4% | 6.5% | 1.1% | 35% | 22% |
| META | 21.9 | 17.1% | 24.0% | 19.5% | 8.3% | 7.6% | 9.9% | 1.2% | 42% | 37% |
| XOM | 14.4 | −7.2% | 12.6% | 4.9% | 5.7% | 4.0% | 1.9% | 0.8% | 29% | 150% |
| CAT | 27.3 | 19.3% | 22.0% | 18.4% | 7.2% | n/a† | 5.3% | 1.8% | 40% | 40% |
| AMZN | 22.6 | 19.3% | 51.1% | 21.3% | 8.3% | 7.9% | 8.1% | 3.2% | 36% | 78% |

\* PEP reports before any pricable expiry; move from a fit across expiries.
† CAT's pre/post quotes are too wide to separate an earnings move.

**What fits:**

* **Earnings day.** Options price the next report's move close to what
  history delivers: the ratio is 0.8-1.2 for most names. The historical
  check agrees. Using CBOE's IV drop across 314 reports (AAPL, AMZN, GOOGL,
  GS, IBM, 2011-2026), implied moves averaged 1.0-1.2× the realized moves.
  Options can't predict which report will be big: the correlation with the
  actual move is 0.01-0.21.
* **Normal-day vol.** The options' 1-year normal-day vol sits 0-6 points
  above the past year's realized (NVDA slightly below), the usual premium.
* **Growth names fit at ordinary returns.** MSFT, GOOGL, META, AMZN, NVDA
  and CAT are priced for 18-22% growth, close to consensus. Their implied
  returns of 7-9% are ordinary for their betas.

**What doesn't fit:**

* **Stable compounders are priced at bond-like returns.** At a CAPM rate,
  KO needs 13% growth (consensus 7%, history 5%), WMT 20% (12% / 6%) and
  AAPL 25% (11% / 15%). Put the other way, if consensus is right, their
  prices imply 4.5-5.3% returns, at or below the 5.24% 10-year Treasury.
  This ties back to the original hypothesis. Stable earnings earn a high
  multiple through a *low discount rate*, not high growth. And a high
  multiple driven by a low discount rate is exactly what makes the multiple
  volatile, because small changes in the required return move the price a
  lot.
* **The options' 1-year range is mostly multiple, not earnings, for stable
  names.** KO's ±22% 1-year range would mean the priced-in growth swinging
  from 9% to 17% if it were all earnings expectations. Analysts disagree
  about next year's EPS by only ±2%, and KO's street EPS growth has varied
  ±7% a year. Earnings at 7% vol against 22% option vol is about 10% of
  the variance, so most of the option-implied move must come from the
  discount rate and sentiment. For NVDA, AMZN and XOM it's the
  reverse: historical EPS volatility exceeds option vol, so earnings
  dominate.

## Bottom line

* **As a statistical split, it's mostly a relabeling.** Prices barely move
  with trailing fundamentals, GAAP or street. "Multiple vol" is largely
  price vol, and the forecasting gain mostly comes from the earnings
  calendar. There is no arbitrage. The option edge is the variance risk
  premium.
* **As a framework for making the parts fit, it's useful.** Street EPS gives
  a smooth earnings anchor. Options imply an earnings-day move that matches
  history, and that move is about the outlook, not the reported quarter.
  The reverse DCF turns each multiple into a growth (or return) assumption
  you can compare with consensus and history.
* **Where the parts disagree:** for stable compounders (KO, WMT, PG, AAPL)
  the multiple only fits consensus if investors accept bond-like returns,
  and most of their option-implied uncertainty is about the discount rate,
  not earnings. Growth names fit consensus at ordinary returns, and their
  option vol is mostly earnings.

## Next steps

1. **Fix the Alpaca credential** (HTTP 401). Alpaca has option bars from Feb
   2024 for every name, which would allow a real staples-vs-cyclicals test
   on ~2.5 years of actual option prices.
2. Log the IBKR snapshot daily (`snapshots/`) to build a forward IV panel
   for all 100 names.
3. Historical *forward* consensus snapshots (e.g. I/B/E/S) would allow the
   fit cards to be backtested: did names whose multiple implied growth far
   above consensus later de-rate? FMP keeps only the current estimates and
   the final pre-report quarterly consensus.
4. Re-pull the option term structures on a trading day (this snapshot used
   Friday-close quotes collected on a Saturday) and log them weekly.
5. Add a market-vol factor (VIX) and test delta-hedged straddles rather
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
| `consensus.py`, `study_street.py` | Part 6: street EPS decomposition, earnings response |
| `implied.py` | Option IV from quotes, earnings-move extraction, reverse DCF |
| `study_fit.py` | Part 7: fit cards (reads `snapshots/ibkr_atm_quotes_*.jsonl`) and CBOE earnings-move check |
