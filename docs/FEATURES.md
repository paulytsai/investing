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
  name each. Answers "is my idea good, and how big?" Both programs call the same functions; a fix lands once.
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

## Backtest evidence so far (US, 2016-03-31 → 2024-09-30, top 20, 24-month hold, cap-floor universe with delisted and acquired names)
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
