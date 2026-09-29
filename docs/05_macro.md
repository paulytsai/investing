## §6 Macro overlay

*Condensed from P5 (Macro & Regime Views → Portfolio Translation; corpus Jul 2022 → 27 Sep 2026). Verbatim quotes, full date lists and the dated view timelines are in P5 §5.1–§5.4. Cross-references: P-xx → P1, R-xx → P2, F-xx → P3, T-xx → P6.*

**ID key.** P5's own IDs are kept verbatim:
- **M-P1–M-P13**: macro principles.
- **C1–C8**: translation channels. These are *not* compliance C-xx.
- **D1–D14**: stance-vs-practice divergences.
- **R1–R6**: regimes. These are *not* rules R-xx.
- **M-R01–M-R27**: macro rules.
- **I-01–I-60**: indicators.
- **PR-1–PR-9**: premises under inspection (点検リスト).

**Status marks:** ✔ held · ✘ wrong or missed · ↺ reversed by Paul · ~ partly right or timing off · ? open. **⚑** marks lower evidence weight. **(I)** marks an inference; "editor" means the inference is this section's, not P5's.

**At a glance**
- **Stance.** Macro gives no edge (マクロ指標は予測しづらく、しかもエッジはない). He uses macro-created selloffs to buy good companies (M-P1).
- **Practice.** Macro heavily drives three things:
  1. currency and country allocation for Japan-based savers;
  2. the barbell legs (tech/AI × energy/real assets);
  3. where cash and bonds are parked in each rate regime.
  
  Since Aug 2026 the order is explicitly top-down: asset class → sector → stock (M-P6).
- **Track record.** Strong on structural calls, weak on point and timing calls (§6.5).
- **Regime, late Sep 2026:**
  - The Fed is hiking again: 3.75–4.00%, "not one and done".
  - The 10-yr is above 5% and real rates are the highest since 2008.
  - Oil is above $100 on Iran/Hormuz.
  - The yen is off its lows on BOJ hike expectations.
  - Four premises have been inspected or corrected: PR-1 (the yen asymmetry), PR-2 (the 3–4% rate tolerance), PR-3 (curve steepening) and PR-4a–d (zero-rate-era Japan premises).
- **Engine encoding (Observed).** Encode his macro as three things:
  - (a) regime classifiers that drive allocation tilts;
  - (b) shock classifiers: "buy quality on macro dips" and "never sell for macro reasons";
  - (c) a dashboard of explicit thresholds.
  
  **Never** use his point forecasts as trading signals. His own rule is to judge edge by whether the process was right, not by whether the call hit (2026-09-27; P-21, F-93).

**Macro evidence caveats** (→ P5 header; §11)
- ⚑ **Possibly AI-assisted 2024 columns:** 05-13, 05-27, 06-12, 08-12, 08-19 and 08-26. Macro items dated 2024-08-26 and 2024-05-27 carry ⚑.
- ⚑ **AI-drafting residue:** 2025-12-04/11/13, 2026-01-14/28 and 2026-02-16. The framings "最強の略奪者" (strongest plunderer) and "冷徹なリアリズム" (cold realism) may be AI suggestions that he adopted.
- ⚑ **The 2026-03-31 series** is a curated compilation of older columns, so its views may predate the tag. Its "日本在住" (lives in Japan) line is an error. Don't propagate it.
- ⚑ **The 2026-03-24 Zoom's market figures** come from Timmer and Dalio (third-party). This weakens M-R05 (the 4.5% line), the MOVE > VIX reading behind M-R07 and I-07, and I-51's BTC–USD correlation. Separately, P2 R-80 notes that the exact 60/20/20 split is inferred.
- **Date fix:** the "2026 outlook" file named 20261222 is **2025-12-22**.

### 6.1 Stance vs practice

**(a) Stated macro principles**

| ID | Principle | Str · prov | Current (Sep 2026)? | See also |
|---|---|---|---|---|
| M-P1 | **Macro has no edge.** Don't bet on macro forecasts. Use macro-created chances to buy good companies (マクロが作ったチャンスを利用して株を買います). Selling for macro reasons is usually wrong (マクロの理由で売るのは間違えることが多いです). He says his macro commentary is "only to explain short-term stock moves". | Core · 2022→26, n≈9 | Yes; emphasis shifted to M-P6 | P-14, P-42, R-96, F-90, T-03 |
| M-P2 | **One month's data never changes the mid-term view** (単月の数字で過度に中期の視点を変更するのは危険). Buy what the print made cheap. | Core · 2023→24, n=5 | Yes | R-44 |
| M-P3 | **Timing slippage on a macro call doesn't matter** to a mid/long-term investor. | Stated · 2023, n=1 | Yes | — |
| M-P4 | **Elections don't steer strategy.** "Who is president may not matter much… Trump somewhat better for stocks." A big election-driven drop is a buy. | Core · 2023→24, n=4 | Yes | R-101 |
| M-P5 | **Structure over prediction.** Design to survive any shock (何度来ても生き残れる設計). Sort each worry into a "predictable temporary shock" or a "long-term structural change". An event is a real risk only if it moves **oil and rates for a long time**. Use a crisis to check the design, not to trade. | Core · 2026, n=3 (incl. ⚑series) | Yes | P-06, F-75, R-86, R-94, R-105 |
| M-P6 | **Top-down order (a new emphasis):** asset class → sector → stock (まず資産クラスを選ぶ。次にセクターを選ぶ。個別株は最後です). Fight the big currents (rates, inflation, the economy, currency) and even great picks underdeliver. Precursor: "sector × timing × stock" (2023-09-08). | Stated (Core with the precursor) · 2026, n=2 | **Current framing** | P-11, F-98, T-28 |
| M-P7 | **Inspect premises instead of trading** (売り買いではなく、前提の点検). A wobbling premise goes formally on the inspection list rather than being retracted at once (撤回はまだしません。ただ、点検リストには正式に載せます). Publish corrections. 前提が変わったなら見方を変える。それも投資です (if the premise changes, change the view; that is investing too). | Core · 2026, n=4 | **Yes** | P-28, R-47, F-108 |
| M-P8 | **Rates, not inflation, drive valuation** (株価形成に重要なのはインフレではなく、金利です). The 10-yr is "the sun" of all financial products and the economy's thermometer (金利は経済の温度計). | Core · 2022→24, n=3 | Yes | F-18, F-60 |
| M-P9 | **Forecast the drivers, not the outcome** (driver analysis, ドライバー分析). | Stated · 2023, n=2 | Yes | F-107, F-58 |
| M-P10 | **Market as messenger.** Read what prices say (円安は長引きします。株式市場はそれを言っています。). What is already priced in (織り込み) can't pay. "Consensus isn't always wrong." | Core · 2022→25, n=4 | Yes | P-25, F-16, F-57 |
| M-P11 | **Lived experience before statistics.** He judges inflation "by daily life"; change shows up in the field before it shows in the data. | Core · 2024→26, n≥5 | Yes | P-26, F-112 |
| M-P12 | **Crises are resolved through inflation,** so fleeing to cash is the real danger. Cash is not risk-free in an inflation regime. | Core · 2023→26, n≈6 | Yes | P-16, R-108, R-123, F-62 |
| M-P13 | **The US-instability paradox.** Turmoil in the US makes the US relatively safer, and money flows into the dollar in every crisis (アメリカが不確定になる時こそ、アメリカに投資しなければいけないです。). | Core · 2023→26, n≥8 | Yes, tempered by the dollar-confidence hedge (PR-8) | P-15, F-69, R-83 |

**(b) How macro legitimately enters decisions**

**Allocation order (M-P6; D2, D14; R-87).** Macro sets the weights for **asset class, sector, currency, cash parking and hedge size**. The stock itself is chosen bottom-up, on "story and price".
- Config: `timing.macro_overlay_allowed: true` and `timing.macro_overlay_scope: [asset_class, sector, currency, cash_parking, hedge_size]`.
- Paul still needs to confirm the scope (Q11).

| Ch. | Macro input → typical action (Observed) | Str · prov | Rules · config |
|---|---|---|---|
| C1 | **Currency and country allocation for Japan-based savers.** Inputs: structural yen weakness, BOJ constraints, demographics, fiscal position. Actions: <ul><li>US/global stocks as the core;</li><li>yen only for money you might spend (個人向け国債, JGBs for individuals; deposits);</li><li>no FX hedge on foreign stocks;</li><li>add USD on yen strength;</li><li>a small Japan weight, held via DXJ (yen-hedged) or selective names;</li><li>fixed-rate mortgages.</li></ul> **This is the most persistent macro → allocation link.** | Core · 2022→26, ≥40 dates | M-R15, M-R16; R-111–R-119 · `fx.hedge_policy`, `fx.jp_reader_overseas_target_pct` |
| C2 | **Barbell legs.** Inputs: inflation and geopolitics vs rate-insensitive growth. Actions: tech/AI × energy (oil majors), plus uranium. The third element has varied: REITs (2022) → real estate (2026-01) → gold (2026-03). Leg sizes move with the regime. | Core · 2022→26 | M-R07, M-R24; R-77, R-95, F-94, T-17 · `construction.sleeves`, `construction.sleeve_weights`, `hedge.energy_gold_ratio` |
| C3 | **Rate-cycle sector playbook.** <ul><li>Rates peaking or falling: long-duration tech, REITs (XLRE/VNQ), small caps, EM, commodities, uranium, China tech.</li><li>Rates rising: avoid venture-like tech and trim REITs.</li><li>Rates high and the curve flat: insurers > large banks/IBs > regionals.</li><li>Rising-rate years since 2001 have favoured financials and energy.</li></ul> **The realized results were poor for REITs, small caps and EM (D3).** | Core (low realized value) · 2022→26 | M-R09–M-R12; R-87 · `timing.rate_cycle_sector_tilts` |
| C4 | **Cash and bond parking by rate regime.** <ul><li>2023-01: cash and MMF ("stocks + cash beats 60/40").</li><li>2023-09 → 11: Treasuries near the peak, then short Treasuries (SCHO/VGSH/SPTS) and ladders.</li><li>2025-01: keep fixed income low.</li><li>2026-08: no long bonds; short Treasuries (SGOV/SCHO).</li><li>Yen side: 個人向け国債 or time deposits.</li></ul> | Core · 2023→26, n≈10 | M-R06, M-R13, M-R26; R-82, R-120, R-121, F-100 · `cash.parking_instruments`, `cash.hurdle_rate_source` |
| C5 | **Pace and aggressiveness.** <ul><li>Build gradually during drawdowns.</li><li>Don't be aggressive while the S&P makes lower highs and lower lows.</li><li>Buy macro dips in names whose thesis is intact.</li><li>Spread purchases over time more as conviction rises.</li></ul> | Core · 2022→26 | M-R01; R-30 · `entry.staged_tranches` |
| C6 | **Reframing tail risks.** Wars, the debt ceiling, FTX, SVB, elections, tariffs, shutdowns and Iran strikes are treated as "noise" or a buying chance. The US is the haven. | Core · 2022→26 | M-R03, M-R17, M-R18; R-101, R-105 |
| C7 | **Stock filters keyed to the regime:** <ul><li>"AI is rate-insensitive" (2023-06).</li><li>"Trends tariffs can't touch" (2025-03).</li><li>"AI, inflation and large deficits are the long-term trends" (2025-04).</li><li>"Firms that can pass energy costs on" (2026-08).</li><li>"In a 5% world only profit growers withstand" (2026-09).</li></ul> | Core · 2023→26 | M-R06; F-59 |
| C8 | **Reviewing hedge size after a shock.** <ul><li>Add energy and gold at a set ratio (一定比率).</li><li>Review toward 60/20/20 (stocks/bonds/hard money).</li><li>Hold several years of living expenses in safe assets.</li><li>Rebalance after shocks.</li></ul> | Stated · 2026, n=3 | M-R07; R-80, R-81, R-94, F-97 · `hedge.energy_gold_ratio`, `construction.review_mix_stocks_bonds_hardmoney` |

**First-year pattern (2022-07 → 11, I).** Macro set four things:
1. how aggressive to be;
2. which sectors (energy for inflation and under-investment; stable tech over venture tech while rates rise);
3. the case for FX diversification for Japanese readers;
4. how to reframe tail risks.

Channels C4, C7 and C8 extend the same pattern.

**Energy-leg rationale (→ P5 §5.3.10).** The rationale changed four times:
1. a cyclical inflation trade (2022–23);
2. a permanent barbell hedge against inflation and geopolitics (2023-12 →);
3. an inflation hedge replacing bonds (⚑series);
4. AI's raw material: uranium "for the same reason as AI" (2026-08).

**Tension.** A uranium leg that is correlated with AI does not hedge an AI downturn; the oil/gold leg still does.

**Current.** Oil majors are held as insurance and valued on reserves and capital returns. Uranium is held as an AI-power complement.

**(c) What macro must NOT do**
1. **Be the reason to sell a thesis-intact name.** In a macro or news selloff where the thesis is intact, buy gradually and never sell (M-R01; M-P1; R-106 HARD; P-02). Config: `crisis.block_panic_macro_sells: true`.
2. **Trigger selling US stocks over a Taiwan contingency or frontline war risk.** Doing so is 「ほぼ確実に間違いです」 (almost certainly wrong) (M-R18).
3. **React to one data print** (CPI, jobs, PMI) (M-P2, M-R02).
4. **Trade in the first days of a geopolitical shock,** or treat the shock as real before it moves oil and rates for a long time (M-R03, M-P5). Config: `crisis.cooling_off_days: TBD(Paul)`.
5. **Let elections or politics steer strategy.** Keep the conclusion (stay in US assets) and drop the election trades (M-P4, M-R17, D4).
6. **Turn point forecasts or timing calls into trades** (D1, D5). His timing is only position adjustment (ポジション調整程度) (R-96).
7. **Justify a position by the rate cycle alone.** Rate-cut sector rotations need a stock thesis that stands on its own (D3, M-R11).
8. **Chase energy after an event spike** (M-R04, M-R24; R-36).
9. **Flee to cash, or treat cash or long bonds as a store of value,** in an inflation regime (M-P12, M-R14).
10. **Stop diversifying out of yen because the yen strengthens.** Stagger purchases instead of stopping (M-R15; PR-1).
11. **Treat HY as a safe yield** (I-53), or **use PPP as an FX target** (D10).
12. **Score his calls from his own self-reports** (D6).

