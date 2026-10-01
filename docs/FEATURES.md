# Logic and feature suggestions (checklist)

Built in v1 are marked ✅; proposed next steps ☐. Every item maps to the spec.

## Two programs, one engine
- ✅ **Sourcing** — `engine ideas`: scours the whole universe. Sector call first (stance, rationale, recommended sector bet vs market weight,
  theme cycle status), then the best names inside each sector, Idea Strength, gates, Kelly size, narratives. Answers "what should I look at?"
- ✅ **Evaluation** — `engine evaluate NVDA ORCL --thesis thesis.md [--narrate]`: Paul's own names. Each is built fresh and placed inside the full
  scored universe of the date (reusing the last `engine ideas` run of that date): rank and percentile, rank within its sector, whether sourcing
  would have chosen it, the sector view and bet, every reason for and against, open gates, Kelly size among the evaluated names, and — with the
  narrative layer — a claim-by-claim verdict on Paul's thesis (supported / contradicted / mixed / unverifiable, evidence cited by document and
  period, what the documents say that the thesis is silent on, checkpoints, the tension). `## SYM` sections in the thesis file address one
  name each. Names can come from a CSV/TSV/TXT/XLSX file (a symbol/ticker/code column, else the first column; `NASDAQ:NVDA` and `7203.T`
  forms accepted; 4-digit codes route to Japan) — the same file input works for `engine ideas --symbols`, `engine pull us --symbols`
  and `engine text pull --symbols`. Answers "is my idea good, and how big?" Both programs call the same functions; a fix lands once.
- ✅ **Evaluator page** — `engine serve` → http://127.0.0.1:8000/evaluate: tickers or a CSV upload, the thesis with one `## SYM` section per
  name (headers pre-filled), optional bull/base/bear return and probability per name (then Kelly sizes Paul's view, taken as given, not the
  engine's scenarios), a Claude-verdict checkbox; the run happens in the background and the page opens the result. A **thesis ledger**
  (`data/evaluations.jsonl`) keeps one row per name per evaluation, and every result says what moved since the last time: rank, action,
  sector stance, Kelly size, verdict, and each claim's status.
- ✅ **Data sharing between sessions** — `engine data pack | unpack | push | pull`: one tarball of the derived tables (PIT parquet, candidate
  cache, LLM cache, text reads; raw pulls only with `--raw`) to an S3-compatible bucket named by `ENGINE_DATA_BUCKET`, credentials from the
  environment. A second Claude Code session restores the data in minutes instead of re-pulling for a day.

## Selection logic
- ✅ **Sector call before stock call (two stages)** — theme sectors built from GICS-style sector/industry (`config/sectors.yaml`) with the AI
  value chain split into Jensen Huang's five layers — **Energy → Chips → Infrastructure → Models → Applications** (all five must scale together; a
  bottleneck in one constrains the whole system) — each evaluated as something to be owned in its own right.
  A name in a non-core industry joins an AI layer point-in-time when its own calls talk about AI at intensity, so AI membership grows as the theme
  diffuses (from 2015 in the archive). Stage 1 scores every sector on its members' growth, fundamental momentum, quality, valuation and theme
  diffusion, gives a stance (overweight / neutral / underweight / avoid / thin) and a written rationale with the numbers and ranks it used;
  stage 2 allocates the top-N slots to sectors by stance and picks the best Idea Strength inside each sector. The backtest reports each pick
  against its own sector (equal-weight of all eligible members) and splits the result into allocation (the sector calls) and selection (the names).
- ✅ **The story, built from the fundamentals (Paul, 2026-09-30: "the thesis leans too hard on the quant screen")** — every idea page now leads
  with a narrative assembled from the filings themselves, no model needed: what the company does (its own profile description), how the earnings
  have grown (a six-year table of revenue, growth, operating margin, EPS and free cash flow plus the three-year and twelve-month rates), what is
  driving it in management's words (the demand, receipts, guidance and leadership quotes from the latest calls, Claude's one-line read when
  available), how good the business is (returns, margins and their trend, cash conversion, balance sheet, R&D), what could break it (deceleration,
  red flags, leverage, cash quality, concentration, a commodity peak, a negative quote), and what you pay. The Claude thesis record sits on top of
  this when narratives are on. Idea Strength moves down the page.
