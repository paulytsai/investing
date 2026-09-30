# Logic and feature suggestions (checklist)

Built in v1 are marked ✅; proposed next steps ☐. Every item maps to the spec.

## Selection logic
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
- ☐ Premise register (§6.4) with confirming/refuting evidence links from X threads and notes.
- ☐ MOVE index (not on FRED) and breadth (RSP/SPY) panels.

## Workflows (spec §8.8)
- ☐ W3 earnings checkpoint, ☐ W4 drawdown protocol, ☐ W6 premise review, ☐ W7 portfolio health, ☐ M8 decisions dashboard
  (see `docs/BUILD_PROMPTS.md`).