**(d) Where practice diverges from the stance**

| ID | Divergence (evidence) | His reconciliation → engine note | Tension |
|---|---|---|---|
| D1 | **Heavy dated macro forecasting, 2022–23.** Fed to ~5% then ~3.5%; S&P >4,100 in 2023; inflation at 4.5–5% through 2023; China reopening timing; "S&P may be bottoming". | "Markets are hard to predict, but keep a mental scenario." → Treat these as scenario-setting, not signals. | T-02, T-03 |
| D2 | **Allocation is macro-driven:** underweight Japan, diversify out of yen, DXJ, short Treasuries, bond ladders (2023-10 → 2024-08). | Implied: macro for allocation and currency, not for trading single stocks. Made explicit on 2026-08-21 (M-P6). → Encode macro at the allocation layer only. | T-03 |
| D3 | **Rate-cut sector bets that mostly lagged.** <ul><li>XLRE/VNQ added 2023-12-14; small caps 2024-09-20; EM 2024-09-10; "real estate & uranium progressing as planned" (2024-07-12).</li><li>Real estate lagged in 2025 and BXP was a March-2026 detractor. Real estate ETFs became "weeds" and a trim candidate (2026-08-28).</li><li>Small caps were the worst performers YTD (2025-07-04).</li><li>EM flipped to "will struggle" (2024-11-18).</li></ul> | None stated. → Give low weight to sector bets based only on the rate cycle; require a stock-level thesis. | — |
| D4 | **Election and Trump trades** despite "who is president doesn't matter much": GEO and energy deregulation (2024-07-18), financials after the win (2024-11-28), a tech overweight vs MAGA (2025-01-03). | The conclusion never changes: stay in US assets. → Keep the conclusion; drop the trades. | — |
| D5 | **Market-timing calls** despite "timing is near-impossible": <ul><li>"S&P may be bottoming" (2022-10-06);</li><li>"the last big buying opportunity" (2025-03-11/13);</li><li>"S&P ~6500 = near-term bottom" (2025-11-27);</li><li>"market peak in ~4–5 months", a technical analogue to LTCM 1998 (2025-11-25);</li><li>exit an AI bubble "by feel" (2024-08-28).</li></ul> | "Only position adjustment" (ポジション調整程度); charts are a secondary input. → Log as low-weight commentary. | T-01, T-02 |
| D6 | **Claimed foresight that doesn't match his record.** <ul><li>"Powell pivot, which I predicted for months" (2023-12-14), yet he called 5.25% the peak (2023-05-05) and expected more hikes (2023-06-30).</li><li>"China exited zero-COVID as predicted" (2022-12-12), yet he had forecast a reopening in Q2/H2 2023.</li></ul> | — → Score calls from the record, never from self-reports. | — |
| D7 | **"Don't hedge FX" vs promoting DXJ.** Don't hedge (2022-12-01) vs DXJ recommended or praised (2023-10-18, 2024-05-06, 2025-01-10, 2025-07-04). | DXJ is Japan equity exposure with the yen stripped out (exporters + hedge), which is consistent with a weak-yen view. → Rule: foreign assets unhedged; Japan equity may use a yen-hedged vehicle. | T-20 |
| D8 | **Energy's role.** <ul><li>In 2023 energy was a cyclical trade: "oil late", "sell energy by end-2023 or 2024", CVX trimmed.</li><li>The Fundsmith-style columns say "long-term investors avoid energy" (2025-02).</li><li>Yet energy is also a permanent barbell leg (2026-09).</li></ul> | Resolved in 2026: majors are held as insurance, valued on reserves and capital returns, not as a bet on the oil price. → Energy is an insurance sleeve, not an oil call. | T-05 |
| D9 | **Gold was rejected, then adopted.** <ul><li>Rejected on price (2025-04-21) and on principle, since it "produces nothing" (2025-08-08, 10-20).</li><li>Adopted as a Capital-Wars / inflation hedge (2026-01-14/23) and put in the hedge leg at "a set ratio" (2026-03-29).</li></ul> | Regime change: currency dilution and the dollar-confidence test. → **Current: gold is in the hedge leg.** No ticker is named; the ratio is TBD(Paul). | T-18 |
| D10 | **PPP anchor vs the yen view.** PPP says the yen is undervalued (41.2% in Dec 2022; ~46.3% on 2025-09-15), which implies appreciation. Yet he expects no sustained yen strength. | The adjustment comes through Japanese prices rather than through FX (2023-11-06; 2024-01-04; 2024-04-08). → Encode PPP as "Japanese inflation pressure", not as an FX target. | T-12 |
| D11 | **Uneven "temporary" labels (2024).** US and China problems are called temporary or cyclical; Japan's are called fundamental. | — → Watch for home-country pessimism bias. | — |
| D12 | **Inflation vs deflation.** Tariffs and fiscal policy are inflationary (2025-04 → 06), yet AI is "a persistent deflationary force" (2025-08-12; also 2023-10-05 and 2023-12-19). | Never made explicit. Implied: policy inflation in the short run, AI disinflation structurally. → Model them as separate drivers. | — |
| D13 | **Cash.** "Hold ~30% cash" (2023-01-19) vs "cash holders are the first losers under financial repression" (2025-04-21) vs "always hold cash" (2025-07-28). | Cash depends on its role: USD dry powder (~5%) or spendable money, never a long-term store. → Split cash into dry powder vs a spending buffer. | T-04 |
| D14 | **Top-down (2026-08-21) vs mostly bottom-up files** judged on "story and price". | Possibly driven by long yields above 5%. → The current version is top-down for allocation and bottom-up for the stock itself. | T-28 |

**(e) Regime map.** The regime labels are inferred (I); the actions are explicit (E) from the dates cited. Config: `macro.regime ∈ {R1…R6}` (a classifier).

| Regime (his period) | Macro signature | Allocation he used |
|---|---|---|
| R1 Tightening / inflation shock (Jul 2022 → early 2023) | Fast hikes, CPI 8–9%, all assets falling, strong USD | <ul><li>Oil majors (XOM/COP/CVX, MPLX).</li><li>Stable tech over venture tech; REITs / "inflation-resistant" names.</li><li>Cash/MMF instead of bonds; build gradually.</li><li>TSM and ATVI-type uncorrelated names.</li><li>FX diversification is urgent.</li></ul> |
| R2 Rate peak / pivot (mid → late 2023) | Fed pauses; the 10-yr peaks at 4.99% then falls | <ul><li>Add Treasuries, then short Treasuries and ladders.</li><li>BXP (2023-09-15) and XLRE/VNQ (2023-12-14).</li><li>Tech on AI.</li><li>Oil trimmed on rallies; uranium carries the energy leg.</li></ul> |
| R3 Easing cycle (Sep 2024 → Jan 2026, interrupted by the Trump/tariff shock) | Cuts and a soft landing, then tariff stagflation risk | <ul><li>EM and small caps (2024-09); real estate; uranium.</li><li>China tech, bought gradually over ~1 yr.</li><li>Tariff dip = buy quality (2025-04).</li><li>Gold/oil favoured under financial repression.</li></ul> |
| R4 Inflation / currency-dilution regime (2025 →) | Deficits, erosion of Fed independence, record gold | <ul><li>Equities over bonds and cash.</li><li>Real assets (energy, pipelines, gold, real estate).</li><li>"Select assets by structure (scarcity / productivity / psychological liquidity)".</li><li>US core.</li></ul> |
| R5 Geopolitical oil shock (Mar 2026 →) | Iran/Hormuz, Brent $119, MOVE > VIX | <ul><li>Energy and gold at a set ratio; review toward 60/20/20.</li><li>Hold AI; buy tested support levels.</li><li>Don't chase energy.</li></ul> |
| R6 金利のある世界 fully back (Aug–Sep 2026) | Fed hiking into strong growth; 10-yr >5%; JGB >3% | <ul><li>Short bonds.</li><li>Earnings growers only (選別の時代, the era of selection).</li><li>Financials ordered insurers > big banks > regionals.</li><li>Japan uses the total-return lens; spendable yen goes to 個人向け国債.</li><li>The yen premise is under inspection.</li></ul> |

### 6.2 Indicator dashboard

**His dashboards**
- **Minimal Fed gauges** (after Jackson Hole, 2024-08-28): the yields, the mortgage rate, CPI and oil. The verbatim list names the 10-, 1- and 30-yr yields (→ P2 R-99). Suggested series: DGS10, DGS1, DGS30, MORTGAGE30US, CPIAUCSL, DCOILWTICO.
- **AI-cycle dials** (2026-08-04): utilization (点灯率, the "lit rate"), backlog growth, power prices.
- **Geopolitical "three lines"** (2026-03-29):
  1. the oil level and how long it lasts;
  2. the conflict's scale and duration;
  3. Hormuz control, which drives confidence in the USD and Treasuries.

**Gaps.** He states **no yield-curve-inversion recession rule, no Sahm-type rule and no VIX-level rule** anywhere in the corpus. These are TBD(Paul) (Q9). HOPE is his only named cycle-staging tool.

**How to read the tables**
- **Thresholds** are as written by him.
- **The "Series" column** is the editor's *suggested default* data mapping for the engine. It is not Paul's content; verify availability at build time.
- **"derived"** means the engine computes the series from other series.

**A. US rates & the Fed**

| ID | Indicator: his read | Thresholds / rules of thumb | Series (suggested default) | Implication | Str · prov |
|---|---|---|---|---|---|
| I-01 | **US 10-yr.** "The sun" of asset pricing and the economy's body temperature (体温): a vital sign that can't diagnose alone and also reflects risk appetite. It sets the hurdle. | <ul><li>Sustainable regime: 3–4% nominal / 1–2% real, as in 2000–08 (2022-09).</li><li>3–3.5% is "not tasty" for bonds (2023-01).</li><li>Going forward 4–5%, not below 3% (2024-05).</li><li>**>4.5% = danger line for all risk assets, including growth** (Timmer ⚑, 2026-03).</li><li>**5% exceeds the "US can bear 3–4%" premise** (2026-09-11).</li><li>~5%/yr = the risk-free "certain one point" (2026-09-27).</li></ul> | DGS10 (daily) | <ul><li>A falling 10-yr lifts long-duration tech and REITs.</li><li>Above 4.5%, growth is under pressure.</li><li>At 5% and above: select stocks over the index; avoid long bonds.</li></ul> | Core · 2022→26, n≈21 |
| I-02 | **30-yr, auctions, Treasury buybacks.** Long-end stress and the government's worry. | <ul><li>30-yr ~5.31%, highest since 2007.</li><li>Auction at 5.216%, highest since 2001.</li><li>Buybacks raised $2B → $4B+ = 「政府が長期債の需給をここまで気にし始めた」 (the government has started worrying this much about long-bond supply and demand) (2026-08-21).</li><li>A $6B buyback didn't stop the rise; 30-yr 5.37% (2026-09-11).</li></ul> | DGS30; Treasury auction & buyback results | Avoid long bonds; short Treasuries; own growth equities | Stated · 2023→26, n=4 |
| I-03 | **Fed path: dots vs market pricing, terminal expectations, FOMC odds.** Direction matters more than level. | <ul><li>Terminal +~40bp with direction unchanged → keep the portfolio (2023-02).</li><li>~70% hike odds (2026-09-11); an October hike >50% (2026-09-18).</li><li>The key question: "one and done, or the start of a cycle?"</li></ul> | DFEDTARU/DFEDTARL; FOMC SEP; fed funds futures; prediction markets | <ul><li>Peak: hold stocks and add duration gradually (M-R13).</li><li>Cuts: M-R11.</li><li>Growth-driven hikes are digestible (M-R09).</li></ul> | Core · 2022→26, n≈25 |
| I-04 | **Real rates & breakevens.** Splits nominal moves into real rates vs expected inflation; the real-rate gap drives FX. | <ul><li>US–Japan real gap of 5–6%, so Japan would need ~5% rates to match (2023-08).</li><li>US TIPS 1.985% vs the Japan linker at −0.738% (2024-02).</li><li>The 2026 rise came "mainly from real rates"; real rates are the highest since 2008 (2026-09).</li></ul> | DFII10; T10YIE | <ul><li>Positive US real rates mean holding USD pays (yen-negative).</li><li>A real-rate rise with strong growth is no reason to panic.</li></ul> | Core · 2022→26, n=6 |
| I-05 | **Curve shape.** Tells which financials win; flattening can also signal a slowdown. | <ul><li>Flattening plus falling China→US container volumes = slowdown (2025-04).</li><li>The 2026 steepening hypothesis **✘**: the curve flattened (2-yr highest since Jul 2024; 10s–30s narrowest since Apr 2025) (2026-09-18).</li><li>Steep → large-bank NIM.</li><li>Flat but high → insurers (「フラットでも、5％は5％です」, flat or not, 5% is 5%).</li><li>Regionals are the purest NIM bet and are hurt by lagging deposit costs.</li></ul> | T10Y2Y; DGS2; DGS30 − DGS10 (derived) | Flat and high: insurers > large banks/IBs > regionals (M-R10) | Stated · 2023→26, n=3 |
| I-06 | **Type of rate cycle & sector history** | <ul><li>Ned Davis: after fast consecutive hikes, stocks fell after the first hike; after slow or single hikes, they rose.</li><li>Rising rates hurt stocks only when growth weakens at the same time.</li><li>Since 2001, rising-rate years: financials and energy outperform; utilities and staples lag (2026-09).</li><li>Rate cycles usually last 5+ yrs (Japan, 2025-02).</li><li>⚑ The 1984/2015 pace comparison (2023-05-05) is garbled.</li></ul> | Fed target history; XLF/XLE/XLU/XLP returns | Growth-driven hikes: stay invested and tilt to financials and energy | Stated · 2023→26, n=4 (F-64) |
| I-07 | **MOVE vs VIX; stock–bond correlation.** Shows where fear sits; his only VIX-type signal. | <ul><li>MOVE > VIX = 「恐怖の中心が株から債券に移った」 (the centre of fear moved from stocks to bonds).</li><li>Stocks and bonds positively correlated in the bad direction = 60/40 fails (2026-03).</li><li>**VIX level threshold: TBD(Paul).**</li></ul> | ICE BofA MOVE (not on FRED); VIXCLS; rolling stock–bond correlation (window TBD) | Review toward 60/20/20; energy/gold hedge (M-R07) | Stated · 2026, n=2 (Timmer ⚑) |
| I-08 | **USD MMF / T-bill yield.** The hurdle rate (金利のある世界). | <ul><li>MMF above 4.5% (「5％近い」); >40% of MMF assets sit in the Fed reverse repo, so risk is near zero (2023-04).</li><li>~5% risk-free is the hurdle (2023-05).</li><li>SGOV at 3.5–4% (2026-08).</li></ul> | DTB3 / DGS3MO; SGOV yield | <ul><li>Park cash here and compare every idea to it (M-R26).</li><li>Deposit flight squeezes banks.</li></ul> | Core · 2023→26, n≈6 |
| I-09 | **US mortgage rate & housing.** One of his four Fed gauges; drives housing inflation and CRE. | <ul><li>$207k average mortgage-holder equity + a 2–6m home shortage = no forced selling and no housing-led crisis (2022-12).</li><li>Lock-in makes shelter inflation sticky (2025-09).</li><li>A 6.5% mortgage makes buying a $1.2M home worse than renting; 6–7% rates hamper NNN deals (2026-04).</li></ul> | MORTGAGE30US; HOUST; CUSR0000SAH1 | No housing crisis; sticky rents mean inflation persists | Stated · 2022→26, n=4 |

