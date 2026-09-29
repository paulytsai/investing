# Build prompts — how this engine was built, and how to extend it in Claude Code

Each prompt below is self-contained: paste it into a Claude Code session on this repo. They follow the spec's build
plan (§8.11) as adapted in the approved plan. M0–M6 are done in this repo; the "next" prompts continue the spec's
workflows (W3, W4, W6, W7, M8).

## Standing preamble (prepend to every prompt)
> Read `CLAUDE.md` first. The spec is `reference/PAUL_TSAI_INVESTMENT_ENGINE_SPEC.md` (split into `docs/00…11`).
> Invariants: every fundamental fact is read through `engine.pit.snapshot()` (point-in-time, first-filed wins);
> every reason shown to Paul cites a spec rule id, period and source; `TBD(Paul)` values only ever come from
> `config/hypotheses.yaml` and are listed on every output; the LLM never runs inside the backtest; keys come from the
> environment only; the engine never places orders. Run `pytest -q` before you commit.

## M0 — Scaffold (done)
> Create the repo layout from the plan: `pyproject.toml`, `CLAUDE.md`, `.gitignore`, `.env.example`, `config/philosophy.yaml`
> extracted verbatim from spec §9.4, `config/hypotheses.yaml` (labelled stand-ins for TBD(Paul) with D-IDs),
> `config/holdings.yaml` from §5.1, `rules/screen.yaml` mapping X-/G-/F- rules to data tests, `src/engine/store.py`
> with the table schemas, `connectors/http.py` with a data-host allowlist, `engine test-keys` and `engine config check`.
> Then run the five data risk checks (bulk CSV coverage, delisted coverage, filingDate vs EDGAR first-filed, J-Quants
> small-cap depth + EDINET earliest date, XBRL RPO coverage) and record results in `docs/DATA_SOURCES.md`.

## M1 — Point-in-time data (done)
> Implement `engine pull us [--pilot]` (FMP bulk statements + per-symbol prices/market cap/earnings/insiders/filings,
> EDGAR submissions, FRED) and `engine build pit` producing `security_master`, `universe_membership`, `fundamentals_long`
> (`available_from` = next trading day after `filingDate`; bulk rows with filingDate == period end are lag-imputed),
> `prices_daily` (`close_adj` split-adjusted — FMP close already is; `close_tr` dividend-adjusted), `market_cap_daily`,
> `events`, `benchmark_daily`, `macro_daily`. Write `snapshot()` (first-filed wins, TTM from 4 quarters, Q4 synthesis,
> staleness) and `tests/unit/test_no_lookahead.py`. Verify with `engine build audit NVDA 2020-06-30`.

## M2 — Screen, Idea Strength, charts (done)
> Implement `engine ideas`: universe → snapshots → metrics (`screen/metrics.py`) → HARD exclusions and gates G1–G6
> from `rules/screen.yaml` → eight angle sub-scores (winsorized region-wide z-scores → percentiles) → Idea Strength
> with preset weights from hypotheses → proposed action {buy-in-stages, watch, pass} → board (sortable by any angle)
> and per-idea pages with the 10-year chart (price, TTM P/E band, EPS, drawdown shading, events) built only through
> `reports/charts.py::build_price_chart`. Load the `dataviz` skill before chart work.

## M2b — DCF and macro (done)
> Add `frameworks/dcf.py`: scenario DCF (bear/base/bull, Gordon and exit-multiple terminal, sensitivity grid), reverse
> DCF (growth the price implies) → `implied_growth_gap` factor and the F-18 hurdle vs the point-in-time 10-year UST.
> Add the macro dashboard (`engine macro`): 10Y/3M, real/breakeven, curve, CPI, oil, USDJPY, VIX/HY with spec §6.2
> lines; Federal Register regulatory documents (`engine inbox regulatory`); inbox notes; X threads.

## M3 — Drivers of past moves (done)
> Implement `drivers/phases.py`: ±20% zigzag on weekly closes (min 4 weeks, merge short phases), per phase
> Δln P = Δln EPS + Δln P/E with the EPS visible at each pivot, events attached from the events table and
> `config/macro_episodes.yaml`, labels macro / earnings_led / multiple_led / event / mixed, `unexplained` flag (F-105),
> hindsight shock type (never a signal). `engine drivers NVDA` renders the page; idea pages get the phase overlay.

