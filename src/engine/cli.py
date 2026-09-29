"""`engine` command line."""
from __future__ import annotations

import typer

app = typer.Typer(no_args_is_help=True, add_completion=False, help="Paul Tsai investment engine (decision support).")
config_app = typer.Typer(no_args_is_help=True, help="Configuration checks.")
pull_app = typer.Typer(no_args_is_help=True, help="Pull raw data into data/raw.")
build_app = typer.Typer(no_args_is_help=True, help="Normalize raw data into point-in-time tables.")
inbox_app = typer.Typer(no_args_is_help=True, help="Macro insight inbox (Timmer WAAR etc.).")
x_app = typer.Typer(no_args_is_help=True, help="X (Twitter) source: @TimmerFidelity posts and threads.")
app.add_typer(config_app, name="config")
app.add_typer(pull_app, name="pull")
app.add_typer(build_app, name="build")
app.add_typer(inbox_app, name="inbox")
app.add_typer(x_app, name="x")


@app.command("test-keys")
def test_keys() -> None:
    """Verify that every data source authenticates (read-only calls)."""
    from .config import secret
    from .connectors.alpaca import Alpaca
    from .connectors.edgar import EDGAR
    from .connectors.edinet import EDINET
    from .connectors.fmp import FMP
    from .connectors.fred import FRED
    from .connectors.jquants import JQuants

    checks = [
        ("FMP", lambda: bool(FMP().profile("AAPL"))),
        ("Alpaca data", lambda: bool(Alpaca().bars("AAPL", start="2026-09-20"))),
        ("J-Quants v2", lambda: bool(JQuants().master(code="72030"))),
        ("EDINET", lambda: EDINET().documents("2026-09-25", only_yuho=False) is not None),
        ("EDGAR", lambda: bool(EDGAR().submissions("0000320193").get("cik"))),
        ("FRED", lambda: bool(FRED().observations("DGS10", start="2026-09-01"))),
    ]
    ok_all = True
    for name, fn in checks:
        try:
            ok = fn()
        except Exception as e:  # noqa: BLE001 — report every source
            ok = False
            typer.echo(f"  {name:<12} FAIL  {str(e)[:120]}")
        else:
            typer.echo(f"  {name:<12} {'OK' if ok else 'EMPTY'}")
        ok_all &= bool(ok)
    typer.echo(f"  {'Anthropic':<12} {'key present' if secret('ANTHROPIC_API_KEY') else 'no key (narratives off)'}")
    raise typer.Exit(0 if ok_all else 1)


@config_app.command("check")
def config_check(show: int = typer.Option(200, help="max rows to print")) -> None:
    """List every TBD(Paul) parameter (INV-5) and the D-IDs it depends on; validate hypotheses.yaml."""
    from collections import Counter

    from .config import Hypotheses, philosophy, tbd_entries

    ph = philosophy()
    entries = tbd_entries()
    typer.echo(f"philosophy.yaml: {len(ph)} namespaces, {len(entries)} TBD(Paul) values")
    by_d: Counter[str] = Counter()
    for e in entries[:show]:
        typer.echo(f"  {e.key:<55} {e.value:<18} {' '.join(e.decision_ids)}")
        by_d.update(e.decision_ids)
    typer.echo("\nMost-referenced decisions: " + ", ".join(f"{d}×{n}" for d, n in by_d.most_common(15)))
    hyp = Hypotheses.load()
    preset = hyp.preset()
    s = sum(preset.values())
    typer.echo(f"\nhypotheses.yaml: preset '{hyp.get('screen.preset')}' weights sum to {s:.2f}; decisions touched by defaults: "
               + ", ".join(hyp.decisions_touched()))
    if abs(s - 1.0) > 1e-6:
        raise typer.Exit(2)


@pull_app.command("us")
def pull_us(pilot: bool = typer.Option(False, help="60-name pilot: top-50 by cap + holdings"),
            symbols: str = typer.Option("", help="comma-separated symbols instead of the universe"),
            workers: int = typer.Option(8), bulk: bool = typer.Option(True, help="use bulk CSV endpoints")) -> None:
    """Pull US raw data (FMP + EDGAR + FRED) into data/raw."""
    from .pit.pull_us import pull_us as _pull

    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()] or None
    _pull(pilot=pilot, symbols=syms, workers=workers, bulk=bulk)


@pull_app.command("jp")
def pull_jp(pilot: bool = typer.Option(False), workers: int = typer.Option(4)) -> None:
    """Pull Japan raw data (J-Quants + EDINET)."""
    from .pit.pull_jp import pull_jp as _pull

    _pull(pilot=pilot, workers=workers)