**B. Inflation & labour**

| ID | Indicator: his read | Thresholds / rules of thumb | Series (suggested default) | Implication | Str · prov |
|---|---|---|---|---|---|
| I-10 | **CPI** (headline vs core, MoM vs YoY, shelter). The Fed's reaction function. | <ul><li>Run-rate math: at +0.4% MoM, YoY peaks in December; each +0.1pt of MoM delays the peak about a month; at +0.8% MoM there is no peak even in 2023 (2022-11).</li><li>**Core >0.4% MoM makes a hike "almost certain". Watch core MoM, not headline YoY** (2026-09-11).</li><li>Rent/OER are hard to measure.</li><li>Inflation floor ~3% (2023-01).</li><li>Cross-check against daily life.</li></ul> | CPIAUCSL; CPILFESL (MoM); CUSR0000SAH1 | A hot print makes a tech dip a buying zone. Don't trade single prints. | Core · 2022→26, n≈12 |
| I-11 | **PPI.** Pipeline inflation. | Aug 2026 PPI +5.4% YoY | PPIFIS (final demand) | The mood shifts to "wary of hikes" | Stated · 2026, n=1 |
| I-12 | **Disinflation basket.** Early evidence that inflation has turned. | Michigan inflation expectations, freight rates, car prices, housing and lumber, Baltic Dry (−88% from peak), fertilizer, oil and rents all easing; wages the exception (2022-09 → 2023-06) | MICH; Baltic Dry; lumber; used-car and freight indices | Supports "rate peak → growth rebound" | Stated · 2022→23, n=4 |
| I-13 | **US labour market.** Wage-price spiral risk; hikes transmit with a lag. | <ul><li>Unemployment 3.4–3.7% (2022–23), then 3.7% → 4.2% (2024-12).</li><li>Low participation and ~3.5m missing workers mean layoffs reflect imbalance, not slack (2022-12).</li><li>Indeed postings back to pre-pandemic levels (2024-10).</li><li>⚑ The NY Fed anxiety survey item is dated 2024-08-26.</li></ul> | UNRATE; CIVPART; PAYEMS; CES0500000003; IHLIDXUS | A strong labour market pushes cuts later | Core · 2022→24, n≈7 |
| I-14 | **Japan inflation & wages.** Is Japan escaping deflation? Drives the BOJ's path and the yen premise. | <ul><li>Core CPI +3.7% (Nov 2022), the highest since Dec 1981.</li><li>Tankan 5-yr inflation expectations 0% → 2%; CPI in the 3% range vs −1% to 1% before 2022.</li><li>A yen past ¥150 adds ~1.2% to CPI (2025-02).</li><li>**Wage growth is the strongest since 1997 and real wages are positive** (2026-09-11).</li></ul> | Japan CPI (Statistics Bureau); BOJ Tankan; MHLW Monthly Labour Survey | <ul><li>Inflation erodes yen savers, so diversify out of yen.</li><li>Strong wages put the yen premise under inspection (PR-1).</li></ul> | Core · 2022→26, n≈8 |

**C. Growth, cycle, earnings & valuation**

| ID | Indicator: his read | Thresholds / rules of thumb | Series (suggested default) | Implication | Str · prov |
|---|---|---|---|---|---|
| I-15 | **HOPE sequence** (Housing → Orders → Profits → Employment). Tells how far a downturn has progressed; his only named cycle-staging tool. | In January 2023 profits were falling and employment was starting to weaken, so "late in the downturn". A TV host later asked him about 「HOPE」, confirming the lens (2023-04-18). | HOUST; new orders (ISM, DGORDER); S&P EPS; PAYEMS | Late in a downturn, the stock bottom comes before the earnings trough, so don't sell | Stated · 2023, n=3 (F-35) |
| I-16 | **Activity data:** PMI, LEI, GDP/GDPNow, retail sales, traffic, trade volumes. | <ul><li>Don't over-rely on the PMI (2024-09).</li><li>⚑ LEI at its lowest since 2016 (2024-08-26).</li><li>**GDPNow ~5% for Q3 2026; August retail sales beat on every line** (2026-09-18).</li><li>Box and container volumes falling = slowdown signs (2023-06; 2025-04).</li><li>⚑ Consumer confidence at its lowest since 2014 (2026-01-28).</li></ul> | ISM PMI; Conference Board LEI; GDPC1; Atlanta Fed GDPNow; RSAFS | <ul><li>A data dip is a chance to buy quality.</li><li>Strong growth makes hikes digestible.</li></ul> | Core · 2023→26, n≈9 |
| I-17 | **FOMC growth-risk balance & projections.** Are hikes about growth or about inflation? | <ul><li>No FOMC member sees downside growth risk, a first since the statistic began.</li><li>The Fed sees 2% inflation only in 2029.</li><li>12 of 18 members see one more hike this year (2026-09-18).</li></ul> | FOMC SEP | "Hikes because growth is too strong", so don't panic | Stated · 2026, n=1 |
| I-18 | **Earnings growth & revisions.** The market's engine; tells when the bottom is in. | <ul><li>The stock bottom comes ~6 months before the earnings trough (2022-12).</li><li>Bear-rally test: 64% of the 2022 fall recovered with EPS growth ~0% (2023-06).</li><li>The consensus 12%/yr for 3–5 yrs is priced in; **a slowdown to 6–7% could mean a ~20% correction** (2025-12-22).</li><li>Q2 2026 EPS growth revised 23% → 32%; 77% beat (2026-08).</li><li>Small-cap upward revisions "usually signal outperformance" (2024-09).</li></ul> | Consensus EPS & revisions (FactSet/LSEG-type) | An earnings-led market is healthy. Watch for deceleration. | Core · 2022→26, n≈9 |
| I-19 | **Splitting a fall into earnings vs multiple.** Is a fall a "real" correction? | <ul><li>Index change = earnings change + multiple change.</li><li>S&P −5% with PER about −11% (2026-03-19).</li><li>S&P −7.6% with PER about −20% = "valuation normalization, not panic" (2026-03-29).</li><li>S&P +14% with EPS +31% and P/E −13%; forward 19.6x, below its 5-yr average (2026-09-04).</li></ul> | S&P 500 + forward EPS → forward P/E (derived) | A multiple-led correction with earnings intact means hold/add and **no big position changes** (M-R22) | Core · 2026, n=3 (F-12) |
| I-20 | **Market valuation level.** A froth check, secondary to earnings. | <ul><li>MSCI USA forward P/E 21.4x at the 90th percentile, dismissed (2024-09).</li><li>**S&P ~6500 = near-term bottom** (2025-11-27).</li><li>ERP (equity risk premium) says "slightly expensive" (やや割高) (2025-12).</li><li>Forward 20x cap-weighted / 18x equal-weighted is "not abnormal" with 32% EPS growth (2026-08).</li></ul> | Forward P/E, cap- vs equal-weight; ERP = forward earnings yield − DGS10 (derived) | Use breadth as insurance rather than selling | Core · 2024→26, n≈7 |
| I-21 | **Breadth & concentration.** Whether the bull market lasts. | <ul><li>A lasting bull needs "broadening" beyond the Mag 7 (2025-12).</li><li>Equal-weight S&P at a record: 「市場は壊れていません。壊れるどころか、広がっています」 (the market isn't broken; far from it, it's broadening) (2026-08-14).</li><li>Tech's share of market cap now exceeds the dot-com era, a point he concedes to the bears.</li><li>The S&P ex-AI and SaaS have been recovering since the March bottom (2026-09).</li></ul> | RSP/SPY ratio; IWC; sector weights | Stay in AI; RSP, non-tech and oil as cheap insurance (R-79) | Core · 2023→26, n≈6 |
| I-22 | **Financial conditions.** Both fuel and a warning. | The loosest since 1997, meaning both 「上昇の余地」 (room to rise) and 「過熱の入口」 (the start of overheating). 1997 gave 3 more boom years, then the 2000 crash (2026-08-14). | An FCI such as NFCI (the index he used is unspecified) | Hedge through breadth, not by selling AI | Stated · 2026, n=1 |
| I-23 | **Real vs nominal index accounting** | S&P +91% nominal, ~73% real, vs the 2009 bull's 147% real, called 「まだ半分強」 ("still just over half") (⚑ 73/147 = 49.7%) (2025-12-22) | S&P 500 ÷ CPIAUCSL (derived) | Watch real earning power | Stated · 2025, n=1 |
| I-24 | **Index trend structure & retracement.** How aggressive to be. | <ul><li>Lower highs and lower lows: don't be aggressive yet (2022-10-13).</li><li>A break above 4,100 means a return to the uptrend (2022-11).</li><li>A >50% retracement test; 64% was recovered (2023-06).</li></ul> | S&P 500 daily | Build gradually until the trend turns | Stated · 2022→23, n=5 |

**D. AI-cycle regime gauges** (stock-level detail is in P3/P4)

| ID | Indicator: his read | Thresholds / rules of thumb | Series (suggested default) | Implication | Str · prov |
|---|---|---|---|---|---|
| I-25 | **AI capex dials & scale.** Is the AI capex cycle intact? | <ul><li>**Three dials: utilization (点灯率), backlog growth, power prices** (2026-08-04).</li><li>AI investment is 1–2% of US GDP narrowly and ~5% broadly, vs a railway peak of 5–7% and dot-com ~5% (⚑ "not reached" holds only on the narrow measure).</li><li>Hyperscaler capex ~$340B/yr (2025-09).</li><li>Capex guides raised: GOOGL 2026 $180–190B → $195–205B; AMZN $200B → $220B (2026-07).</li><li>US capex ~$1.5T alongside ~$1.4T of buybacks (2026-09).</li></ul> | Hyperscaler capex and backlog/RPO (filings); utilization proxy (source TBD); power prices (EIA) | Demand death (utilization falls) means exit; a positioning flush means buy (M-R20) | Core · 2023→26, n≈8 (F-42, F-45) |
| I-26 | **AI financing & credit.** How fragile the funding of AI capex is. | <ul><li>Private credit funds data centres; junk worries for weaker borrowers; a shale-boom analogy (2025-11).</li><li>Private-credit stress in SaaS lending (2026-03).</li><li>>$500B of third-party financing: "the industry can no longer fund itself entirely out of its own cash flow" (2026-08-28).</li><li>Alphabet's $84.7B raise is "next year's issue" (2026-09-04).</li><li>**No exit threshold: TBD(Paul).**</li></ul> | AI-infrastructure debt/equity issuance; BAMLH0A0HYM2, BAMLC0A0CM | Monitored checkpoint (F-41) | Stated · 2025→26, n=4 |
| I-27 | **Semiconductor cycle clock.** How mature the cycle is. | <ul><li>~40-month inventory cycle.</li><li>Past peaks in EPS growth were +30–80%; today's +143% points to deceleration. "It is about the rate of change, not the level" (2026-09-18).</li><li>Past downturns cut prices ~50%, so SK Hynix at −46% has done ~80% of that (2026-09-04).</li></ul> | Semis consensus EPS growth (rate of change); memory prices | Prefer TSMC (non-commodity) over memory. At the cycle peak the broadened non-tech market earns its keep (M-R23). | Stated · 2024→26, n=4 (F-29) |
| I-28 | **Bubble gauges.** Is AI a bubble? | <ul><li>Dalio's gauge at the 52nd percentile (2024-02).</li><li>**Bubble clock: ~3 yrs from start to peak (2–4); AI started in 2023 and is "young"** (2024-02-09).</li><li>Forward P/E vs Cisco: NVDA 26–27x vs CSCO ~100x (2-yr forward) and 214x at its peak.</li><li>Is the rise earnings-backed?</li><li>Behaviour test: in a bubble, fast money flees in a risk-off. Memory and data-centre stocks held up, so AI is a boom (2026-03).</li><li>Crash articles multiply after rallies; a BTC flush lowers crash odds (2025-11).</li></ul> | Leaders' forward P/E; cycle start (2023) → clock | Stay in AI. Exit "by feel" once it is a bubble; **trigger TBD(Paul)** (M-R21). | Core · 2024→26, n≈9 (F-34) |
| I-29 | **Productivity data vs field evidence.** Does AI pay off at the macro level? | <ul><li>Executives self-report +1.8% productivity vs ~+0.6% in the data.</li><li>1.1 of the 1.2 points of 1H2025 US growth came from investment.</li><li>Micro studies: call centres +14%, coding tasks +56%, but veteran developers 19% slower (2026-08-04).</li></ul> | OPHNFB; micro studies | Before buying AI stocks, state which GDP scenario you're betting on (Acemoglu ~1% … Goldman ~7%) | Stated · 2026, n=1 (F-54) |