- ✅ **Danoff lens (The Smiley Fund)** — a separate read beside Idea Strength, never blended: *follow earnings* (years for EPS to double at the
  slower of the three-year and twelve-month rate, capped at 60%/yr; four-to-five years is the test), *smile or frown* (EPS growth, acceleration,
  beat streak, guidance language, red flags → keep / sell-or-swap), *quality over price* (ROIC, gross margin and its trend, leadership language,
  the indispensable-#1 read, cash conversion → best of breed), *price vs growth* (the price is forgotten if the growth is there), and *ignore the
  past price* (a stock up 50%+ is not a missed stock; the question is whether earnings can double from here). Score 0–100 with a verdict (would own
  / look closer / pass / sell-or-swap). Per sector: share of members smiling and frowning, median years to double, the best-of-breed name. Shown
  on every idea page, board row and sector card, and on the evaluator page.
- ✅ **Commodity cycles and the barbell (Paul, 2026-09-30)** — oil and tech are the two ends of the barbell, and oil has become less cyclical as capex
  discipline grew; the engine watches for the same shift in every commodity-type group (memory runs the same pattern on a longer cycle). A build
  step aggregates quarterly revenue, operating income, cash flow and capex per group (oil & gas, memory & storage, copper, steel, chemicals, gold
  miners, marine shipping, uranium; `config/commodity.yaml`), point-in-time. At any date the read gives: cycle phase (aggregate TTM operating margin
  vs the group's own ten-year range: trough / mid-cycle rising or falling / peak, with the turn), **capex discipline** (today's capex ÷ operating
  cash flow against the group's whole history, 0–100), whether the swings have **dampened** (five-year amplitude vs the prior five), and the typical
  cycle length (median gap between margin peaks). The read lifts a sector call at a disciplined trough and lowers it at an undisciplined peak
  (±8 points, D-04), halves the peak-margin penalty for members of a disciplined group (R-15 stays hard at the 90th percentile), appears in every
  commodity name's summary, and the board carries a barbell card: the tech end (the five AI layers' stances and bets) and the oil end (Energy's
  stance, bet and cycle read). Example reads: oil 2022-06 "peak, capex 31% of cash flow vs a 62% norm, swings 0.5× — dampened"; memory 2026-09
  "peak, margins at the 100th percentile, capex discipline 88/100, still fully cyclical, cycle ≈ 3 years".
- ✅ **Idea Strength (0–100)** = preset-weighted blend of eight angles, each 0–100 within region × date: story & growth
  (P-24/R-43), moat/toll booth (F-01/F-43), quality & cash (F-07/F-82/F-40), on sale vs fair value (F-13/F-14/F-12),
  asymmetry (F-76), alignment (F-09 proxy/R-22), fundamental momentum (F-17), portfolio fit (R-40/R-77).
- ✅ **Gates before ranking** (G1–G6): veto/avoid removes from the top-N but the name still shows "would rank #n".
- ✅ **HARD exclusions** as data tests (funds, crypto, banks as black boxes, recent IPOs, pre-revenue dreamers,
  cyclicals at peak margins).
- ✅ **Proposed action** buy-in-stages / watch / pass with the rule ids behind it; staged tranches at the own-band 10th-pct P/E.
- ✅ **INV-3 respected**: a drawdown scores only when the F-12 decomposition shows the multiple fell while earnings held.
- ✅ **Reverse DCF** "growth the price implies" as a factor; scenario DCF with expected value **and** range (F-77).
- ✅ **Weight presets** (paul_default, growth/value/quality tilt, crisis mode) and a board that re-ranks on any angle.
- ✅ **Cycle-aware holding period (D-24)** — the backtest no longer assumes a fixed hold. A pick is held until its theme-sector cycle is judged
  over, point-in-time from later quarterly evaluations only: the sector call has reversed (avoid, or two stance levels below the call made at formation) at K consecutive evaluations, or the
  theme's transcript breadth sits ≥25% below its trailing peak for K quarters (a theme counts as a cycle only once it has reached real breadth);
  bounded by a 12-month floor and a 60-month ceiling (thematic cycles run 2–5 years; the AI cycle dates from Nov 2022). Fixed 24/36-month holds stay
  in the sensitivity grid as variants; positions still open are marked at the last close and flagged, never silently dropped.
- ✅ **Kelly position sizing (D-01, hypothesis)** — per name, the scenario Kelly f* = argmax Σ pᵢ ln(1 + f rᵢ) is found numerically over bull/base/bear
  scenarios built from the engine's own yardsticks — growth path (3-year revenue CAGR under the R-24 ceiling) × multiple path (P/E moving to the
  own-history band, F-13) — with the DCF's weighted upside shown as a cross-check (the bear return floored at −1σ·√H of the name's own trailing volatility so a losing outcome always exists);
  long-only 0 ≤ f ≤ 1, full/half/quarter shown, the practical position = min(½ × f* × confidence, 15% cap) and never called "the Kelly fraction";
  no positive expectation → 0%. Confidence (high 1.0 / medium 0.75 / low 0.5 from factor coverage and DCF basis) scales the fraction, never the
  edge. Across the book the portfolio Kelly w* = Σ⁻¹(μ − r_f·1) on the trailing 250-day covariance (shrunk toward the diagonal) sizes names that
  share a driver (AI infrastructure, semis, oil, China, rates) as one bet; no leverage, remainder cash. Every idea page shows expected return,
  worst outcome, full/half/quarter Kelly, cap, practical position, portfolio weight and the scenario assumptions; the backtest reports equal-weight
  and Kelly-weighted cohort returns side by side (fully invested, and with the cash remainder at the 10Y rate).
