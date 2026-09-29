"""`engine drivers SYMBOL`: phases + attribution + chart with annotations."""
from __future__ import annotations

import json
from datetime import datetime

import pandas as pd

from ..config import REPORTS_DIR, Hypotheses
from ..pit.snapshot import price_history, snapshot, symbol_to_sid
from ..reports import render
from ..reports.charts import build_price_chart, to_json
from ..store import has_table, read_df
from .phases import build_phases, phases_to_dicts


def compute_phases(security_id: str, as_of=None, region: str = "US") -> tuple[list[dict], pd.DataFrame, pd.Series, pd.DataFrame]:
    hyp = Hypotheses.load()
    as_of = pd.Timestamp(as_of) if as_of else pd.Timestamp.today()
    px = price_history(security_id, end=as_of)
    snap = snapshot(security_id, as_of)
    eps = snap.eps_ttm_series()
    b = read_df("benchmark_daily", "benchmark_id = 'SPY_TR'" if region == "US" else "benchmark_id = 'TOPIX_PR'")
    b["date"] = pd.to_datetime(b["date"])
    bench = b.set_index("date")["level"].sort_index()
    ev = read_df("events", f"(security_id = '{security_id}' OR security_id = 'MACRO') AND event_date <= DATE '{as_of.date()}'") if has_table("events") else pd.DataFrame()
    ph = build_phases(px, eps, bench, ev, float(hyp.get("drivers.zigzag_threshold_pct")), int(hyp.get("drivers.min_phase_weeks")), float(hyp.get("drivers.macro_bench_move_pct")))
    return phases_to_dicts(ph), px, eps, ev


def run_drivers(symbol: str, narrate: bool = False, out_dir=None) -> dict:
    sid = symbol_to_sid(symbol)
    if not sid:
        print(f"{symbol}: not in security_master (pull + build first)")
        return {}
    phases, px, eps, ev = compute_phases(sid)
    m = read_df("security_master", f"security_id = '{sid}'").iloc[0]
    start = pd.Timestamp.today() - pd.Timedelta(days=10 * 365)
    spec = build_price_chart(sid, symbol, px, start=start, overlays={"price", "eps", "events", "phases"}, eps_series=eps, events=ev[ev.security_id == sid] if not ev.empty else None,
                             phases=[p for p in phases if pd.Timestamp(p["end"]) >= start], subtitle="last 10 years · phases from a ±20% zigzag on weekly closes (table covers full history)")
    narratives = None
    if narrate:
        from .narrate import narrate_phases

        narratives = narrate_phases(symbol, sid, phases)
    run_id = f"{symbol}_{datetime.now().strftime('%Y-%m-%d_%H%M%S')}"
    out = out_dir or (REPORTS_DIR / "drivers" / run_id)
    out.mkdir(parents=True, exist_ok=True)
    html = render.env().get_template("drivers.html.j2").render(title=f"{symbol} — drivers of past moves", symbol=symbol, name=m["name"], phases=phases,
                                                                chart_id=spec["id"], chart_json=to_json(spec), narratives=narratives, generated=render.now(), assets="../../assets/")
    render.write(out / "index.html", html)
    (out / "phases.json").write_text(json.dumps(phases, default=str, indent=1))
    (out / "run.json").write_text(json.dumps({"as_of": str(pd.Timestamp.today().date()), "title": f"Drivers: {symbol}", "entry": "index.html"}))
    render.update_index()
    print(f"[drivers] {symbol}: {len(phases)} phases → {out / 'index.html'}")
    for p in phases:
        print(f"  {p['start']} → {p['end']} {p['ret_pct']:+6.0f}%  {p['label']:<13} EPS {p['f_eps'] if p['f_eps'] is None else round(p['f_eps'],2)}  "
              f"{'UNEXPLAINED ' if p['unexplained'] else ''}{p['event_summary'][:90]}")
    return {"path": out, "phases": phases}