**Bubble-test toolkit, as used** (→ P5 §5.3.11; F-34, F-45):
- the bubble clock;
- Dalio's gauge;
- forward P/E vs CSCO 2000;
- earnings-backed or not;
- the behaviour test in a risk-off;
- the utilization/backlog/power dials;
- capex share of GDP vs the railway and dot-com peaks;
- demand-death vs positioning-flush classification;
- the receipts test (領収書);
- the semis-cycle rate of change.

**The exit trigger has never been quantified: TBD(Paul).**

**E. FX: USD/JPY**

| ID | Indicator: his read | Thresholds / rules of thumb | Series (suggested default) | Implication | Str · prov |
|---|---|---|---|---|---|
| I-30 | **USD/JPY level vs regime ranges.** His structural yen view and his buying windows. | <ul><li>Long-run "stable range" 100–120 (2022-07).</li><li>Four regimes: 2005–08 ¥100–120; 2009–14 ¥80–100; 2015–21 ¥100–120; 2022–now ¥130–140 (2024-02).</li><li>¥150 is "resistance": broken in Oct 2023, Apr 2024 (153) and Oct 2025.</li><li>The 163 range triggered joint US–Japan intervention on Jul 31 2026.</li></ul> | DEXJPUS (daily) | Add USD on yen strength. Don't wait for yen strength before buying. | Core · 2022→26, n≈30 |
| I-31 | **US–Japan rate differential (nominal & real).** The mid-term FX driver. | <ul><li>Mid-term FX follows the rate gap; long-term FX follows the inflation gap (2022-08).</li><li>**Only a spread of roughly <2% (0–2.5% on the 10-yr; 0–1% on short rates) makes ¥100–120 likely**; the correlation is "blurry" (2024-02-07).</li><li>In the 1990s the gap widened from ~0 to ~5%, yet the yen rose to the ¥80s, so FX is not only about rate gaps.</li><li>The gap is narrowing in 2026.</li></ul> | DGS10 − JGB 10-yr (MOF); DGS2 − JGB 2-yr (derived) | A wide gap means a weak yen, so diversify. A narrowing gap means inspect the premise (PR-1). | Core · 2022→26, n≈10 |
| I-32 | **FX driver model & structural factors.** Forecast the drivers, not the rate (M-P9). | <ul><li>Three drivers: (1) the rate differential; (2) the US/Japan monetary-base ratio; (3) US stock strength, since a rising S&P is yen-negative. When 2 of 3 point to yen weakness, expect no sharp yen rally (2023-12).</li><li>Three structural factors: BOJ low rates; constant outflows from pensions and insurers; a government with debt above 2x GDP that prefers inflation (2025-09).</li><li>**Yen strength would need a US recession + large Fed cuts + continued BOJ hikes + structural reform** (2026-08-21).</li><li>Falsifiers: wages doubling, the yen at ~¥80 without a wage change, returning animal spirits, structural reform or innovative Japanese companies (2023-07).</li></ul> | Rate spreads; BOGMBASE vs BOJ monetary base; S&P trend | Base case: no long-term yen uptrend, so diversify | Core · 2023→26, n=5 (F-58) |
| I-33 | **PPP / Big Mac / CPI-vs-FX gap.** The long-run anchor. | <ul><li>FX converges to PPP in the long run, so long-horizon FX risk "effectively doesn't exist" (2022-07).</li><li>Big Mac index: yen 41.2% undervalued in Dec 2022; implied ¥79.87 vs actual ¥148.82, ~46.3% undervalued (2025-09-15).</li><li>⚑ The "yen −38%" figure (2024-04) is actually ~32–35%.</li><li>**The adjustment comes via Japanese prices, not FX.**</li></ul> | OECD PPP; Economist Big Mac index | Japanese inflation is inevitable, so avoid yen cash. Tension: D10 / T-12. | Core · 2022→25, n≈7 |
| I-34 | **Positioning, intervention & forecasts.** A contrarian read. | <ul><li>~3/4 of the carry trade unwound (2024-08-05).</li><li>⚑ Foreigners buy cash equities while selling futures (2024-08-26).</li><li>Intervention works only in the short term (2026-08-21).</li><li>**Retail FX traders hold ¥3.6T of yen shorts: "as long as the crowd still faces the other way, the trend often isn't over"** (2026-09-11).</li><li>BofA sees the yen +6% by year-end (2026-09-11).</li></ul> | CFTC COT (JPY); Japanese retail FX positions (source TBD); MOF intervention data | Don't expect intervention to reverse the trend. Spread purchases over time. | Stated · 2024→26, n=4 |
| I-35 | **Market as messenger: TOPIX vs yen, sector leadership.** The market's verdict on the FX regime. | <ul><li>TOPIX stayed flat in 2022 while the yen fell, then caught up from 2023: 「円安は長引きします。株式市場はそれを言っています。」 (the weak yen will last; the stock market is saying so) (2024-05-06).</li><li>Financials fell most in the Aug 2024 crash, so the market expects domestic damage.</li><li>Banks, metals and real estate leading: 「日本で現金（円）を多く持つことは危険だと株式市場が見ている」 (the market sees holding a lot of yen cash in Japan as dangerous) (2025-10-03).</li></ul> | TOPIX & sector indices vs DEXJPUS | Reinforces yen diversification | Core · 2023→25, n=4 (F-57) |
| I-36 | **Tourism and price anecdotes as PPP evidence.** Real-world evidence of mispricing. | <ul><li>Western tourists are 「ドル高の証」 (proof of a strong dollar).</li><li>A ~$22 US lunch ≈ ¥2,900 vs a ¥500 bento.</li><li>Japanese prices ~50–70% of US prices, Turkey-like symptoms.</li><li>A ryokan charging foreigners 30–40% more: 「途上国になりずつ」 (becoming a developing country) (2023-04 → 2024-01).</li></ul> | Field evidence (e.g., JNTO arrivals) | Japan is "too cheap", so inflation comes and diversification follows | Core (method) · 2023→24, n=5 |
| I-37 | **DXY & safe-haven USD flows.** The global dollar regime. | <ul><li>USD 「一人高」 (the only strong currency) (2022-09).</li><li>Every currency falls against the USD until the US stops hiking (2022-10).</li><li>Capital inflows strengthen the dollar, by the trade identity (2025-04).</li><li>Tensions raise safe-haven dollar demand (2025-10).</li><li>DXY 97 → above 100 (2026-03).</li></ul> | ICE DXY; DTWEXBGS | US assets as the haven, plus a hard-money hedge against dollar-confidence risk | Core · 2022→26, n=6 |

**F. Japan rates, banks & household balance sheet**

| ID | Indicator: his read | Thresholds / rules of thumb | Series (suggested default) | Implication | Str · prov |
|---|---|---|---|---|---|
| I-38 | **JGB yields & BOJ policy rate.** Japan's normalization, read as a "national report card" (国力の通信簿). | <ul><li>Rising long rates, more than short rates, are the risk (2024-01).</li><li>BOJ 0.75% at end-2025, a 30-year high (2026-03).</li><li>BOJ 1% (2026-08).</li><li>**10-yr above 3% (3.006%) = normalization, "not alarmed"** (2026-09-04).</li></ul> | MOF JGB curve (daily); BOJ decisions; IRLTLT01JPM156N (monthly) | Fixed-rate mortgages; a headwind for domestic demand; JGBs/deposits for yen you might spend | Core · 2023→26, n≈8 (F-56, F-61) |
| I-39 | **Japanese mortgage structure.** How hikes reach households. | <ul><li>Floating-rate share 66.4% (FY2019) → 82.1% (FY2021); later readings 76–90%; ~80% (2026-03).</li><li>⚑ The +1% payment math and the "¥1T/yr" figure (≈¥1.3T) are approximate (2025-02-24).</li><li>The "5-year" and "125%" rules only delay the pain.</li><li>Flat 35 ~1.9% and 10-yr fixed 2–3% vs 6%+ in the US; fixed rates follow JGBs with a lag (2026-03).</li></ul> | JHF borrower surveys; Flat 35 rates | **Refinance to fixed now**, treating the extra cost as insurance. Domestic-demand stocks face a multi-year headwind. | Core · 2023→26, n≈8 |
| I-40 | **Japanese bank health.** How rate stress transmits. | <ul><li>Regional banks' asset duration ~6 yrs, like SVB (2023-03).</li><li>2026-09-04 readings: ~¥4T of visible unrealized losses; FSA flagged ¥11T of 仕組貸出 (structured loans); 21 regionals lost deposits in FY2025; loan-to-deposit ratio at a 27-year high; the megabank ordinary deposit rate went 0.001% → 0.40%.</li><li>Three walls protect regionals (speed, small insured deposits, BOJ current-account balances): 「壁は厚いですが、無限ではありません」 (the walls are thick, but not infinite).</li><li>Bank PBR 0.5 → 1.57; megabank profit growth +30–40% → plans of +4–12%.</li><li>His 18-yr check: in years when long rates rose 1%, banks beat the market by 30+ pts; in 9 falling-rate years they beat it only once.</li></ul> | FSA/BOJ Financial System Report; bank disclosures; TOPIX Banks | Watch the weak regionals, not the megabanks. **Don't rely on "rates up = banks up"** (PR-4a). | Core · 2023→26, n≈7 (F-38) |
| I-41 | **Dividend yield vs JGB; total shareholder yield.** The equity-vs-bond hurdle in Japan. | <ul><li>**The TSE Prime dividend yield (1.94%) is below the 10-yr JGB (3.006%), the first time since May 2008.**</li><li>Total yield including ¥22T of buybacks is 3.6%.</li><li>個人向け国債 sales exceeded ¥1T in August, the first time since 2014.</li><li>Rates: fixed 5-yr 2.24%, floating 10-yr 1.95%, 1-yr deposits up to 1.4%.</li></ul> | JPX dividend yield; MOF 個人向け国債 rates; buyback totals | Use the total-return lens (総還元). Spendable yen goes to 個人向け国債 or deposits (PR-4b). | Stated · 2026, n=2 (F-19) |
| I-42 | **Japan's fiscal position & BOJ balance sheet.** The dilemma behind the yen. | <ul><li>The BOJ owns ~50% of JGBs and ~6.7% of stocks (2022-12).</li><li>Debt 226% of GDP gross vs 114% net (2024-04); ~260% (2025-10).</li><li>The BOJ says banks' rate risk is 「低位に抑制されている」 (held at a low level) (2026-09-04).</li></ul> | BOJ balance sheet; MOF/IMF debt data | Diversification is urgent | Stated · 2022→26, n=4 (F-71) |

**G. Commodities & hard assets**

