"""Macro dashboard: the user's benchmark numbers (10Y UST, inflation, real rates) with spec §6.2 lines, plus relay-weight
context (Timmer X threads, inbox notes, Federal Register documents). ALERT-only: nothing here moves a score."""
from __future__ import annotations

import json
from datetime import datetime

import pandas as pd

from ..config import REPORTS_DIR
from ..reports import render
from ..reports.charts import build_series_chart, to_json
from ..store import has_table, read_df
from .parse import load_notes

PANELS = [
    {"id": "rates", "title": "10Y UST vs 3M T-bill (I-01 / I-08) — lines at 4.5% and 5%", "ytitle": "%", "series": {"DGS10": "10Y UST", "DTB3": "3M T-bill"}, "lines": [4.5, 5.0]},
    {"id": "real", "title": "Real 10Y and breakeven (I-04) — sustainable regime real 1–2%", "ytitle": "%", "series": {"DFII10": "10Y real (TIPS)", "T10YIE": "10Y breakeven"}, "lines": [1.0, 2.0]},
    {"id": "curve", "title": "Curve 10Y–2Y (I-05)", "ytitle": "pp", "series": {"T10Y2Y": "10Y − 2Y"}, "lines": [0.0]},
    {"id": "inflation", "title": "CPI and core CPI, YoY % (I-10)", "ytitle": "% YoY", "series": {"CPIAUCSL": "CPI YoY", "CPILFESL": "Core CPI YoY"}, "lines": [2.0, 3.0], "yoy": True},
    {"id": "oil", "title": "WTI and Brent (I-43) — $100 line, 3-month persistence rule", "ytitle": "$/bbl", "series": {"DCOILWTICO": "WTI", "DCOILBRENTEU": "Brent"}, "lines": [100.0]},
    {"id": "fx", "title": "USDJPY (I-30) — ¥150 resistance", "ytitle": "¥ per $", "series": {"DEXJPUS": "USDJPY"}, "lines": [150.0]},
    {"id": "stress", "title": "VIX and HY OAS (I-07 / I-53)", "ytitle": "level / %", "series": {"VIXCLS": "VIX", "BAMLH0A0HYM2": "HY OAS %"}, "lines": []},
]


def render_macro(out_dir=None) -> None:
    macro = read_df("macro_daily") if has_table("macro_daily") else pd.DataFrame()
    if macro.empty:
        print("no macro_daily table; run `engine pull us` (FRED) first")
        return
    macro["date"] = pd.to_datetime(macro["date"])
    charts = []
    for p in PANELS:
        series = {}
        for sid, label in p["series"].items():
            s = macro[macro.series_id == sid].set_index("date")["value"].sort_index()
            if s.empty:
                continue
            if p.get("yoy"):
                s = (s / s.shift(12) - 1) * 100
            series[label] = s.dropna()[-260 * 10:]
        if series:
            charts.append(build_series_chart(p["id"], p["title"], series, lines=p["lines"], ytitle=p.get("ytitle", "")))
    strip = render.macro_strip(pd.Timestamp.today())
    threads = read_df("x_threads") if has_table("x_threads") else pd.DataFrame()
    xrows = []
    if not threads.empty:
        for _, r in threads.sort_values("first_at", ascending=False).head(40).iterrows():
            media = json.loads(r["media_urls"]) if isinstance(r["media_urls"], str) else []
            xrows.append({"date": pd.Timestamp(r["first_at"]).date(), "n_posts": int(r["n_posts"]), "text": r["full_text"][:700], "n_media": int(r["n_media"]),
                          "market_relevant": r["market_relevant"], "summary": r["summary"], "themes": json.loads(r["themes"]) if isinstance(r["themes"], str) else [],
                          "tickers": json.loads(r["tickers"]) if isinstance(r["tickers"], str) else [], "status": r["analysis_status"],
                          "charts": json.loads(r["chart_descriptions"]) if isinstance(r["chart_descriptions"], str) else [], "media": media[:4],
                          "url": f"https://x.com/TimmerFidelity/status/{r['first_post_id']}"})
    notes = sorted(load_notes(), key=lambda n: n.get("published_date") or "", reverse=True)[:30]
    reg = read_df("events", "event_type = 'regulatory'") if has_table("events") else pd.DataFrame()
    regrows = []
    if not reg.empty:
        for _, r in reg.sort_values("event_date", ascending=False).head(60).iterrows():
            p = json.loads(r["payload"])
            regrows.append({"date": r["event_date"], "title": p.get("title"), "type": p.get("type"), "agencies": ", ".join(a for a in (p.get("agencies") or []) if a),
                            "themes": ", ".join(p.get("themes") or []), "url": p.get("url"), "significant": p.get("significant")})
    run_id = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    out = out_dir or (REPORTS_DIR / "macro" / run_id)
    out.mkdir(parents=True, exist_ok=True)
    html = render.env().get_template("macro.html.j2").render(
        title="Macro dashboard", strip=strip, charts=[(c["id"], c["title"], to_json(c)) for c in charts], xrows=xrows, notes=notes, regrows=regrows,
        generated=render.now(), assets="../../assets/")
    render.write(out / "index.html", html)
    (out / "run.json").write_text(json.dumps({"as_of": str(pd.Timestamp.today().date()), "title": "Macro dashboard", "entry": "index.html"}))
    render.update_index()
    print(f"[macro] → {out / 'index.html'} ({len(charts)} panels, {len(xrows)} X threads, {len(notes)} notes, {len(regrows)} regulatory docs)")
