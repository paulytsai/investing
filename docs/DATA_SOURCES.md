# Data sources — verified facts and rules

Verified 2026-09-29 from this environment (keys from environment secrets; see `.env.example`).

| Source | Used for | Point-in-time field | Coverage / limits |
|---|---|---|---|
| **FMP Ultimate** (`/stable`) | US statements (primary), prices, market cap, delisted list, S&P 500 history, earnings surprises, SEC filing index, Form 4, transcripts, 13F, ETF holdings, segments, estimates, DCF cross-check, USDJPY, treasury rates; **bulk CSV** for statements/EOD/profiles | `filingDate`/`acceptedDate` on statements; `filingDate` on 13F; call `date` on transcripts | 3,000 calls/min; statements back to 1985; prices from 2010 (`historical-price-eod/full`, dividend-adjusted variant for total return); 15,665 delisted rows. Japan `.T` symbols return statements with `filingDate = period end` → **not point-in-time**; use J-Quants for JP fundamentals. |
| **EDGAR** | XBRL `companyfacts` (RPO tag, validation of FMP), `frames`, submissions (8-K items), filing text (10-K Items 1/1A/7, 10-Q Item 2, 8-K Ex-99.1); FSDS zips as validation oracle | `filed` per fact | Needs a `User-Agent`; ~8 req/s. `efts` full-text search returns 403 (unused). |
| **Alpaca** (data only) | Daily bars 2016+ for cross-checks / delisted gaps | — | Trading hosts are not in the allowlist. |
| **J-Quants v2** (`x-api-key`) | JP master (by date), daily bars (`AdjC`, `MktCap`), `fins/summary` (決算短信: Sales/OP/NP/EPS/BPS/CFO/forecasts), earnings calendar, TOPIX (`code=0000`) | `DiscDate` | Plan covers **2016-09-30 → today**. Not on plan: `fins/details`, `fins/dividend`. |
| **EDINET v2** | 有価証券報告書 index by date (docTypeCode 120), XBRL/CSV download | submission date | Earliest served date ≈ **2016-10-04**. |
| **FRED** | DGS10/DTB3 (hurdle), CPI, USDJPY, VIX, HY OAS, oil… (§6.2 lines) | observation date | key verified |

| **X API v2** (`api.x.com`; credential attached by the environment proxy, no key in code) | @TimmerFidelity posts and self-threads (`config/x_sources.yaml`: user_id resolved once, lookback 183 days, cap 1,500 posts/run, ≈$0.005/post logged per run); chart images downloaded to `data/raw/x/media/` | post `created_at` (+1 trading day) | backfill 2026-09-29 (`--confirm`): 430 posts returned over 5 pages, 399 kept (originals + self-replies) → 372 threads, 431 chart images (49 MB), est. $2.15; later runs use `since_id`. Classification pending until `ANTHROPIC_API_KEY` is set |
| **Federal Register API** (public, no key) | Rules / proposed rules / presidential documents for `config/federal_register.yaml` searches (export controls, tariffs, antitrust, nuclear licensing, grid interconnection, oil & gas leasing, SEC rules, drug pricing) → `events` rows with `security_id = MACRO` | publication date | 370 documents over the last 365 days at first pull; context only (X-28) |

## M0 risk checks (results)
1. **Bulk CSV coverage** — `income-statement-bulk?year=2016&period=Q1`: 37,417 rows (13,774 US-style symbols), `filingDate` present; `eod-bulk?date=2016-06-30`: 51,678 rows with `adjClose`. **Rule:** a bulk row with `filingDate == date` (period end) is treated as *no filing date* and lag-imputed (`available_from = period_end + 90d FY / 45d Q`, `lag_imputed = true`).
2. **Delisted names** (30 sampled, delisted 2017–2020, US exchanges; 457 candidates): prices 30/30, quarterly statements 25/30. Names without statements are `insufficient_data`, never scored; names without prices inside a hold are counted in `missing_delisted_n`.
3. **FMP `filingDate` vs EDGAR first-filed** (60 FY pairs, 10 large caps): filing dates 60/60; values 49/60 — every mismatch is XOM, where XBRL `Revenues` includes other income (definition, not restatement). FMP stays primary.
4. **J-Quants small caps**: 20 random Standard/Growth codes have 9–57 決算短信 rows each; 14/20 reach ≤2017. **EDINET** earliest ≈ 2016-10-04.
5. **XBRL `RevenueRemainingPerformanceObligation`**: 11/12 AI-related names (VRT missing) → receipts ratio (F-40) is computable for most sellers-to-the-build-out; missing → ALERT annotation.
6. `historical-market-capitalization` reaches 2009 (AAPL: 4,462 rows). USDJPY history from 2009.

## Point-in-time conventions
- `available_from` = next trading day strictly after `filing_date` (region calendar from SPY / TOPIX bars).
- First-filed wins: `snapshot()` keeps the smallest `available_from` per (security, statement, period_type, period_end, field).
- TTM = sum of the four latest visible quarters; Q4 synthesized as FY − (Q1+Q2+Q3) only when all four are visible.
- Valuation uses `close_adj` (split-adjusted); returns use `close_tr` (split+dividend). JP total return is approximated from DPS and labelled.
- **JP per-share figures are restated to today's share basis** with the J-Quants bar `AdjFactor` for splits after the period end (Nintendo 10-for-1, 2022-09-29: pre-split EPS 4,032 → 403), so EPS/BPS/DPS stay comparable with `AdjC`; `share_basis_factor` is stored as a field for audit.
- **JP 決算短信 YTD flows** are de-cumulated per quarter; where a line is disclosed only at 2Q/FY (cash flows, often), the YTD increment is spread evenly across the quarters it covers (`lag_imputed = true`) so TTM sums stay exact. No capex, debt or gross-profit lines exist in the summary: FCF = CFO + CFI (簡易FCF) and ROIC = NOPAT / (total assets − cash) are used and labelled as proxies.