@pull_app.command("status")
def pull_status() -> None:
    from .connectors.http import ledger_status

    for source, endpoint, status, n in ledger_status():
        typer.echo(f"  {source:<8} {endpoint:<45} {status:<6} {n}")


@build_app.command("pit")
def build_pit(region: str = typer.Option("us", help="us|jp|all")) -> None:
    """Normalize raw pulls into point-in-time parquet tables."""
    from .pit.build import build

    build(region)


@build_app.command("audit")
def pit_audit(symbol: str, as_of: str) -> None:
    """Print the facts visible for SYMBOL on AS_OF (look-ahead audit)."""
    from .pit.snapshot import audit

    audit(symbol, as_of)


@app.command("ideas")
def ideas(as_of: str = typer.Option(None), top: int = typer.Option(20), region: str = typer.Option("us"),
          preset: str = typer.Option(None), narrate: bool = typer.Option(False), symbols: str = typer.Option("")) -> None:
    """Rank ideas and write the board + idea pages under reports/ideas/<run>/."""
    from .screen.run import run_ideas

    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()] or None
    run_ideas(as_of=as_of, top=top, regions=region.split(","), preset=preset, narrate=narrate, symbols=syms)


@app.command("drivers")
def drivers(symbol: str, narrate: bool = typer.Option(False)) -> None:
    """Explain the drivers of SYMBOL's past price moves."""
    from .drivers.run import run_drivers

    run_drivers(symbol, narrate=narrate)


@app.command("research")
def research(symbol: str, as_of: str = typer.Option(None)) -> None:
    """Write the full research page (thesis, lenses, phases) for SYMBOL using the Claude narrative layer."""
    from .screen.run import run_ideas

    run_ideas(as_of=as_of, top=1, regions=["us", "jp"], preset=None, narrate=True, symbols=[symbol.upper()])


@app.command("backtest")
def backtest(start: str = typer.Option("2016-03-31"), end: str = typer.Option("2024-09-30"), hold: int = typer.Option(24),
             top: int = typer.Option(20), region: str = typer.Option("us"), preset: str = typer.Option(None),
             sensitivity: bool = typer.Option(False), universe: str = typer.Option(None, help="cap_floor|sp500_pit")) -> None:
    """Quarterly overlapping cohorts, HOLD months each, TOP names per cohort."""
    from .backtest.run import run_backtest

    run_backtest(start=start, end=end, hold_months=hold, top=top, region=region, preset=preset,
                 sensitivity=sensitivity, universe_kind=universe)


@app.command("macro")
def macro() -> None:
    """Render the macro dashboard (FRED lines + inbox notes + premise register)."""
    from .inbox.dashboard import render_macro

    render_macro()


@inbox_app.command("pull")
def inbox_pull(label: str = typer.Option("WAAR"), since: str = typer.Option(None)) -> None:
    from .inbox.pull import pull_inbox

    pull_inbox(label=label, since=since)


@inbox_app.command("parse")
def inbox_parse() -> None:
    from .inbox.parse import parse_inbox

    parse_inbox()


@x_app.command("resolve")
def x_resolve(handle: str = typer.Argument("TimmerFidelity")) -> None:
    """Look up the user id once and save it to config/x_sources.yaml."""
    from .pit.pull_x import resolve

    resolve(handle)


@x_app.command("pull")
def x_pull(handle: str = typer.Option("TimmerFidelity"), first_page_only: bool = typer.Option(False, help="fetch one page, report count and cost, stop"),
           confirm: bool = typer.Option(False, help="proceed with the full backfill")) -> None:
    """Backfill (lookback window) or incremental (since_id) pull; dedupes on post id; logs estimated cost."""
    from .pit.pull_x import pull_x

    pull_x(handle=handle, first_page_only=first_page_only, confirm=confirm)


@x_app.command("classify")
def x_classify(limit: int = typer.Option(200)) -> None:
    """Tag threads (market relevant / personal, asset classes, sectors, themes, tickers, chart descriptions) with the Claude layer."""
    from .inbox.x_classify import classify_threads

    classify_threads(limit=limit)


@x_app.command("summary")
def x_summary() -> None:
    import json as _json

    from .pit.pull_x import summary

    typer.echo(_json.dumps(summary(), indent=1, default=str))


@app.command("serve")
def serve(port: int = typer.Option(8000)) -> None:
    """Serve reports/ locally."""
    import uvicorn

    uvicorn.run("engine.serve:app", host="127.0.0.1", port=port, reload=False)


if __name__ == "__main__":
    app()
