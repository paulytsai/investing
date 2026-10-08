# Market-data provider contract

Everything outside `netlify/lib/providers/` gets its market data through
`provider()` from `index.mjs` and only ever sees the records below. A vendor
switch is therefore one new file (`<vendor>.mjs`, started from `template.mjs`),
one line in `REGISTRY`, and `MARKET_DATA_PROVIDER=<vendor>` in the environment.
EDGAR data (`netlify/lib/edgar.mjs`) is separate and unaffected.

Conventions: money in raw USD (callers convert to millions), ratios as
fractions (0.25, not 25), percentages only where the field name ends in `Pct`,
dates as `YYYY-MM-DD`, `null` for anything the vendor cannot supply, lists
newest first unless stated. A method throws `ProviderError` on a vendor failure;
callers that can live without the panel wrap the call in `soft(promise, fallback)`.

| Method | Returns |
| --- | --- |
| `profile(symbol)` | `{symbol, name, exchange, exchangeFullName, currency, cik, isin, sector, industry, description, website, ceo, address, city, state, zip, country, phone, ipoDate, employees, marketCap, price, beta, averageVolume, changePct, isEtf, isFund, isActivelyTrading}` or `null` |
| `quote(symbol)` / `quotes(symbols[])` | `{symbol, name, price, change, changePct, volume, dayLow, dayHigh, yearHigh, yearLow, marketCap, priceAvg50, priceAvg200, exchange, open, previousClose, time (ISO), sharesOutstanding}`; `quotes` also serves FX pairs such as `USDJPY` |
| `incomeStatements(symbol, {period: "annual"\|"quarter", limit})` | `[{date, fiscalYear, period, revenue, grossProfit, operatingIncome, pretaxIncome, netIncome, eps, epsDiluted, ebitda, interestExpense, incomeTax, rnd, sga, dilutedShares, sharesOut}]` |
| `balanceSheets(symbol, {period, limit})` | `[{date, fiscalYear, period, totalAssets, equity, retainedEarnings, cashAndShortTerm, totalDebt, netDebt, currentAssets, currentLiabilities, goodwillAndIntangibles, leases, longTermInvestments, minorityInterest}]` |
| `cashFlows(symbol, {period, limit})` | `[{date, fiscalYear, period, operating, investing, financing, cashEnd, freeCashFlow, capex (negative), depreciation, buybacks (negative), dividendsPaid (negative, all classes), commonDividendsPaid, acquisitions}]` |
| `keyMetrics(symbol, {period, limit})` | `[{date, fiscalYear, roe, roa, roic, investedCapital, capexToRevenue, rndToRevenue, sgaToRevenue, evToEbitda}]` |
| `keyMetricsTtm(symbol)` | `{roe, roa, roic, enterpriseValue, evToSales, evToEbitda, evToOcf, evToFcf, earningsYield, fcfYield, netDebtToEbitda, rndToRevenue, sgaToRevenue, capexToRevenue, inventoryDays, investedCapital}` or `null` |
| `ratiosTtm(symbol)` | `{pe, peg, pb, ps, pfcf, pocf, payout, epsTtm, bvps, fcfps, revenuePerShare, grossMargin, opMargin, netMargin, debtToEquity, interestCoverage, currentRatio, assetTurnover}` or `null` |
| `incomeGrowth(symbol)` | latest fiscal year `{date, revenueGrowth, operatingIncomeGrowth}` or `null` |
| `dividends(symbol, limit)` | `[{date (ex-date), paymentDate, amount (split-adjusted), frequency}]` |
| `splits(symbol)` | `[{date, numerator, denominator, type}]` |
| `executives(symbol)` | `[{name, title, since, active}]` |
| `estimates(symbol, limit)` | annual consensus `[{date (fiscal year end), revenue, ebit, netIncome, eps, analysts}]` |
| `peers(symbol)` | `[{symbol, name}]` |
| `employees(symbol)` | `{count, asOf}` or `null` |
| `sharesFloat(symbol)` | `{outstanding, freeFloatPct}` or `null` |
| `revenueSegments(symbol, limit)` / `revenueGeography(symbol, limit)` | `[{fiscalYear, date, data: {segmentName: revenue}}]` |
| `earnings(symbol, limit)` | `[{date, epsActual, epsEstimated, revenueActual, revenueEstimated}]`, future dates have `epsActual: null` |
| `analystRating(symbol)` | `{consensus, strongBuy, buy, hold, sell, strongSell}` or `null` |
| `priceTarget(symbol)` | `{high, low, consensus}` or `null` |
| `insiderStats(symbol)` | latest quarter `{year, quarter, purchases, sales, acquiredShares, disposedShares}` or `null` |
| `transcriptDates(symbol)` | `[{fiscalYear, quarter, date}]` |
| `transcript(symbol, fiscalYear, quarter)` | `{date, content}` or `null` |
| `dailyPrices(symbol, from)` | `[{date, close, volume}]` newest first, ten years |
| `institutionalHolders(symbol, year, quarter, limit)` | `[{name, shares, ownershipPct, changeShares, date}]` for that 13F quarter |
| `institutionalSummary(symbol, year, quarter)` | `{investorsHolding, ownershipPct, newPositions, closedPositions, increased, reduced}` or `null` |
| `screenIndustry(industry, limit)` | US-listed operating companies in the industry `[{symbol, name}]` |
| `treasury10y()` | `{rate (percent), date}` or `null` |
| `news(symbol, limit)` | `[{date, publisher, title, text, url}]` newest first |
| `compensation(symbol)` | `[{year, name, total, salary, stockAward, incentive}]` |
| `search(query, limit)` | `[{symbol, name, exchange, currency}]` (symbol and name matches, in that order) |
| `indexConstituents("sp500"\|"nasdaq100"\|"dow30")` | `[{symbol, name, sector, subSector}]`; `sector` labels are matched against `labels` in `sectors.mjs` |
| `etfHoldings(etf)` | `[{symbol, weightPct}]` |
| `health()` | `{ok, detail}` |

The symbol convention is the US ticker with `-` for share classes (`BRK-B`).

## Verifying a new provider

Record every upstream response for a few tickers with the current provider,
then replay them through the new one and diff the bundles: see
`tests/provider.test.mjs` for the contract check, and the "record/replay"
harness description in the README for the field-level comparison.