| ID | Indicator: his read | Thresholds / rules of thumb | Series (suggested default) | Implication | Str · prov |
|---|---|---|---|---|---|
| I-43 | **Oil price level (WTI/Brent), inflation-adjusted.** Inflation input, hedge value, cycle position. | <ul><li>"The $60s are historically low" (2025-09).</li><li>Majors generate cash even at $30–50 (2026-01).</li><li>**A spike above $100 that calms within weeks is a temporary shock. High oil lasting ≥3 months leads to inflation, then rates, then a hit to the whole S&P** (2026-03).</li><li>Latest: above $100; Brent ~$105, WTI $100; US diesel at a record $5.94/gal (2026-09-11).</li></ul> | DCOILWTICO; DCOILBRENTEU; GASDESW; real oil = WTI ÷ CPIAUCSL (derived) | Build energy in stages when oil is cheap. Hold it as insurance. Don't chase after an event spike (M-R04, M-R24). | Core · 2022→26, n≈20 (F-63) |
| I-44 | **Oil futures curve.** The market's best guess. | <ul><li>Backwardation means near-term tightness or a geopolitical premium; contango means inflation, shortage, storage costs or rates.</li><li>Far-dated contracts are unreliable: 「現時点における市場の最善の推測」 (the market's best current guess).</li><li>Mar 2026 curve: spot ~$93 → ~$55 in 2037. He doubts $55.</li><li>**~$20 of backwardation means the market expects resolution within months.**</li></ul> | NYMEX WTI / ICE Brent futures strip (front vs ~12–15 months; long-dated) | Treat the premium as temporary, but keep energy anyway | Stated · 2026, n=3 (F-32) |
| I-45 | **Oil fundamentals.** Supply and demand. | <ul><li>Low capex since 2016.</li><li>**Half of shale wells deplete in about a year.**</li><li>OPEC/Saudi cuts.</li><li>US inventories and refinery use.</li><li>⚑ Capex-cycle mechanics (2025-12-11).</li><li>Chinese EVs displace more than 400,000 b/d (2026-03).</li></ul> | EIA Weekly Petroleum Status Report; rig counts; OPEC+ quotas | Hold the majors through dips | Core · 2022→26, n≈10 (F-25) |
| I-46 | **Rates ↔ commodities.** Opportunity cost. | <ul><li>Falling rates favour commodities relative to currency.</li><li>Higher yields lower the value of oil, which pays no interest: WTI fell from $120 to the $60s while the 10-yr went from 2.5% to 4.15% (2025-09).</li><li>Gold suffers under "higher for longer" (2026-03).</li></ul> | DGS10/DFII10 vs WTI & gold | Rate cuts favour commodities | Core · 2023→26, n=5 (F-33) |
| I-47 | **Relative performance** (XLE vs S&P/XLK). Mean reversion. | <ul><li>The XLE/S&P ratio was used for timing (2022).</li><li>Energy lagged in 2024.</li><li>⚑ XLE +7.66% vs S&P +16.77%: energy is "the opposite of AI bubble talk" (2025-12-04).</li></ul> | XLE/SPY, XLE/XLK ratios | A lagging sector is a recovery case (R-100) | Stated · 2022→25, n=4 (F-28) |
| I-48 | **Natural gas & power demand.** The AI–power link. | <ul><li>Renewables cover less than half of power-demand growth (2024-09).</li><li>**Gas above $5/MMBtu by end-2026** (2025-09-05; an open call).</li><li>IEA data-centre power 415 TWh (2024) → 945 TWh (2030) (2026-08).</li></ul> | DHHNGSP; EIA electricity data | Majors' gas makes them an indirect AI play; favour LNG and nuclear | Stated · 2022→26, n=4 |
| I-49 | **Uranium market.** The nuclear cycle. | <ul><li>**Watch the long-term contract price, not spot**: LT ~$95, spot ~$87, 5-yr forward ~$105; Cameco's new-contract ceiling ~$160 (2026-08).</li><li>Kazakhstan (~40% of supply) cut its 2026 target ~10%.</li><li>Utilities have contracted only ~half of their needs.</li><li>Large reactors under construction: China 36, US 0. Japan: 15 of 33 restarted.</li><li>SMR trigger: GE Hitachi's BWRX-300 finishing on time and on budget.</li></ul> | UxC/TradeTech LT & spot indicators (e.g., as Cameco publishes) | Keep CCJ; NXE as a sized satellite | Core · 2022→26, n≈10 (F-31) |
| I-50 | **Gold.** Hard money, Capital Wars, dollar confidence. | <ul><li>Near $4,000 it "symbolizes the start of the inflation era" (2025-10).</li><li>Record $5,589 in January 2026, then $4,400–4,500.</li><li>**Floor $4,000–4,200**; bank targets $5,400–6,000.</li><li>「今の下落は調整であって、強気相場の終わりではない」 (this drop is a correction, not the end of the bull market) (2026-03-29).</li></ul> | LBMA/COMEX gold (not on FRED) | Energy and gold "at a set ratio"; **ratio TBD(Paul)** | Stated · 2025→26, n=5 (F-74) |
| I-51 | **Bitcoin.** A debasement and speculation gauge. | <ul><li>A store of value like gold that rises with debasement (2025-10).</li><li>The Nov 2025 fall was a healthy flush.</li><li>Held $70k but "still speculative" (2026-03).</li><li>⚑ The Timmer data he cites shows BTC +64% correlated with the dollar.</li></ul> | Exchange data (e.g., CBBTCUSD) | Included in the "hard money" part of 60/20/20 (2026-03-24), which conflicts with his speculation stance; **role TBD(Paul)** | Stated · 2022→26, n=6 (T-18) |

**H. Credit & systemic stress**

| ID | Indicator: his read | Thresholds / rules of thumb | Series (suggested default) | Implication | Str · prov |
|---|---|---|---|---|---|
| I-52 | **Anatomy of a bank run (US).** Systemic risk. | <ul><li>SVB was a rate/duration and concentration failure, not a credit event.</li><li>Uninsured deposits matter.</li><li>Any bank dies in a full run.</li><li>The AT1 lesson.</li><li>MMFs above 4.5% drain deposits; CRE will produce bad loans (2023-03 → 05).</li></ul> | FDIC unrealized losses; H.8 deposits; KRE | Avoid bank stocks; buy non-financial collateral damage; big banks benefit; spread deposits (M-R19) | Core · 2023 (recapped ⚑2026), n≈8 (F-73) |
| I-53 | **Yield-multiple red flag / HY / sovereign stress.** Hidden credit risk. | <ul><li>Rising sovereign-debt risk means avoid EM HY bonds (2022-10).</li><li>**A yield 5–10x the benchmark = hidden risk** (2023-04-14).</li><li>HY ETFs are 「景気に賭ける投資」 (a bet on the economy); HY duration ~3 yrs (2026-08-21).</li></ul> | BAMLH0A0HYM2; yield ÷ matching Treasury (derived) | Don't treat HY as a safe yield | Stated · 2022→26, n=3 |
| I-54 | **US fiscal metrics.** Long-run inflation and rates. | <ul><li>The debt ceiling is always cleared; promised cuts are never made, and the real limit is the bond market.</li><li>Debt ~120% of GDP vs 118% in 1946.</li><li>Interest above $1T, 3.2% of GDP in 2026.</li><li>OBBB adds ~$2.4T over 10 yrs.</li><li>A shutdown shows deficits won't be fixed easily (2025-10).</li></ul> | GFDEGDQ188S; A091RC1Q027SBEA; WALCL; CBO baseline | Inflation is the "hidden default", so hold equities and real assets, not cash | Core · 2023→25, n≈8 (F-62) |
| I-55 | **Fed-independence signals.** The inflation tail. | <ul><li>A chair succession in 2026.</li><li>The Cook firing (2025-08-28).</li><li>The DOJ probe of Powell (subpoena 2026-01-09).</li><li>Independence is "hard to break by design".</li></ul> | Event log | Real assets and equities, not cash | Stated · 2024→26, n=4 |

**I. Politics & sentiment inputs**

| ID | Indicator: his read | Thresholds / rules of thumb | Series (suggested default) | Implication | Str · prov |
|---|---|---|---|---|---|
| I-56 | **Prediction and betting markets, polls.** Event probabilities. | <ul><li>Odds cited 2023 → 2026; the last reading: Democrats 40–50% to take both houses (2026-03-12).</li><li>By 2026-06-22 he calls the betting boom a "casino floor".</li></ul> | Polymarket / Kalshi / PredictIt | Inputs only; they never drive strategy | Observed · 2023→26, n≈8 |
| I-57 | **"Who is buying" and crowding.** Capitulation vs conviction. | <ul><li>Berkshire/Buffett buying (2022).</li><li>Tech is "the most crowded trade" (2024-10).</li><li>Citadel took a $16B block in full (2026-08-04).</li><li>Hedge funds adding oil longs (2026-09-11).</li></ul> | 13F filings; block-trade reports; CFTC COT (crude) | Evidence against the market's fear | Observed · 2022→26, n≈6 (F-111) |
| I-58 | **China macro & the policy cycle.** Timing entries into China tech. | <ul><li>**China stocks are strongly policy-cycle driven** (2023-01).</li><li>Zero-COVID mobility data (2022-11).</li><li>Youth unemployment above 20% and no longer published (2023-08).</li><li>KWEB 15.4x and BABA under 10x, about half US valuations (2024-05).</li><li>Exports 14% of GDP; property in decline for 5 yrs.</li><li>⚑ The testing-cost "~8%" figure fits only the upper bound.</li></ul> | NBS China data; policy signals; KWEB/MCHI valuations | Pick stocks rather than the index. Buy gradually when policy turns (R-06). | Core · 2022→26, n≈10 |

**J. Geopolitical transmission**

| ID | Indicator: his read | Thresholds / rules of thumb | Series (suggested default) | Implication | Str · prov |
|---|---|---|---|---|---|
| I-59 | **Transmission chain & "three lines."** Turns geopolitics into market impact. | <ul><li>Chain: Iran news → oil → inflation fear → rates → stocks.</li><li>**Line 1: the oil level and how long it lasts. Line 2: the conflict's scale and duration. Line 3: loss of control over Hormuz, which shakes confidence in the USD and Treasuries** (2026-03-29).</li><li>Sep 2026 chain: Middle East → oil → inflation → rates → tech cooling. 「AIのテーゼは、変わっていません」 (the AI thesis hasn't changed) (2026-09-11).</li></ul> | I-43, I-01, I-37, I-50 + event log | Keep the energy/gold hedge. (I) No equity overhaul unless Line 3 breaks. | Stated · 2026, n=3 (F-63) |
| I-60 | **Oil-shock history.** How long equity damage takes to arrive. | <ul><li>1973, 1979 and 1990 hit stocks almost immediately; 2008 and 2022 hit with a lag.</li><li>After the Gulf War, the Iraq War and the 2019 Saudi attack, the S&P was up a year later in most cases (2026-03).</li></ul> | Static reference table | Stay invested | Stated · 2026, n=2 |

### 6.3 Macro condition → action rules

**Enforcement, per P2.**
- Macro-motivated sells are blocked (R-106, HARD).
- Shock classification is a hard step (R-105), followed by a cooling-off period (R-107).
- Thresholds are ALERT regime flags (R-98, R-99) that feed the regime tilts (R-87: ALERT/SOFT, no auto-trades).

**Detail:** → P5 §5.1.4.

