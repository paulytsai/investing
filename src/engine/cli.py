"""`engine` command line."""
from __future__ import annotations

import typer

app = typer.Typer(no_args_is_help=True, add_completion=False, help="Paul Tsai investment engine (decision support).")
config_app = typer.Typer(no_args_is_help=True, help="Configuration checks.")
pull_app = typer.Typer(no_args_is_help=True, help="Pull raw data into data/raw.")
build_app = typer.Typer(no_args_is_help=True, help="Normalize raw data into point-in-time tables.")
inbox_app = typer.Typer(no_args_is_help=True, help="Macro insight inbox (Timmer WAAR etc.).")
x_app = typer.Typer(no_args_is_help=True, help="X (Twitter) source: @TimmerFidelity posts and threads.")
text_app = typer.Typer(no_args_is_help=True, help="Text layer: transcripts and filing text as idea-sourcing signals.")
app.add_typer(config_app, name="config")
app.add_typer(pull_app, name="pull")
app.add_typer(build_app, name="build")
app.add_typer(inbox_app, name="inbox")
app.add_typer(x_app, name="x")
app.add_typer(text_app, name="text")


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
            symbols: str = typer.Option("", help="symbols instead of the universe: tickers, or a CSV/TXT/XLSX file of codes"),
            workers: int = typer.Option(8), bulk: bool = typer.Option(True, help="use bulk CSV endpoints"),
            refresh_bulk: bool = typer.Option(True, help="re-run the bulk CSV loop (cached files are reused)"),
            shard: str = typer.Option("", help="i/n: pull every n-th symbol from i (run n processes; set ENGINE_RPS_SCALE=1/n)")) -> None:
    """Pull US raw data (FMP + EDGAR + FRED) into data/raw."""
    from .pit.pull_us import pull_us as _pull

    from .symbols import read_symbols

    syms = read_symbols(symbols) or None
    sh = tuple(int(x) for x in shard.split("/")) if shard else None
    _pull(pilot=pilot, symbols=syms, workers=workers, bulk=bulk, refresh_bulk=refresh_bulk, shard=sh)


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
          preset: str = typer.Option(None), narrate: bool = typer.Option(False), symbols: str = typer.Option("", help="tickers or a CSV/TXT/XLSX file of codes")) -> None:
    """Rank ideas and write the board + idea pages under reports/ideas/<run>/."""
    from .screen.run import run_ideas

    from .symbols import read_symbols

    syms = read_symbols(symbols) or None
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

    region = "jp" if symbol.isdigit() else "us"
    r = run_ideas(as_of=as_of, top=20, regions=[region], preset=None, narrate=True, narrate_symbols=[symbol.upper()], quiet=True)
    if r:
        typer.echo(f"[research] {symbol.upper()} → {r['path'] / 'ideas' / (symbol.upper() + '.html')}")


data_app = typer.Typer(help="Share the derived data (PIT tables, caches) between sessions: pack/unpack a tarball, push/pull it to a bucket.")
app.add_typer(data_app, name="data")


@data_app.command("pack")
def data_pack(out: str = typer.Option(None), raw: bool = typer.Option(False, help="include data/raw (7+ GB)")) -> None:
    from .data_sync import pack

    pack(out, include_raw=raw)


@data_app.command("unpack")
def data_unpack(archive: str, overwrite: bool = typer.Option(False)) -> None:
    from .data_sync import unpack

    unpack(archive, overwrite=overwrite)


@data_app.command("push")
def data_push(archive: str = typer.Option(None), key: str = typer.Option("engine-data-latest.tar.gz"), raw: bool = typer.Option(False)) -> None:
    """Upload a snapshot to s3://$ENGINE_DATA_BUCKET/KEY (credentials from the environment only)."""
    from .data_sync import push

    push(archive, key=key, include_raw=raw)


@data_app.command("pull")
def data_pull(key: str = typer.Option("engine-data-latest.tar.gz"), overwrite: bool = typer.Option(False)) -> None:
    """Download a snapshot from the bucket and restore it into data/."""
    from .data_sync import pull

    pull(key=key, overwrite=overwrite)


@app.command("evaluate")
def evaluate(symbols: list[str] = typer.Argument(..., help="tickers to evaluate, and/or CSV/TXT/XLSX files of codes (a symbol/ticker/code column, else the first column)"), thesis: str = typer.Option(None, help="Paul's thesis: text, or a markdown file with '## SYM' sections"),
             as_of: str = typer.Option(None), region: str = typer.Option("auto", help="us | jp | auto (4-digit codes are Japanese)"), narrate: bool = typer.Option(False, help="thesis verdict + narrative pages (Claude)"),
             universe: str = typer.Option("latest", help="latest = reuse the last full screen of the date; full = re-score the universe"),
             top: int = typer.Option(20)) -> None:
    """Evaluate Paul's own ideas with the same engine: placement in the scored universe, sector view and bet, gates, Kelly size,
    and (with --narrate) a claim-by-claim verdict on his thesis."""
    from .evaluate.run import run_evaluate
    from .symbols import read_symbols, split_regions

    syms = read_symbols(symbols)
    if not syms:
        typer.echo("no symbols found (pass tickers or a file with a symbol/ticker/code column)")
        raise typer.Exit(1)
    by_region = split_regions(syms) if region == "auto" else {region.upper(): syms}
    for reg, ss in by_region.items():
        typer.echo(f"[evaluate] {len(ss)} {reg} names: {' '.join(ss[:15])}{' …' if len(ss) > 15 else ''}")
        run_evaluate(ss, thesis=thesis, as_of=as_of, region=reg, narrate=narrate, universe=universe, top=top)


