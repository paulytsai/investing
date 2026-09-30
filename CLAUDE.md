# Paul Tsai Investment Engine — standing instructions

Decision support for Paul's own investing, built from `reference/PAUL_TSAI_INVESTMENT_ENGINE_SPEC.md`
(split into `docs/00_OVERVIEW.md … 11_glossary.md`). It ranks ideas, explains why, charts every name,
explains past price moves, and backtests the picker. It **never places orders and never publishes**.
Newsletter/reader constraints (INV-6, C-rules) are out of scope: this app states a view for Paul.

## Invariants (spec §0.5) that bind the code
- INV-2: every idea carries a thesis record (deterministic reasons always; LLM narrative when enabled).
- INV-3: no price-only trigger produces a buy. A drawdown scores only when the F-12 decomposition shows the
  multiple fell while earnings held.
- INV-5: `TBD(Paul)` never becomes a silent default. Numeric stand-ins live **only** in `config/hypotheses.yaml`,
  each tagged with its D-ID; every output lists the D-IDs whose hypothesis values touched it.
- Every fundamental fact carries `available_from` and is read through `engine.pit.snapshot()`; never query
  `fundamentals_long` directly from screen/backtest code.
- Every `ReasonComponent` carries `rule_id`, `period_end`, `source`, `threshold_status`.
- The LLM never runs inside the backtest loop; its calls are cached by request hash; tests use the frozen
  fixture cache only.

## Secrets and network
- Keys come from environment variables only (`FMP_API_KEY, ALPACA_API_KEY, ALPACA_SECRET_KEY, JQUANTS_API_KEY,
  EDINET_API_KEY, FRED_API_KEY, ANTHROPIC_API_KEY`), loaded by `engine.config` (a local `.env` is gitignored).
  Never write a key into code, config, tests, fixtures, docs or reports.
- `engine/connectors/http.py` is the only HTTP client. Its host allowlist contains data hosts only; adding a
  host means editing the allowlist. No broker or trading host, ever.
- `data/` (raw pulls, parquet, caches) and `reports/` are gitignored. Raw pulls are immutable; re-normalize,
  never re-fetch.

## How to run
```
pip install -e ".[dev]"
engine test-keys                 # every source authenticates
engine config check              # unresolved TBD(Paul) decisions (D-IDs)
engine pull us --pilot           # 60-name pilot; engine pull us for the full universe
engine build pit                 # normalize raw → point-in-time tables (includes the commodity-cycle aggregates; `engine build commodity` alone)
engine ideas --as-of 2026-09-26 --top 20 --region us
engine drivers NVDA
engine evaluate NVDA ORCL --thesis thesis.md --narrate   # second front-end: Paul's own ideas, placed in the same scored universe
engine data pack | push | pull                           # derived tables to/from $ENGINE_DATA_BUCKET (keys from env; boto3 is storage transport, not a data source)
engine backtest --start 2016-03-31 --end 2024-09-30 --top 20   # cycle-rule exits (D-24) and Kelly weights (D-01); --exit-rule fixed --hold 24
engine serve                     # browse reports/ at http://127.0.0.1:8000; evaluator page at /evaluate
engine mcp                       # the engine as MCP tools for Claude Desktop / Claude Code (evaluate, ideas_latest, sector_view, size, drivers)
pytest -q
```

## Two front-ends, one engine
- `engine ideas` (sourcing, whole universe) and `engine evaluate` (Paul's names) share every function in `screen/`, `sectors`, `text/`,
  `frameworks/`, `research/`, `backtest/sizing`. New logic goes in the library, never in a front-end; a front-end only decides which
  names, which question and which page.

## Conventions
- Python 3.11, pydantic v2 for every artifact, pure functions with tests in `engine/frameworks/`.
- `ruff` clean. Charts only through `engine/reports/charts.py::build_price_chart` (load the `dataviz` skill
  before chart work). Templates in `engine/reports/templates/`.
- Spec IDs (R-, X-, F-, D-, INV-, G1–G6) are cited in code comments and in every reason shown to Paul.
- Returns are always shown as CAGR **and** simple annualized, labelled (spec §5.4).
