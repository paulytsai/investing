# Paul Tsai investment engine

Decision support built from `reference/PAUL_TSAI_INVESTMENT_ENGINE_SPEC.md`: ranks stock ideas with rule-cited reasons,
charts every name, explains past moves, and backtests the picker point-in-time. It never places orders or publishes.

```
pip install -e ".[dev]"        # python 3.11
cp .env.example .env           # or set environment secrets
engine test-keys               # FMP, Alpaca data, J-Quants, EDINET, EDGAR, FRED
engine config check            # the 158 TBD(Paul) parameters and their D-IDs
engine pull us --pilot         # 60-name pilot (engine pull us = full universe, ~1h)
engine build pit               # point-in-time tables under data/pit
engine ideas --top 20          # board + idea pages → reports/ideas/<run>/board.html
engine drivers NVDA            # drivers of past moves
engine evaluate NVDA ORCL --thesis thesis.md --narrate   # evaluate Paul's own ideas with the same engine
engine evaluate my_ideas.csv --thesis thesis.md          # …or a CSV/XLSX of codes (symbol/ticker/code column)
engine data pack / push / pull                          # share the derived data with another session
engine backtest --start 2016-03-31 --end 2024-09-30 --top 20 --sensitivity   # cycle-rule exits + Kelly weights; --exit-rule fixed --hold 24 for a fixed hold
engine macro                   # macro dashboard (FRED lines, Federal Register, Timmer on X)
engine x pull --first-page-only   # @TimmerFidelity: one page, report cost; --confirm for the rest
engine serve                   # browse reports/
pytest -q
```

Layout: `config/` (philosophy.yaml from the spec, labelled hypotheses, holdings, sources), `rules/screen.yaml`
(rule → data test map), `src/engine/{connectors,pit,frameworks,screen,drivers,backtest,research,inbox,reports}`,
`tests/{unit,replay,fixtures}`, `docs/` (spec sections, DATA_SOURCES, BUILD_PROMPTS, FEATURES).