- ☐ Estimate-revision direction (F-17) as a live-only component using FMP analyst estimates + price-target history.
- ✅ **Text layer (cognitive reading of disclosures)** — two tiers feeding the angles as SOFT components:
  - *Lexical, point-in-time, backtestable*: every earnings-call transcript since 2015 and the latest 10-K Items 1/1A/7 and 10-Q MD&A are scanned for
    demand/backlog/capacity language (F-42/F-40), price increases sticking vs erosion (F-08), guidance raised vs cut (F-17), 主役 language — share gains,
    #1, sole supplier, switching costs (F-01/R-09), AI receipts (F-45), customer concentration (R-18) and red flags — going concern, restatement, material
    weakness, covenant, investigation (X-19). Each hit keeps its sentence and document date; scores are per 10k words over the two latest calls and the latest filing.
  - *Claude read, live-only* (`engine text read`, Sonnet, cost-capped): a structured TextRead per name — demand, pricing power, competitive position and
    is-number-one, guidance, the AI three dials, red flags, tone — each with quoted evidence; used like estimate revisions (live factors, absent in the backtest).
- ☐ Receipts ratio (F-40) from XBRL RPO for AI sellers (the text tier already reads AI backlog/RPO language).
- ☐ 13F "informed holders added" (F-111), SOFT only.
- ✅ Japan pilot (Core30 + Large70) screened and backtested from 2017-12-31 on J-Quants 決算短信 point-in-time data (DiscDate), split-restated per-share figures, 簡易FCF / ROIC proxies labelled.
- ☐ Japan-specific yardsticks (総還元 vs JGB; R-38 FX-sensitivity check) and EDINET governance parsing for G1/G2.

## The pitch report — stories by sector, charts of the sector, valuation cycle, what the price assumes (2026-10-01)

Paul's reaction to the first boards: "everything the engine outputs is a technical cite — I need a narrative, like someone making a
presentation and trying to convince me". The report is now told sector by sector, as a pitch; the statistics stay one click below.