| ID | Condition → action (as written) | Parameters | Str · prov | Config · links |
|---|---|---|---|---|
| M-R01 | **A macro- or news-driven selloff with the thesis intact** (「テーゼが変わらないまま価格だけが下がる」, only the price has fallen) → buy quality gradually, spreading purchases over time. **Never sell for macro reasons.** | Tariffs: with a 4+ yr horizon, build 「少しずつ」 (little by little) | Core · 2022→26, n≥12 | `entry.dip_buy_requires_thesis_intact: true`, `crisis.block_panic_macro_sells: true`, `entry.staged_tranches: TBD(Paul)` · R-27, R-30, R-106, P-01, P-02 |
| M-R02 | **A single CPI, jobs or PMI surprise** → no change to the mid-term view or the portfolio. The dip can be a buying zone. | — | Core · 2023→24, n=5 | M-P2 · R-44 |
| M-R03 | **A geopolitical event.** <ul><li>Classify it as a temporary shock or a structural change.</li><li>Treat it as a real risk only if it moves **oil and rates for a long time**.</li><li>Don't trade in the first days.</li><li>Check the design: global diversification, the inflation-hedge share, several years of expenses in safe assets.</li></ul> | — | Core · 2023→26, n=5 | `state.shock_type.persistence: [temporary_shock, structural_change]`, `crisis.cooling_off_days: TBD(Paul)` · R-94, R-105, R-107 |
| M-R04 | **An oil spike.** <ul><li>Above $100 but calm within weeks: absorbable.</li><li>High oil lasting **≥3 months** (「3ヶ月以上」): expect inflation → rates → a hit to the whole S&P.</li><li>**Hold** the energy hedge; don't chase energy after the event spike.</li><li>The action beyond holding is TBD(Paul).</li></ul> | $100/bbl; 3 months | Stated · 2026, n=3 | `timing.macro_thresholds.oil_spike_usd: 100`, `timing.macro_thresholds.oil_persistence_months: 3` · R-36, R-99, F-63 |
| M-R05 | **US 10-yr above 4.5%** (「4.5%を超えてくると」) → expect strong pressure on all risk assets, including growth. The action is TBD(Paul); in practice he moves toward selection and short duration. | 4.5% (Timmer ⚑) | Stated · 2026, n=2 | `timing.macro_thresholds.ust10y_risk_asset_headwind_pct: 4.5` · Q1 |
| M-R06 | **The 10-yr reaches ~5%,** above the premise that the US can bear 3–4% nominal. <ul><li>Only earnings growers withstand; select stocks rather than lean on the index.</li><li>Avoid long bonds and park in short Treasuries.</li><li>Use the ~5% 10-yr as the "certain" hurdle.</li></ul> | 3–4% premise; 5% | Stated · 2026, n=4 | `timing.macro_thresholds.ust10y_exceeds_tolerance_pct: 5.0`, `cash.long_bonds_allowed: false` · PR-2, R-82, F-59 |
| M-R07 | **MOVE above VIX, and stocks and bonds correlated in the bad direction** → the epicentre is in bonds and 60/40 fails. Review toward **60/20/20** (stocks/bonds/hard money: gold, bitcoin), with energy/gold at a set ratio. | 60/20/20 (P2 R-80: the exact split is inferred) | Stated · 2026, n=2 (Timmer ⚑) | `macro.move_gt_vix_review: true`, `construction.review_mix_stocks_bonds_hardmoney: [60,20,20]` (scope TBD(Paul)), `hedge.energy_gold_ratio: TBD(Paul)` · R-80, F-97 |
| M-R08 | **Core CPI above 0.4% MoM** → a hike is "almost certain". Watch core MoM, not headline YoY. | 0.4% | Stated · 2026, n=1 | `timing.macro_thresholds.core_cpi_mom_hike_pct: 0.4` |
| M-R09 | **The Fed starts hiking** → ask "one and done, or the start of a cycle?" <ul><li>After fast consecutive hikes, stocks fell after the first hike; after slow or single hikes, they rose (Ned Davis).</li><li>Growth-driven hikes are digestible.</li><li>Rising-rate years favour **financials and energy**; utilities and staples lag.</li></ul> | Since 2001 | Stated · 2026, n=2 | `macro.hike_cycle_type ∈ {one_and_done, cycle}` · R-87, F-64 |
| M-R10 | **Curve shape with rates high.** <ul><li>A flat, high curve ranks **insurers first**, then large banks and investment banks, then regional banks last.</li><li>A steep curve favours large-bank NIM.</li><li>Regional banks are the purest NIM bet and suffer when deposit costs lag.</li></ul> | 「フラットでも、5％は5％です」 | Stated · 2026, n=1 | `macro.financials_order_flat_high_curve: [insurers, large_banks_ib, regionals]` · PR-3, F-38 |
| M-R11 | **Rates peak or fall** → favour long-duration tech, REITs, small caps, EM, commodities vs the dollar, uranium and China tech. **Warning: the realized record is poor for REITs, small caps and EM.** | — | Core (low realized value) · 2023→26, n≈12 | `timing.rate_cycle_sector_tilts: TBD(Paul)`; P5's weighting (I): zero weight as a standalone signal · D3, R-87, Q7 |
| M-R12 | **Rates rise, or cuts get pushed back** → avoid venture-like tech. Trim REITs rather than exit (「全て売却するよりは、ポジションを削減する選択もあり得ます」). Tech weakness is a buying zone. | — | Stated · 2022→24, n=4 | R-58 |
| M-R13 | **The policy rate is at its peak** (the Fed signals the end) → hold stocks. Add Treasuries or high-grade bonds gradually, then short Treasuries and ladders. | — | Core · 2023, n=5 | R-82 |
| M-R14 | **An inflation regime:** financial repression, big deficits, erosion of Fed independence → own productive and real assets (equities, energy, gold, real estate). Avoid cash and long bonds as stores of value. | Losers: cash first, then bonds | Core · 2023→26, n≥8 | R-123, P-16, F-62 |
| M-R15 | **The yen strengthens** → use the window to accumulate USD assets. Spread purchases, including over currency timing. **Never stop diversifying** (「一番いいシナリオで円は横ばい、悪いシナリオは円安です」, best case the yen is flat, worst case it weakens). | — | Core · 2023→26, n≥7 | `fx.yen_strength_action: stagger_usd_accumulation` · R-112, R-113 |
| M-R16 | **A Japan-resident investor** → majority of growth assets in USD/global; yen for money you might spend; fixed-rate mortgage; long-term foreign holdings unhedged (「使うかもしれないお金は円の金利で、長期の成長はドルの企業で」). | — | Core · 2022→26, n≥20 | `fx.hedge_policy`, `fx.jp_reader_overseas_target_pct: TBD(Paul)`, `cash.parking_instruments.jpy` · R-111, R-116, R-119, P-12 |
| M-R17 | **US political turmoil** (elections, indictments, shutdowns, Fed pressure) → keep the US as the core, or raise the US weight "somewhat". Buy an election crash. | — | Core · 2023→26, n≥10 | `construction.us_min_weight: TBD(Paul)` · R-83, R-101 |
| M-R18 | **Taiwan contingency or war risk in a frontline country** → never sell US stocks for it (「ほぼ確実に間違いです」). Don't over-invest in frontline countries. Diversify. | — | Core · 2022→26, n=5 | `crisis.block_panic_macro_sells: true` · R-106, T-32 |
| M-R19 | **A bank crisis** (a run or duration losses). <ul><li>Avoid bank stocks, especially regionals and those that rose on inflation.</li><li>Buy non-financial collateral damage (the S&P after a Monday drop). Big banks benefit.</li><li>Spread deposits.</li><li>Bank ETFs only as a trade with a time stop.</li></ul> | Duration ~6 yrs = danger | Stated · 2023, n=5 | R-61, R-124, F-73 |
| M-R20 | **An AI selloff** → classify it: "demand death" (utilization falls) means exit; "position clearing" means opportunity. Judge on the 点灯率 (lit rate), not the stock price, and act only after judging. | Three dials: utilization, backlog growth, power prices | Stated · 2026, n=2 | `state.shock_type.mechanism: [demand_death, position_clearing]`, `research.ai_dials` · R-28, F-42, F-45 |
| M-R21 | **AI becomes a bubble** → sell or cut "by feel" (「感覚で掴んで、売る、またはポジションを削らなければいけない」). Bubbles take ~3 yrs (2–4) from start to peak. | Numeric trigger TBD(Paul) | Stated · 2024, n=3 | `exit.valuation_trim_trigger: TBD(Paul)` · R-56, F-34, T-15, Q6 |
| M-R22 | **The index falls** → split the fall into earnings vs multiple. If PER compression does the work and earnings are intact, make no big position changes. | S&P −5% / PER −11%; −7.6% / −20% | Core · 2026, n=3 | R-98, F-12 |
| M-R23 | **Semiconductor EPS growth runs far above past cycle peaks** → expect deceleration. Prefer non-commodity chipmakers (TSMC) over memory. Commodity profits are temporary: take profits at the peak of glamour (observed via Contrafund). | Past peaks +30–80%; now +143%; ~40-month cycle | Stated · 2026, n=3 | `macro.semis_eps_growth_past_peak_pct: [30, 80]` · PR-9, R-04, R-15, F-29 |
| M-R24 | **Energy is historically cheap or lagging** → build energy exposure in stages via equities. Value majors on reserves and capital returns, not on P/E or the oil price. Don't chase right after an event spike. | "$60s historically low"; majors are cash-generative at $30–50 | Core · 2022→26, n≥8 | R-36, R-77, F-36 |
| M-R25 | **A long-held premise wobbles** → put it on the inspection list (点検リスト); don't retract it at once. Publish the correction when data falsifies it (as with the curve). | — | Core · 2026, n=4 | `macro.premise_inspection_list` · R-47, F-108, P-28 |
| M-R26 | **Any asset competes with the T-bill / MMF** → it must beat the risk-free yield on total return. A dividend stock yielding only 3.5–4% asks "why take last-in-line equity risk for T-bill yield?". | MMF ~4.5–5% (2023); SGOV 3.5–4% (2026) | Core · 2023→26, n≈6 | `cash.hurdle_rate_source: us_tbill_mmf_yield` · R-17, F-18 |
| M-R27 | **Regional (Asian) risk-premium shocks** → get Asian semis through non-commodity leaders (TSMC). A Korea ETF concentrated in two names is "not diversification". Korean political turmoil: buy EWY on dips. | Two names = 44% of the Korea ETF | Stated · 2024→26, n=2 | R-73, R-110 |

### 6.4 Standing views (Sep 2026) & premises under inspection

**(a) Standing views.** These are his latest dated positions, current as of 2026-09-18/27.
- The "Monitor" column lists his stated conditions where he gave them.
- Items marked (I) are editor-derived from his own thresholds.

