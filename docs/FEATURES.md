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
- ☐ Receipts ratio (F-40) from XBRL RPO for AI sellers; AI three dials (F-45) from transcripts.
- ☐ 13F "informed holders added" (F-111), SOFT only.
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
- ✅ Narrative layer (needs `ANTHROPIC_API_KEY`): three questions, 主役企業 check, toll-booth scorecard, four lenses,
  点検材料 with TBD thresholds, "the tension"; uncited numbers are marked (unverified).
- ☐ Phase narration on the drivers page (`engine drivers SYM --narrate`).

## Macro and context (ALERT-only)
- ✅ Macro strip on every board/idea/cohort: 10Y UST (flag > 4.5%), 10Y real, breakeven, 3M T-bill hurdle, CPI, core CPI, USDJPY, WTI.
- ✅ Macro dashboard with spec §6.2 lines; Federal Register policy documents; Timmer X threads; inbox notes.
- ☐ Premise register (§6.4) with confirming/refuting evidence links from X threads and notes.
- ☐ MOVE index (not on FRED) and breadth (RSP/SPY) panels.

## Workflows (spec §8.8)
- ☐ W3 earnings checkpoint, ☐ W4 drawdown protocol, ☐ W6 premise review, ☐ W7 portfolio health, ☐ M8 decisions dashboard
  (see `docs/BUILD_PROMPTS.md`).