- **Sector-grouped board.** One section per sector call that holds a chosen name (ordered by stance, then score): the sector's story,
  chart A (the sector as an equal-weighted index of every scored member, rebased to 100 over three years, against the S&P 500 total
  return, with the chosen names' own lines), chart B (every member as a thin line over the index — the 60 largest drawn when there are
  more, all of them in the table with strength, call, three-year return, P/E, own-history percentile and valuation phase), then each
  stock's section. Sectors without a pick are one compact table. The old sortable table of every name is kept at the foot.
  Code: `screen/sector_index.py` (daily-rebalanced equal weight, the backtest's arithmetic), `reports/charts.py::build_rebased_chart`,
  `reports/sections.py`, templates `_sector_section.html.j2` / `_stock_section.html.j2`.
- **The stock's story** (`research/pitch.py`, schema `StockPitch`): opening, the business, why now, the valuation in its own cycle, what
  the price assumes, three reasons (strongest, weakest, second — the sandwich), what breaks it, the closing ask. Written by Claude from
  the same context as the thesis record (FinancialRead, reasons, 10-K Items 1/1A/7, 10-Q MD&A, latest transcript) plus the fundamentals
  story, the valuation cycle, the implied-growth record, the why-cheap read and the engine's action, in a presenter's voice with no rule
  ids. Every figure must appear in `numbers_used` with a source; `verify.py` checks the claims and every number in the prose is traced to
  the context (the count of untraceable figures is printed under the story). Cached by request hash; `--no-pitch` or no key → the same
  eight sections assembled deterministically from the engine's own prose. The sector's story (`SectorPitch`) is built the same way from
  the sector call, its rationale, bet, cycle read, breadth and member table.
- **Valuation cycle** (`frameworks/valuation_cycle.py`): the daily P/E history the own-history band is scored on is kept as month-end
  samples (`metrics.pe_history`) with a cycle read (`metrics.valuation_cycle`: percentile, 10th/median/90th, phase trough / below norm /
  normal / above norm / peak, a plain sentence) and drawn under every stock story (`build_valuation_chart`: the multiple, the band shaded,
  the median dashed, today marked). Names without earnings get the same on price-to-sales. Thresholds: `valuation.cycle_*_pctile` (D-25).
- **What the price assumes** (`frameworks/implied_growth.py`, F-16/F-91/R-24): the earnings growth solved backwards from today's multiple —
  g = ((P/E_now ÷ P/E_exit) × (1 + r)^N)^(1/N) − 1, with r = 10-yr UST + the hurdle margin (D-47), N = `valuation.implied_growth_years`
  (D-24) and the exit multiple the lower of the company's own 10-year median and the long-run market multiple (`valuation.exit_pe_fallback`,
  D-25); the growth needed "if it keeps its usual multiple" is shown beside it. Compared with delivered three-year growth → "priced for
  less / about / more than it has delivered". A company with no earnings gets the revenue-growth version (margins reaching
  `valuation.mature_margin_pct`) and Paul's rule: its growth must be very rapid (`valuation.hypergrowth_min_rev_growth_pct`) or the story
  says so. The sentence is in every thesis summary (`summary_parts` recap), every stock section, the idea page, the evaluate page, the MCP
  `evaluate` / `ideas_latest` answers and the home tile. The G4 speculation gate still uses the P/E-as-required-CAGR proxy; switching it
  to this figure is Paul's call (D-25).

## The product lens — Mars & Co and BCG playbooks for any company that sells a product (2026-10-01)

Two consulting decks Paul supplied set the frame: Mars & Co's GM aftermarket roadmap (growth as a bridge — a *baseline* from the
installed base and current commitments by region, quantified headwinds and tailwinds, *reach* growth that needs investment and arrives
at lower margin; pressure up and down the value chain; defence and offence per channel) and BCG's Project Tiger for Nestlé Japan (the
quality of a sale — trade spend and the fictitious gap between list and realised price, forward buying and month-end volume push that
show up as channel inventory and receivables, account-level profit). The engine now reads every product company through them.

- **Regions and channels from the filings** (`research/segments.py`): the segment note of each 10-K read from the XBRL instance (EDGAR's
  companyfacts drops dimensioned facts), member vocabulary discovered per filer (`segment_members`), regions on the segment/subsegment/
  geographic axes with parent brands and reconciling items excluded, channels from the us-gaap sales-channel axis (direct vs wholesale);
  each fiscal year taken from the latest filing that reports it. Live layer, cached by filing. Nike: FY2009–FY2026, five regions, two channels.