| Theme | Current view | Current action | Monitor: confirms ↔ refutes / shifts | Last |
|---|---|---|---|---|
| **Fed / US rates** | <ul><li>A hiking cycle has resumed (3.75–4.00%, "not one and done").</li><li>金利のある世界 is fully back, and globally.</li><li>Hikes are growth-driven, so digestible.</li><li>Real rates are the highest since 2008.</li></ul> | <ul><li>No long bonds; park in short Treasuries/T-bills (the ~5% 10-yr is the "certain" benchmark).</li><li>Equities: earnings growers only (選別の時代).</li><li>Financials: insurers > large banks/IBs > regionals. No US financials in the RP yet; he is researching insurers.</li></ul> | <ul><li>**Confirms:** further hikes (an October hike was >50% priced); the FOMC still sees no downside growth risk; GDPNow and retail strength.</li><li>**Shifts:** hikes coinciding with weakening growth, his condition for rates hurting stocks (M-R09, I-06); a Fed "end" signal switches to M-R13.</li></ul> | 2026-09-18, 09-27 |
| **Inflation** | Sticky: the Fed sees 2% only in 2029; PPI +5.4%; the rise is in real rates, not expectations. Long-run currency dilution plus AI productivity. | Cash erodes. Real assets and energy. | <ul><li>**Confirms:** core CPI MoM >0.4% (M-R08).</li><li>**Refutes (I):** the disinflation basket turning (I-12).</li><li>An "inflation beaten" threshold is TBD(Paul).</li></ul> | 2026-09-11/18 |
| **US equities** | <ul><li>An earnings-driven market (EPS +31%, forward P/E 19.6x, below its 5-yr average) with broadening breadth.</li><li>Bullish but hedged: financial conditions are the loosest since 1997, and tech's share is above dot-com levels.</li><li>"Betting on the US is a good bet" in a common currency.</li></ul> | US core; breadth (RSP, non-tech, oil) as insurance; buy dips only when the thesis is unchanged. | <ul><li>**Confirms:** upward EPS revisions; equal-weight records; multiple-led pullbacks (M-R22).</li><li>**Warns:** EPS growth slowing to 6–7% (his ~20%-correction case, 2025-12-22); narrowing breadth; the 1997 → 2000 conditions analogue (I-22).</li></ul> | 2026-08-14, 09-04, 09-25 |
| **AI cycle** | <ul><li>The thesis is unchanged.</li><li>Capex is supply-constrained demand.</li><li>Funding shifting to debt and equity is "next year's issue".</li><li>The semis cycle is maturing (EPS +143%); memory is the weakest.</li></ul> | Stay in AI through irreplaceable layers (NVDA, TSMC-type), not memory. Monitor the dials and financing. | <ul><li>**Confirms:** utilization, backlog growth and power prices rising; capex raised with receipts (領収書).</li><li>**Refutes:** utilization falling = demand death, so exit (M-R20); funding stress (threshold TBD(Paul)); semis EPS rate of change turning down (M-R23).</li></ul> | 2026-09-04, 09-18 |
| **Oil / energy** | <ul><li>Oil above $100 on Iran/Hormuz; the barbell worked.</li><li>No view on the oil price itself.</li><li>Nuclear is in a regime shift; the LT uranium price is heading toward three digits (Cameco).</li></ul> | Hold XOM/CVX as insurance (valued on reserves and capital returns); keep CCJ; NXE as a sized satellite. | <ul><li>Oil above $100 for **≥3 months** leads to inflation → rates → the S&P (M-R04).</li><li>~$20 of backwardation = the market expects resolution within months (I-44).</li><li>The uranium LT price, not spot; the SMR trigger (BWRX-300 on time and on budget).</li><li>Trim/add levels are TBD(Paul) (Q10).</li></ul> | 2026-08-25, 09-11 |
| **Gold / hard money** | The March dip was a correction in a bull market. Capital Wars. A dollar-confidence tail (Hormuz). | Energy + gold "at a set ratio" (TBD); a 60/20/20 review for FIRE-type portfolios. | <ul><li>His floor is $4,000–4,200; (I) a break below it would contradict "correction, not the end of the bull".</li><li>Line 3.</li><li>"Higher for longer" is a headwind (I-46).</li></ul> | 2026-03-29, 07-24 |
| **Geopolitics** | <ul><li>The short-war call is withdrawn; a prolonged Iran conflict with Red Sea spillover.</li><li>「正直に言うと、私には分かりません」 (honestly, I don't know) on Saudi Arabia.</li><li>The US is the safest place.</li></ul> | Barbell; don't reposition on headlines; US core. | <ul><li>The three lines (I-59).</li><li>**Refutes (I):** diplomatic progress; oil calming within weeks.</li><li>Line 3 is the only stated trigger for doubting the USD/Treasuries (PR-8).</li></ul> | 2026-07-24, 09-25 |
| **USD/JPY** | <ul><li>Base case: no long-term yen uptrend (2026-08-21).</li><li>But **円安リスク＞円高リスク** (yen-weakness risk > yen-strength risk) **is under inspection** (2026-09-11).</li><li>A BOJ hike would advance the 円高の芽 (early signs of yen strength).</li></ul> | <ul><li>Keep diversifying abroad.</li><li>Spread purchases over time, including currency timing.</li><li>Spendable yen goes to 個人向け国債 (fixed 5-yr 2.24%, floating 10-yr 1.95%) or deposits (1-yr up to 1.4%).</li></ul> | See PR-1 below | 2026-09-11/18 |
| **Japan** | <ul><li>JGB above 3% = normalization, not alarm.</li><li>The bank re-rating is over; regionals face a slow squeeze.</li><li>The dividend yield is below the JGB, so use the total-return lens.</li><li>Mortgage stress is a lagged, decade-long drag.</li></ul> | "US as the base, Japan as an option." Fixed-rate mortgages. Japan-resident readers: a large share in USD assets. | <ul><li>The 10-yr JGB and the BOJ path.</li><li>Regionals' deposit outflows, unrealized losses, 仕組貸出 and LDR; deposit-rate catch-up.</li><li>PR-4c is still open.</li></ul> | 2026-09-04, 09-25 |
| **China** | <ul><li>"Not avoid", but discounted by geopolitics.</li><li>EV and autonomous-driving leaders are strong.</li><li>Property is in a long cycle; China AI lagged.</li></ul> | Selective stock-picking; no index. | <ul><li>A policy-cycle turn (I-58) means buy gradually.</li><li>Evidence of China-AI catch-up.</li><li>Kill criterion TBD(Paul) (Q14).</li></ul> | 2025-12-22 → 2026-07-31 |
| **Taiwan / Korea** | Status quo; latent risk. Memory (Korea) is a commodity; TSMC is not. | Hold Asian semis via TSMC. Never sell US stocks over a Taiwan contingency. | Semis cycle (I-27); Korea ETF concentration (M-R27). | 2026-09-04 |
| **US politics** | <ul><li>Tariffs are a negotiating technique that converges.</li><li>Fed-independence risk.</li><li>The midterms (Nov 2026) are open (Democrats at 40–50% on 2026-03-12).</li></ul> | Don't let elections steer; buy a political crash. | Score the midterm call when the result comes; no strategy change (M-P4); I-55. | 2026-03-12, 03-31 ⚑ |
| **Recession** | No signal; growth is "too strong". | Stay invested. | HOPE sequence; FOMC growth-risk balance; GDPNow; retail sales. A numeric trigger is TBD(Paul) (Q9). | 2026-09-18 |
| **Other regions** (→ P5 §5.3.14) | <ul><li>EAFE is a "healthy alternative" (2025-12-22).</li><li>Non-US holdings are natural diversification, not money fleeing the US (2026-01-23).</li><li>India/Brazil: monitor only.</li><li>Avoid EMs with closed capital markets (2025-11-04).</li><li>Resource states: "don't know".</li><li>Crypto's role: TBD(Paul).</li></ul> | Partial diversification (IXN, EAFE, SAP); the US stays the core. | — | 2025-11 → 2026-09 |

**(b) Premises under inspection (点検リスト).** The confirm/refute conditions are his where stated; (I) marks editor-derived ones.

| ID | Premise (held since) | Status, Sep 2026 | Confirms (premise holds) | Refutes / his retraction conditions | Consequence now |
|---|---|---|---|---|---|
| PR-1 | **円安リスク＞円高リスク** (yen-weakness risk > yen-strength risk). Held since 2022-09-21 and reiterated on ≥30 dates. | **On the inspection list, not retracted** (2026-09-11). A BOJ hike would advance the 円高の芽 (09-18). What moved it: <ul><li>the yen at a ~7-month high;</li><li>BOJ hike expectations;</li><li>caution after the Jul-31 intervention;</li><li>the strongest wages since 1997 and positive real wages;</li><li>a narrowing US–Japan gap;</li><li>BofA's +6% call.</li></ul> | <ul><li>A wide rate gap.</li><li>2 of 3 drivers pointing to yen weakness (I-32).</li><li>The crowd still short the yen (¥3.6T), so "the trend often isn't over".</li><li>Intervention fading.</li></ul> | <ul><li>Yen strength needs a **US recession + large Fed cuts + continued BOJ hikes + structural reform** (2026-08-21).</li><li>A 10-yr spread <~2% makes ¥100–120 plausible.</li><li>Falsifiers: wages doubling, the yen at ~¥80 without a wage change, animal spirits.</li><li>**Numeric retraction trigger TBD(Paul)** (Q2).</li></ul> | Keep diversifying. A stronger yen is a reason to **stagger** purchases, not to stop. Yen you might spend goes to JGBs/deposits. `fx.yen_weakness_premise_status: under_inspection` |
| PR-2 | **"The US economy can withstand 3–4% nominal rates."** Rooted in the 2022-09-21 "sustainable regime" and "4–5%, not below 3%" (2024-05-02). | **Exceeded at 5%** and redefined as **"only companies with growing profits withstand a 5% world"** (選別の時代) (2026-09-11/18). | Growth-driven hikes (no FOMC member sees downside growth risk) are digestible. | Rising rates hurt only when growth weakens at the same time, so watch for that (I-06). | Stock selection over the index. Short bonds. Tilt to financials and energy. |
| PR-3 | **The yield-curve steepening hypothesis:** reflation → rising rates → steepening (2026). | **Corrected in public** (2026-09-18): the curve is flattening (2-yr at its highest since Jul 2024; the 10s–30s spread at its narrowest since Apr 2025). | — | He published the correction because curve shape decides which financials win: 政策金利の物語からカーブの物語へ (from the policy-rate story to the curve story). | Insurers first, then large banks/IBs, regionals last. US regional-bank NIM gains may stop. |
| PR-4a | **"Bank stocks rise with rates"** (a zero-rate-era Japan premise). | **Retired for the future** (2026-09-04). | His 18-yr data held in the past. | Banks up 6x vs TOPIX 2.3x; PBR 0.5 → 1.57; profit plans +4–12% vs +30–40% before; deposit-rate catch-up ahead. 「ピークアウトしているのは株価ではなく、勢いです」 (what is peaking is momentum, not the price). | Don't buy banks on the rates story. Watch the weak regionals. |
| PR-4b | **"High dividends beat deposits."** | **Broken** (2026-09-04). | — | The TSE Prime dividend yield (1.94%) is below the JGB (3.006%) for the first time since May 2008. A high-dividend stock that can't raise its dividend is now 一番分の悪い持ち物 (the worst-odds holding). | Use total return (総還元 3.6%). Spendable money goes to 個人向け国債 or deposits. |
| PR-4c | **"Japanese stocks are cheap."** | Listed for inspection but **not re-examined**. | — | TBD(Paul). US ROE 20% vs Japan 9% hints at the answer. | — |
| PR-4d | **US-rates and Taiwan/Korea premises.** | Re-checked (2026-09-04). | — | Memory crashed and TSMC decoupled. The test is commodity vs non-commodity. | Asian semis via TSMC; the Korea ETF is not diversification. |
| PR-5 | **The rate-cut tailwind** (「金融政策はすでに緩和局面」, monetary policy is already in an easing phase; Dec 2025 – Jan 2026). | **Overturned.** | — | Higher for longer in Mar 2026; a Fed hike in Sep 2026. | Rate-cut beneficiaries (real estate, China, EM) lose their macro support. Real estate ETFs are a trim candidate (2026-08-28). |
| PR-6 | **A short Iran war** (2026-03-12/19). | **Withdrawn** (2026-07-24): 「修正せざるを得ません」 (has to be revised). | — | No diplomatic progress; Red Sea spillover; oil spiking again. 「前提が変わったなら見方を変える。それも投資です」 | Barbell; gold/energy kept. |
| PR-7 | **The AI thesis is intact.** | Held: 「AIのテーゼは、変わっていません」 (2026-09-11). The pressure came from outside the thesis: rates, oil, FX. | The three dials; capex with receipts. | Exit only on demand death (utilization, backlog, power prices). The funding-stress threshold is TBD(Paul). | Stay in AI with irreplaceable layers; avoid memory. |
| PR-8 | **The US as the safest haven vs dollar-confidence risk.** | Both held: the US is the core, and hard money hedges the dollar tail. | DXY rose in the crisis. | Line 3 (loss of Hormuz control) is the **only** stated trigger for doubting the USD/Treasuries. Other triggers are open (Q16). | US core + energy/gold at a set ratio. |
| PR-9 | **The semiconductor cycle** (an implicit premise that the upcycle continues). | Watch: 「いずれ…ピークを打ち」 (it will peak at some point). | — | Semi EPS +143% vs past peaks of +30–80%. The trigger is the rate of change turning down. | At the peak, lean on breadth. Take commodity-chip profits at the peak of glamour. |

**(c) Latest readings he cites** (the engine's initial state vector, as written; → P5 §5.4.3)

| Variable | Latest value | Date |
|---|---|---|
| Fed funds | 3.75–4.00% (+25bp, the first hike in 3 years); an October hike >50% priced | 2026-09-18 |
| US 10-yr / 30-yr / 2-yr | 10-yr above 5%, the first time since Jul 2007. On 09-11: 10-yr 4.95%, 30-yr 5.37%, 2-yr 4.57% (1-year highs). | 2026-09-11/18 |
| US PPI | +5.4% YoY (August) | 2026-09-11 |
| S&P 500 | +14% YTD; EPS +31%; P/E −13%; forward 19.6x; equal-weight at a record (Aug) | 2026-09-04 |
| Oil | Above $100; Brent ~$105, WTI $100; diesel $5.94/gal | 2026-09-11 |
| Gold | $4,400–4,500 (last cited); floor $4,000–4,200 | 2026-03-29 |
| USD/JPY | The 163 range led to joint intervention on Jul 31; the yen at a ~7-month high on 09-11 (no level given) | 2026-08-21, 09-11 |
| BOJ / JGB | BOJ 1% (a hike pending on 09-18); 10-yr JGB 3.006% | 2026-08-21, 09-04 |
| Japan equities | TSE Prime dividend yield 1.94%; total yield 3.6%; banks 6x vs TOPIX 2.3x since 2022 | 2026-09-04 |
| Uranium | LT ~$95, spot ~$87, 5-yr forward ~$105 | 2026-08-24/25 |
| Asia semis | Korea −30% from its June high; Taiwan −5%; SK Hynix −46%; semi EPS +143% | 2026-09-04/18 |
| Growth | GDPNow ~5% (Q3); retail sales beat on every line; no FOMC member sees downside risk | 2026-09-18 |

**(d) Geopolitical frameworks behind "US core + hedges"** (→ P5 §5.3.9(b); F-67, F-69, F-70, F-74, P-12)
- **"Markets, not land"** (2022-09): 「アメリカが戦争に勝利した果実は土地ではなく、市場でした」 (the fruit of America's victory was markets, not land).
- **War 1.0 vs 2.0** (2023-10): 1.0 is about land and is prolonged; 2.0 is about markets, and both sides can prosper.
- **Frontier of the American empire** (2023-10): conflicts start on the border of the US market empire, so don't concentrate there.
- **The US-instability paradox** (M-P13).
- **"Boss" (親分) logic** (2024-07; 2025-01): the US as boss gathers the wealth, so overweight the US.
- **Civilization 1.0/2.0/3.0** (2025-01): territorial ambition is a regression that raises instability.
- **"No true alliance" / three spheres** (2025-02/03): raise the US weight somewhat.
- **AI as national security** (2024-08; 2025-11): you need US stocks for AI exposure.
- ⚑ **Whale vs elephant / "strongest extractor"** (2026-01): 「抽出する側（勝者）の資本に相乗りすること」 (ride the capital of the extracting side, the winner).
- **Capital Wars** (資本の戦争, 2026-01-23): gold is a 「非主権的資産」 (non-sovereign asset).
- **Dalio's Big Cycle; Hormuz = Suez 1956** (2026-03): a hard-money hedge and 60/20/20.
- ⚑series **Three pillars against "America in decline"** (2026-03-31): no alternative to the dollar; military plus geography; turmoil is 「民主主義のコスト」 (the cost of democracy).
- **"Designed to survive any shock"** (2026-03-24): past crises are 「小さな凹み」 (small dents) on a 30-year chart.
- **Resource curse** (資源の呪い, 2026-09-25).
- ⚑ **Investor passport** (2026-03): 「経済的なアメリカ市民」 (an economic American citizen).

### 6.5 Track-record lessons

**(a) Structural vs point/timing calls** (P5 Overview)

| Structural calls that held ✔ | Point/timing calls that missed ✘ or were reversed ↺ |
|---|---|
| **No deep US recession**: held on every recorded date, 2022-08-30 → 2026-09-18 | **The Fed peak level**: "5.25% should be the peak" (2023-05-05 ✘); "higher for longer won't happen" (2023-01-12 ✘) |
| **A weak yen through mid-2026** (¥120s → 163) | **"2% inflation by 1H2024"** (2023-11 ✘) |
| **金利のある世界**: no return to low rates (2024-03, confirmed in 2026) | **"¥150 is the peak"** (2024-03-08 ✘) |
| **AI as a multi-year capex cycle** ("AI is real", 2023 →) | **A stronger yen in 2024** (2023-12-12 ✘; he conceded it was "already priced") |
| **Nuclear/uranium** (2022 → 2026) | **Oil at $92–100+ in 2024** (2024-03-29 ✘) |
| **US assets as the haven in turmoil** | **The 2024 Congress outcome** (Senate 2024-07 ✘; divided government 2024-11 ✘) and **the 2025 midterm call** (↺) |
| | **A short Iran war** (2026-03 → withdrawn 2026-07-24, ↺✘) |
| | **The 2026 rate-cut tailwind** (↺/✘) |
| | **Curve steepening** (✘, self-corrected 2026-09-18) |

**(b) Call audit by category.** Counts are the items P5 §5.3.17 lists; "notable misses" are drawn from those items.

| Category | Held ✔ | Missed ✘ / reversed ↺ | Notable misses |
|---|---|---|---|
| US growth / recession | 3 | 2 | The revised stock-bottom call for H1/mid-2023 (2022-12-05); stagflation odds "fairly high" (2025-04-28) |
| Fed / rates | 6 | 7 | <ul><li>"Higher for longer won't happen" (2023-01).</li><li>5.25% is the peak (2023-05).</li><li>The 3/22 hike was unnecessary (2023-03).</li><li>Sided with market pricing below the dots (2023-01).</li><li>10-yr in the "5–6% range" (2023-10).</li><li>The 2026 easing tailwind ↺.</li><li>Curve steepening ✘.</li></ul> |
| Inflation | 3 | 2 | 4.5–5% through 2023 (2022-11); 2% by 1H2024 (2023-11) |
| Yen | 2 | 4 (+ the premise now under inspection) | "¥150 may be the peak" (2024-03); a 2024 flat/slightly stronger yen (2023-12); "the BOJ can't hike meaningfully" (2024-03); "the BOJ should stop hiking" (2024-08) |
| Japan | 3 | 4 | <ul><li>A Japanese bank crisis and bearishness on banks (banks rose 6x).</li><li>"Governance is cosmetic" (banks re-rated).</li><li>Stagflation in Japan (2023-11).</li><li>Index-level pessimism (TOPIX 2.3x).</li></ul> |
| China | 2 | 3 | "Recovery almost certain" (2024-02); "stagnation is temporary" (2024-01); China AI catch-up soon (2025-06), after which China AI lagged badly (2026-01) |
| Taiwan | 1 | 0 | — |
| Politics | 2 | 5 | The Senate (2024-07); divided government (2024-11); the midterm call ↺ (2025-04 → 10); tariffs "not a high priority" (2023-12); the ~50/50 wobble (2024-08) |
| Geopolitics | 2 | 2 | Ukraine/Gaza end in 2024 (2023-12); the short Iran war ↺ (2026-03 → 07) |
| Energy | 3 | 3 | WTI $92–100+ in 2024; "oil near bottom" in May 2025 (timing); "nuclear levels off" (2025-12, on technicals) |
| AI | 4 | 1 ✘ (+1 ~, +1 ?) | Small caps catch up (2024-09 ✘); "the last big buying opportunity" (2025-03, ~); the LTCM-analogue peak (?) |
| Rate-sensitive sleeves | 1 | 3 | REITs/real estate (2023-12 → 2026-08); small caps; the EM flip |
| **Total** | **32** | **36** (+2 AI ~/?, +1 under inspection) | |

**(c) Full tally of P5 §5.3 status marks (editor's count).**
- **Scope:** 327 dated view rows carry a status column; 280 of them are scored.
- **Counts:** ✔ 162 · ~ 36 · ✘ 29 · mixed ✔/✘ 8 · ↺ 8 · ↺+✘ 3 · ? 34.
- **Unscored:** 47 rows ("—", "current", or evidence rows).
- **Caveat:** these rows are dated views, not independent forecasts. The ✔ count includes framework/rule confirmations and "no crisis" outcomes, so it flatters his point accuracy. Use the curated audit in (b) for weighting.

**(d) Patterns worth encoding** (→ P5 §5.3.8, 5.3.12, 5.3.13, 5.3.17)
- **Recession.** His recession-*risk* flags (SVB 2023-03; ⚑LEI 2024-08; stagflation 2025-04) never became recessions. There is no inversion rule, no Sahm rule and no numeric trigger; HOPE is his only staging tool.
- **Elections.**
  - Winner: right. He called Trump in 2024 (2023-05-12 → 2024-01-19), with a mid-course "~50/50" wobble (2024-08-02).
  - Congress: wrong twice.
  - 2026 midterms: reversed, then partly swung back ("Republicans lose Congress" 2025-04-10 → "not optimistic for Democrats" 2025-10-03 → "Democrats 40–50%" 2026-03-12). The outcome is pending (Nov 2026).
  - His tone on Trump swung several times, but the conclusion never changed: stay in US assets.
- **Rate-sensitive sleeves.**
  - ✔ Duration discipline: he avoided long duration in 2022–23 and in 2026.
  - ✘ REITs/real estate: BXP added 2023-09-15 and XLRE/VNQ 2023-12-14; they lagged, and became "weeds" and a trim candidate (2026-08-28).
  - ✘ Small caps: 2024-09-20 → the worst performers YTD (2025-07-04).
  - ↺ EM: "favour EM" (2024-09-10) → "EM will struggle" (2024-11-18).
  - ~ US banks: the 2023 regional-bank trade was cut, but big banks did benefit.
- **Reversals by Paul himself** (11 ↺ rows):
  - the easing-phase tailwind;
  - the ~50/50 election call;
  - the short Iran war;
  - Japanese banks benefiting from wider margins (2026-03), then "re-rating nearly over" (2026-09);
  - his China tone (2024-06);
  - the midterm call (3 rows);
  - EM;
  - the two gold rejections (2025), before gold was adopted in 2026.
- **Self-claims ≠ the record** (D6).

**(e) Engine design rule** (P5 §5.3.17, I; matches M-P1 and his 2026-09-27 rule "judge process, not hits": P-21, F-93)
- **High weight:** his structural regime classifications:
  - 金利のある世界;
  - the inflation regime;
  - US-as-haven;
  - AI-cycle health via the dials;
  - no deep recession;
  - the yen's structural drivers.
- **Low weight:** point levels, timing calls, and political/election forecasts.
- **Zero weight as a signal:** rate-cut sector rotations (REITs, small caps, EM), unless a stock-level thesis stands on its own.
- **Score calls from the corpus record,** never from his self-reports.
- **Config:**
  - `macro.forecast_weight: {structural_regime: high, point_level: low, timing: low, political: low, rate_cycle_rotation: 0}`
  - `macro.call_scoring_source: corpus_record`

**(f) Asset-class scoreboards he published** (outcome evidence; → P5 §5.3.18)
- **2022:** VV −19.91%; S&P −18.18%; DXJ +5.96%; 60/40 −16.34% ("worst in 100 years"); energy was the best sector.
- **2023:** DXJ +41.39%; VV +27.49%; S&P +26.27%; XLRE +12.25%; EEM +7.54%; AGG +5.42%; cash 4.65%; XLE +1.59%.
- **2024:** DXJ was the best asset; energy was among the worst; S&P ~+27%.
- **2025:** URA +46% YTD (Jul), the best asset class; small caps the worst; MSCI Japan +23% YTD (Oct); real estate lagged despite cuts.
- **2026 YTD:** S&P −7.6% from its high (Mar 29), then +14% with EPS +31% (Sep 4); Japanese banks 6x vs TOPIX 2.3x since 2022; Korea −30% from its June high; memory/neoclouds −35–55% (Jul).

**(g) Historical analogues he uses** (→ P5 §5.3.16)
- **Oil shocks:** 1973/1979/1990 hit immediately, 2008/2022 with a lag, so the duration of the spike matters. After the Gulf War, the Iraq War and the 2019 Saudi attack, the S&P was up a year later.
- **Suez 1956** as a Hormuz template; the 1941 oil embargo, since energy security drives war risk.
- **1946 US debt at 118% of GDP** points to the inflation route out.
- **"Not the 1970s"** (2022).
- **1997 loose conditions → the 2000 crash.**
- **The bubble table** (gold '77 … AI '23) gives the ~3-yr clock. **Dot-com/Cisco**: demand-death selloffs mean exit. **⚑ LTCM 1998**: a low-weight timing input.
- **Lehman**: "not Lehman-class". **SVB/Credit Suisse**: a duration failure, big banks benefit, the AT1 lesson. **COVID**: "a stone dropped in a pond".
- **2022**: 60/40 failed, so use a barbell or cash instead of bonds.
- **Crash-as-opportunity episodes:** the Aug-2024 carry crash (recovered in ~2 weeks); Liberation Day 2025 (buy gradually); Iran in Mar 2026 (valuation normalization); the Jul-2026 "AI crash" (a flush, not demand death); NFLX's 2022 Russia-exit plunge.
- **Japan cases:**
  - the 1989 Nikkei peak (don't rely on Japan's index);
  - the 1990s yen at ¥80s (humility on FX);
  - the BOJ's post-bubble hard landing;
  - Kyle Bass (right idea, mistimed; ✘ timing);
  - the Argentina worst case;
  - postwar land reform and the deposit freeze (⚑; the investor passport);
  - the Korean-War procurement boom "no longer holds".

### 6.6 Config keys & open decisions for Paul

**Config keys** (namespace extended with `macro.*`; values are as written or TBD(Paul); key paths harmonized to `config/philosophy.yaml`, which is canonical; feeds §9)
```yaml
timing:
  macro_overlay_allowed: true                    # allocation layer only (M-P6, D2; R-87 no auto-trades)
  macro_overlay_scope: [asset_class, sector, currency, cash_parking, hedge_size]   # confirm: Q11
  rate_cycle_sector_tilts: TBD(Paul)             # P5 weighting (I): zero as a standalone signal (M-R11, D3); Q7
  recession_signals: TBD(Paul)                   # no inversion/Sahm rule in corpus; Q9
  macro_thresholds:
    ust10y_risk_asset_headwind_pct: 4.5          # Timmer ⚑; action TBD(Paul) (M-R05); Q1
    ust10y_exceeds_tolerance_pct: 5.0            # M-R06, PR-2
    oil_spike_usd: 100                           # M-R04
    oil_persistence_months: 3                    # M-R04; action beyond "hold" TBD(Paul)
    oil_backwardation_resolution_usd: 20         # I-44
    core_cpi_mom_hike_pct: 0.4                   # M-R08
entry:
  dip_buy_requires_thesis_intact: true           # M-R01
  staged_tranches: TBD(Paul)                     # "少しずつ", horizon 4+ yrs (M-R01)
exit:
  valuation_trim_trigger: TBD(Paul)              # bubble trigger: "by feel"; bubble clock ~3 yrs (2–4) from 2023 (M-R21); Q6
  ai_funding_stress_trigger: TBD(Paul)           # I-26; Q6
crisis:
  block_panic_macro_sells: true                  # M-R01, M-R18; R-106 HARD
  cooling_off_days: TBD(Paul)                    # "don't trade in the first days" (M-R03)
state:
  shock_type:
    persistence: [temporary_shock, structural_change]     # M-R03
    mechanism: [demand_death, position_clearing]          # M-R20
research:
  ai_dials: [utilization_lit_rate, backlog_growth, power_prices]            # M-R20
macro:
  regime: classifier over R1..R6                 # labels are P5 inferences
  move_gt_vix_review: true                       # M-R07
  hike_cycle_type: [one_and_done, cycle]         # M-R09
  financials_order_flat_high_curve: [insurers, large_banks_ib, regionals]   # M-R10
  semis_eps_growth_past_peak_pct: [30, 80]       # M-R23 (now +143%)
  vix_level_threshold: TBD(Paul)                 # I-07
  premise_inspection_list: [PR-1, PR-2, PR-3, PR-4a, PR-4b, PR-4c, PR-4d, PR-5, PR-6, PR-7, PR-8, PR-9]
  forecast_weight: {structural_regime: high, point_level: low, timing: low, political: low, rate_cycle_rotation: 0}
  call_scoring_source: corpus_record             # D6
fx:
  hedge_policy: foreign_unhedged; jp_equity_may_use_yen_hedged_vehicle     # D7, M-R16
  jp_reader_overseas_target_pct: TBD(Paul)       # JP-resident USD share: "majority of growth assets" / "a large share"; Q12
  yen_strength_action: stagger_usd_accumulation  # never stop diversifying (M-R15)
  yen_weakness_premise_status: under_inspection  # PR-1
  yen_premise_retire_triggers: TBD(Paul)         # Q2
cash:
  parking_instruments: {usd: [t_bills_mmf, SGOV, SCHO, VGSH, SPTS, short_ladders], jpy: [個人向け国債, time_deposits]}
  hurdle_rate_source: us_tbill_mmf_yield         # M-R26; the ~5% 10-yr as "certain" benchmark (M-R06)
  long_bonds_allowed: false                      # current regime (M-R06; R-82)
construction:
  us_min_weight: TBD(Paul)                       # US core; raise "somewhat" on turmoil (M-R17)
  sleeves: [ai_tech_core, energy_insurance_oil_majors, uranium_ai_power, hard_money_gold]
  sleeve_weights: TBD(Paul)                      # Q3
  review_mix_stocks_bonds_hardmoney: [60, 20, 20]   # review target after MOVE>VIX (M-R07); split inferred per P2 R-80; scope TBD(Paul), Q3
hedge:
  gold_allowed: TBD(Paul)                        # in the hedge leg since 2026-03 (D9); vehicle/ratio/RP inclusion open (Q4); P2 R-81 GATE
  energy_gold_ratio: TBD(Paul)                   # "一定比率" (C8, M-R07); Q3
  bitcoin_allowed: TBD(Paul)                     # hard money vs speculation; +64% USD correlation ⚑; Q5
```

**Open decisions for Paul** (P5's list, condensed; feeds §10)

1. **Rate threshold and action.** Which line triggers action: the 10-yr above 4.5% (Timmer ⚑) or 5% (the end of the 3–4% premise)? What exactly is the action (growth-exposure cut, duration, cash buffer)?
2. **Yen retraction trigger.** Candidates: a BOJ rate ≥ ?%; a US–Japan 10-yr spread < 2%; real wages positive for N months; USD/JPY below ¥?. And what changes for Japan residents beyond staggering purchases?
3. **Hedge ratios.** Scope and target weights for "energy + gold at a set ratio" and 60/20/20 (the RP? FIRE portfolios? all readers?), covering oil, uranium, gold and BTC.
4. **Gold.** Is it a standing sleeve? Which vehicle? Is it in the RP?
5. **Bitcoin.** Hard money or speculation, given its +64% correlation with USD?
6. **AI exit and funding-stress numbers.** Which utilization, backlog or power reading means "demand death"? Which financing reading (third-party financing share, capex/OCF, hyperscaler FCF) means funding stress?
7. **Rate-cycle sector tilts.** Keep them at all? If yes, with what sizing and time stops? Is the real-estate-ETF trim decided?
8. **Insurers.** Do they enter the RP, and on what entry condition?
9. **Recession signals.** Should the engine have a numeric recession/VIX trigger, or keep "no macro selling" absolute?
10. **Oil.** Is there any oil level or curve shape (e.g., contango above $X) at which to trim or add the energy sleeve?
11. **Hierarchy.** Confirm: macro → asset class, sector and currency weights; stocks → bottom-up only; never trade single stocks on macro.
12. **Japan residents.** What USD-share band should the engine use for "a large share in USD assets", and how does it scale with age and spending horizon?
13. **PPP.** Should the engine model PPP convergence through Japanese inflation only, and over what time horizon?
14. **China.** What is the current sizing rule and the kill criterion?
15. **Political forecasts.** Ignore his party/Congress forecasts and keep only the rules ("don't let elections steer"; "buy the political crash")?
16. **Other dollar-confidence triggers** beyond Line 3 (a failed auction, the buyback scale, foreign selling), and what would the portfolio do?
17. **Numbers to verify before encoding:**
    - the 1984/2015 hike-cycle comparison (2023-05-05);
    - 「２２００億ドル」 corporate cash (2023-09-22);
    - "Fed +5% in 10 months" (series);
    - the mortgage math (2025-02-24);
    - "500億ドル" in Ukrainian minerals (2025-02-21);
    - the labour force "~half by 2050" (2024-11-18);
    - 「円安に転じます」 (2023-12-14), probably 円高;
    - "July inflation 2.9%" (2025-09-18);
    - the "yen −38%" (2024-04-22).


---