## M4 — Backtest (done)
> Implement `engine backtest`: quarter-end formation dates, PIT candidate cache per date, top-N with a sector cap,
> entry = first trading day after formation, exit = last trading day within the hold, total-return closes, delisted
> handling, SPY total return over the same windows, cohort stats (CAGR and simple side by side, batting average),
> 8-sleeve overlapping equity curve, Spearman rank-IC per angle with Newey–West t, sensitivity over presets/top-N/sector
> cap, HTML report + cohort pages with each pick's chart and frozen reasons.

## M5 — Narratives (done; needs ANTHROPIC_API_KEY)
> Implement `research/`: `messages.parse` on `claude-opus-5-5` with pydantic schemas (ThesisRecord v0, MoatLite,
> LensVerdicts, Checkpoints with TBD thresholds, PhaseExplanations), context from FinancialRead + 10-K Items 1/1A/7 +
> 10-Q MD&A + latest transcript, citation verification (`(unverified)` on uncited numbers), request-hash cache, cost cap.
> `engine ideas --narrate` and `engine research SYMBOL`.

## X source — @TimmerFidelity (done)
> Add `connectors/x.py` (credential attached by the environment proxy; no key in code), `config/x_sources.yaml`
> (user_id resolved once, lookback_days 183, max_posts_per_run 1500), `pit/pull_x.py` (backfill with start_time then
> since_id; exclude retweets; keep only self-replies; group by conversation_id; media download; cost log; first page only
> until confirmed), tables `x_posts`/`x_threads`, `engine x classify` (market relevant / personal, asset classes, sectors,
> themes, tickers, chart descriptions), `engine x summary`, offline tests with saved sample responses.

## Next prompts (not yet built)

### Full-universe runs
> After `engine pull us` completes: `engine build pit`, `engine ideas --as-of <last Friday> --top 20`, then
> `engine backtest --start 2016-03-31 --end 2024-09-30 --hold 24 --top 20 --sensitivity`. Compare `universe.kind: sp500_pit`
> vs `cap_floor`. Publish the board and the backtest report as Artifacts.

### W3 — Earnings checkpoint workflow
> For every name in `config/holdings.yaml` and every current buy/watch idea, build the pre-earnings checklist (点検材料
> with bull/bear readings from the ThesisRecord) 7 days before the FMP earnings date, and the post-earnings audit
> (R-42): actual vs estimate, guidance, the thesis KPI; apply the R-44 suppression list; propose the `thesis_status`
> transition with the rule ids. Output: `reports/checkpoints/<date>/index.html` and an ALERT list.

### W4 — Drawdown protocol
> When a holding or idea falls ≥ `thresholds.drawdown_research_trigger_pct` from its 3-year high (hypothesis D-22),
> generate the research task: F-12 decomposition, the three-question triage (R-54), the five-axis classification (R-28),
> and — only if the thesis is intact — a staged-add proposal with R-30 tranches. Never a buy on price alone (INV-3).

### W7 — Portfolio health
> Monthly: barbell sleeve weights and tilt (R-77, hypothesis bands), concentration alerts (R-49/R-91), weeds (R-58),
> opportunity cost vs hurdle (R-59), ETF look-through (R-73) using `etf/holdings`, survival check inputs (INV-4, needs
> D-01/D-04 → ALERT). Output a health page and ALERTs; every proposal carries its encoding and rule ids.

### 13F corroboration and transcript signals
> Pull `institutional-ownership/extract` quarterly for `config/informed_investors.yaml` (resolve CIKs first) into the
> `thirteenf` table; add an "informed holders added" component to the alignment angle (SOFT only, R-22). Add
> `research/transcripts.py`: deterministic transcript signals (backlog/RPO growth, "sold out"/utilization, price hikes
> sticking, customer concentration, guidance raised/cut) stored as events, and the AI three dials (F-45) per name.

### Japan
> `engine pull jp` (full Prime+Standard), `engine build pit --region jp`, `engine ideas --region jp`, and the JP backtest
> from 2017-12-31 (price return vs TOPIX, JPY and USD). Add EDINET officer/major-shareholder parsing for G1/G2 in Japan.

### M8 — Decisions dashboard
> Build `engine decisions`: the §10.15 Top-15 as a form; each answered D-ID rewrites the value in
> `config/philosophy.yaml` (with a `ConfigVersion` record), removes it from `hypotheses.yaml`, and re-runs the
> backtest so the share of outputs touched by hypotheses falls over time.