- **The growth bridge** (`frameworks/product_lens.py::region_bridge`): per region revenue, share, last year's growth, 3-year CAGR, EBIT margin
  and its change, contribution to last year's growth, a label (engine / steady / stalled / shrinking / recovering); baseline growth = the
  share-weighted trend of the regions. `channel_mix`: direct share and its shift (push to pull). `baseline_vs_required`: the price's implied
  growth (F-16) against the baseline — the gap is reach growth, lower margin, investment first.
- **Is the growth real?** (`sales_quality`): inventory days and receivable days against revenue growth (forward buying and channel loading),
  gross margin against three years ago (price realization). `price_language`: full-price vs promotional language in the last two calls, from
  two new lexical categories (`full_price`, `promo_push` in `text/lexical.py`, factor `text_full_price`).
- **The value chain, read by Claude** (`ValueChainRead`): suppliers and inputs, channel partners, the consumer, entrants and counterfeit, what
  carries the baseline, what reach would need, defence and offence, a verdict and a pressure score; every figure in a ledger and traced.
- **On the page**: a "Through the product lens" block inside every stock story (regions chart: revenue stacked and EBIT margin by region; the
  bridge table; the sales-quality line), and the stock pitch is asked to say which regions carry the growth, whether the sales look earned or
  pushed, and whether the price asks more than the regions deliver. Applies when `sells_product()` is true (consumer, industrial, hardware,
  materials, energy, healthcare products; never banks, REITs, software, media, services).

## Backtest evidence so far (US, 2016-03-31 → 2024-09-30, top 20, cap-floor universe with delisted and acquired names)
- **Cycle-rule exits + Kelly weights, five AI layers, per-sector angle weights, share-count and ADR fixes** (run 4, 2026-09-30): 22 cohorts closed
  under the cycle rule (formations to 2021; later cohorts still hold open positions marked at the last close), mean hold 3.6 years, mean cohort
  return **+73.4%** equal weight / **+74.2%** Kelly, **+9.9 pp vs SPY** over the same windows (59% of cohorts beat) and **+21 pp vs the
  equal-weight S&P**. Like-for-like on the same 22 cohorts the fixed 24-month hold gives +4.9 pp and the fixed 36-month hold +4.5 pp, so the
  cycle rule adds about 5 pp per cohort: it let 35 of 57 sector-cohorts run to the 60-month ceiling and cut the rest when the sector call reversed
  (2020-09, 2021-06, 2022-06, 2023-03) or the theme faded (tariffs, 2025-03). Kelly vs equal weight is a wash on the mean (Kelly beats equal weight
  in 55% of cohorts, 95% invested); its value is concentration discipline, not return. Overlapping portfolio 2017→2026 (exited proceeds tracking the
  index until the cohort's last exit): **CAGR 14.9% vs SPY 15.1%**, beta 1.04, max drawdown 37% vs 34%, ahead in 2020 and 2023, behind in 2025.
  Rank-IC over the cycle horizon: **quality 0.09 (t 4.4)**, Idea Strength 0.07 (t 4.0); story and moat ≈ 0.
- **Sector-first with text and theme factors** (run 3): 34 cohorts, mean 2-year cohort return **+32.6%** vs SPY +32.4% (excess +0.2 pp; 50% of
  cohorts beat) and vs the equal-weight S&P **+7.6 pp** (74% of cohorts beat); vs each pick's **own theme sector +5.0 pp** (47% of picks beat their
  sector). Brinson: **allocation +2.5 pp** (the sector calls) and **selection +5.0 pp** (the names) per cohort. Idea Strength rank-IC 0.058 (t 3.6);
  quality still the strongest angle (t 3.5). `evidence_tilt` reaches +34.5% (+2.1 pp vs SPY, 56% of cohorts). Inside the AI layers the picks lagged
  their sector (chips +37% vs +55%): the on-sale angle pulls toward the cheapest names where the leaders won — hence per-sector angle weights.
- Numeric factors only, no sector stage (run 2): 34 complete cohorts, mean 2-year cohort return **+30.4%** vs SPY total return +32.4%
  (excess −2.0 pp; 47% of cohorts beat) and vs the **equal-weight S&P (RSP) +25.0%** (excess **+5.4 pp**; 62% of cohorts beat) — the fair
  comparison for an equal-weight 20-name book. Overlapping 8-sleeve portfolio 2018→2026: CAGR 11.0% vs SPY 14.4%; beta 0.98; max drawdown 36% vs 34%.