@app.command("backtest")
def backtest(start: str = typer.Option("2016-03-31"), end: str = typer.Option("2024-09-30"), hold: int = typer.Option(24),
             top: int = typer.Option(20), region: str = typer.Option("us"), preset: str = typer.Option(None),
             sensitivity: bool = typer.Option(False), universe: str = typer.Option(None, help="cap_floor|sp500_pit"),
             exit_rule: str = typer.Option(None, help="cycle (hold until the theme-sector cycle is judged over) | fixed (HOLD months)")) -> None:
    """Quarterly overlapping cohorts, TOP names per cohort, exits by the cycle rule (default) or a fixed HOLD; equal-weight
    and Kelly-weighted results side by side."""
    from .backtest.run import run_backtest

    run_backtest(start=start, end=end, hold_months=hold, top=top, region=region, preset=preset,
                 sensitivity=sensitivity, universe_kind=universe, exit_rule=exit_rule)


@app.command("macro")
def macro() -> None:
    """Render the macro dashboard (FRED lines + inbox notes + premise register)."""
    from .inbox.dashboard import render_macro

    render_macro()


@inbox_app.command("pull")
def inbox_pull(label: str = typer.Option("WAAR"), since: str = typer.Option(None)) -> None:
    from .inbox.pull import pull_inbox

    pull_inbox(label=label, since=since)


@inbox_app.command("regulatory")
def inbox_regulatory() -> None:
    """Pull Federal Register documents for the configured searches into the events table."""
    from .inbox.regulatory import pull_regulatory

    pull_regulatory()


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
def x_classify(limit: int = typer.Option(400), workers: int = typer.Option(4)) -> None:
    """Tag threads (market relevant / personal, asset classes, sectors, themes, tickers, chart descriptions) with the Claude layer."""
    from .inbox.x_classify import classify_threads

    classify_threads(limit=limit, workers=workers)


@x_app.command("summary")
def x_summary() -> None:
    import json as _json

    from .pit.pull_x import summary

    typer.echo(_json.dumps(summary(), indent=1, default=str))


@text_app.command("pull")
def text_pull(symbols: str = typer.Option(""), since_year: int = typer.Option(2015), workers: int = typer.Option(4),
              cap_mult: float = typer.Option(1.0, help="names whose market cap ever reached cap_mult × the cap floor")) -> None:
    """Pull every transcript since SINCE_YEAR and the latest 10-K/10-Q items for the cohort-relevant universe."""
    from .text.pull import pull_text

    from .symbols import read_symbols

    syms = read_symbols(symbols) or None
    pull_text(symbols=syms, since_year=since_year, workers=workers, min_cap_mult=cap_mult)


@text_app.command("build")
def text_build() -> None:
    """Lexical tier: extract dated signals from every stored document → text_signals (point-in-time)."""
    from .text.build import build_text_signals

    build_text_signals()


@text_app.command("themes")
def text_themes(workers: int = typer.Option(3)) -> None:
    """Theme diffusion tracker: theme mentions per call (point-in-time), breadth by quarter, new entrants, emerging terms, Timmer's weekly themes."""
    from .text.themes import build_themes

    build_themes(workers=workers)


@text_app.command("read")
def text_read(limit: int = typer.Option(300, help="names to read, by latest screen rank"), model: str = typer.Option("claude-sonnet-5-5"),
              max_usd: float = typer.Option(60.0), symbols: str = typer.Option("")) -> None:
    """Claude tier: structured TextRead per name from its latest call and filings (live-only factors)."""
    import glob
    import json as _json

    from .config import REPORTS_DIR
    from .store import read_df
    from .text.read import read_names

    if symbols:
        m = read_df("security_master", "region = 'US'")
        want = {x.strip().upper() for x in symbols.split(",") if x.strip()}
        pairs = [(r.security_id, r.symbol) for r in m.itertuples(index=False) if r.symbol in want]
    else:
        import os

        runs = sorted(glob.glob(str(REPORTS_DIR / "ideas" / "*" / "candidates.json")), key=os.path.getmtime)
        runs = [r for r in runs if os.path.getsize(r) > 2_000_000] or runs     # the latest full-universe screen, not a one-name research run
        if not runs:
            typer.echo("no ideas run yet; pass --symbols or run `engine ideas` first")
            raise typer.Exit(1)
        typer.echo(f"[text read] ranking from {runs[-1]}")
        cands = _json.load(open(runs[-1]))
        ranked = sorted([c for c in cands if c.get("rank") and c.get("region") == "US"], key=lambda c: c["rank"])[:limit]
        pairs = [(c["security_id"], c["symbol"]) for c in ranked]
    read_names(pairs, model=model, max_usd=max_usd)


@app.command("serve")
def serve(port: int = typer.Option(8000)) -> None:
    """Serve reports/ locally."""
    import uvicorn

    uvicorn.run("engine.serve:app", host="127.0.0.1", port=port, reload=False)


if __name__ == "__main__":
    app()