- Which angles predicted 2-year returns (Spearman rank-IC over ~1,200 eligible names per date, Newey–West t): **quality IC 0.09 (t 3.6)**,
  **fundamental momentum 0.05 (t 2.1)**, Idea Strength 0.05 (t 2.9); moat, on-sale and story ≈ 0; asymmetry and portfolio-fit negative.
  The `evidence_tilt` preset built from this (quality 35%, momentum 20%) lifts the mean cohort to +32.2% (53% of cohorts beat SPY) — a D-27
  sensitivity variant, not a replacement for Paul's weights.
- Lesson consistent with the philosophy: cheapness on its own (own-band P/E, PEG) did not predict; quality of earnings and the direction of
  fundamentals did. The text layer (calls and filings) is the next signal added to the cache.

## Evidence and auditability
- ✅ Every reason carries rule id, metric, value, period, source, threshold and **threshold status** (stated / hypothesis / TBD).
- ✅ **Unresolved decisions** panel (D-IDs) on every page; the backtest sensitivity grid is the evidence for D-27/D-08/D-25.
- ✅ Point-in-time discipline with a look-ahead unit test and a PIT audit command.
- ✅ Replay tests for the spec §8.9 cases (ORCL balance sheet, APP small miss, memory at peak margins, yield trap).
- ☐ Hypothesis ledger with miss classes (priced-in / wrong driver / wrong timing, F-118) filled from backtest cohorts.

## Charts and explanation
- ✅ Chart on every output: price, TTM P/E own-history band, EPS step line, drawdown shading, event markers, phase labels;
  backtest cohort pages show entry/exit windows against SPY.
- ✅ Drivers of past moves: zigzag phases, EPS-vs-multiple shares, attached events (earnings, 8-K, insiders, Federal
  Register, macro episodes), `unexplained` flag (F-105).
- ✅ Narrative layer (`ANTHROPIC_API_KEY`; `engine research SYM` narrates one name scored within its region): three questions, 主役企業 check, toll-booth scorecard, four lenses,
  点検材料 with TBD thresholds, "the tension"; uncited numbers are marked (unverified).
- ☐ Phase narration on the drivers page (`engine drivers SYM --narrate`).

## Macro and context (ALERT-only)
- ✅ Macro strip on every board/idea/cohort: 10Y UST (flag > 4.5%), 10Y real, breakeven, 3M T-bill hurdle, CPI, core CPI, USDJPY, WTI.
- ✅ Macro dashboard with spec §6.2 lines; Federal Register policy documents; Timmer X threads (6-month backfill, 372 threads, Claude-tagged: market relevant / themes / tickers / chart descriptions); inbox notes.
- ✅ **Theme diffusion tracker** (`engine text themes`, F-39 / R-23 / §6.4): every earnings call since 2015 is scanned for the themes in
  `config/themes.yaml` (AI compute, memory/HBM, data-center power, nuclear, GLP-1, reshoring, cybersecurity, cloud, EV, tariffs, crypto,
  refinancing, agentic AI); per theme × quarter: share of calls mentioning it, sectors, first-time mentioners — so the dashboard shows when a
  theme spreads beyond its origin sector (AI beyond Nvidia and semis). Emerging terms are found without a lexicon (bigrams whose document
  frequency jumps ≥3× vs the prior year on a per-quarter sample). Timmer's tagged X threads are mapped onto the same buckets week by week and
  his latest take sits beside each expanding theme. Exposure to expanding themes and first-mention status feed the story angle (SOFT, point-in-time).
- ☐ Premise register (§6.4) with confirming/refuting evidence links from X threads and notes.
- ☐ MOVE index (not on FRED) and breadth (RSP/SPY) panels.

## Workflows (spec §8.8)
- ☐ W3 earnings checkpoint, ☐ W4 drawdown protocol, ☐ W6 premise review, ☐ W7 portfolio health, ☐ M8 decisions dashboard
  (see `docs/BUILD_PROMPTS.md`).
