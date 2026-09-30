"""Macro dashboard: the user's benchmark numbers (10Y UST, inflation, real rates) with spec §6.2 lines, plus relay-weight
context (Timmer X threads, inbox notes, Federal Register documents). ALERT-only: nothing here moves a score."""
from __future__ import annotations

import json

import yaml
from datetime import datetime

import pandas as pd

from ..config import CONFIG_DIR, REPORTS_DIR
from ..reports import render
from ..reports.charts import build_series_chart, to_json
from ..text.themes import X_BUCKETS
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
    charts += theme_charts()
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
    themes = theme_tables()
    html = render.env().get_template("macro.html.j2").render(
        title="Macro dashboard", strip=strip, charts=[(c["id"], c["title"], to_json(c)) for c in charts], xrows=xrows, notes=notes, regrows=regrows,
        themes=themes,
        generated=render.now(), assets="../../assets/")
    render.write(out / "index.html", html)
    (out / "run.json").write_text(json.dumps({"as_of": str(pd.Timestamp.today().date()), "title": "Macro dashboard", "entry": "index.html"}))
    render.update_index()
    print(f"[macro] → {out / 'index.html'} ({len(charts)} panels, {len(xrows)} X threads, {len(notes)} notes, {len(regrows)} regulatory docs)")


# --- theme diffusion (transcripts) and Timmer's weekly themes -------------------------------------------------
def _q_end(q: str) -> pd.Timestamp:
    y, n = int(q[:4]), int(q[-1])
    return pd.Timestamp(year=y, month=3 * n, day=1) + pd.offsets.MonthEnd(0)


def theme_charts() -> list[dict]:
    out = []
    if has_table("theme_quarterly"):
        tq = read_df("theme_quarterly")
        tq = tq[tq["n_docs_all"] >= 200]          # quarters with a real sample only (the archive starts in FY2015; earlier stragglers are noise)
        if not tq.empty:
            lex = yaml.safe_load(open(CONFIG_DIR / "themes.yaml", encoding="utf-8"))["themes"]
            latest = tq.sort_values("quarter").groupby("theme").tail(1).sort_values("breadth_pct", ascending=False)
            series = {}
            for theme in latest["theme"].head(8):
                g = tq[tq.theme == theme].sort_values("quarter")
                series[lex.get(theme, {}).get("label", theme)] = pd.Series(g["breadth_pct"].values, index=[_q_end(q) for q in g["quarter"]])
            out.append(build_series_chart("theme_diffusion", "Theme diffusion — share of earnings calls mentioning each theme, by quarter (F-39 / R-23; point-in-time)", series, ytitle="% of calls", height=320))
    if has_table("x_theme_weekly"):
        xw = read_df("x_theme_weekly")
        if not xw.empty:
            labels = {k: lab for k, lab, _ in X_BUCKETS}
            piv = xw.pivot_table(index="week", columns="bucket", values="n_threads", aggfunc="sum").fillna(0).sort_index()
            piv.index = pd.to_datetime(piv.index)
            roll = piv.rolling(4, min_periods=1).sum()
            top = roll.sum().sort_values(ascending=False).head(8).index
            out.append(build_series_chart("timmer_themes", "Jurrien Timmer on X — threads per theme, trailing 4 weeks (relay-weight context, INF-12)",
                                          {labels.get(b, b): roll[b] for b in top}, ytitle="threads / 4 wks", height=300))
    return out


def theme_tables() -> dict:
    out = {"expanding": [], "emerging": [], "quarter": None}
    if has_table("theme_quarterly"):
        from ..text.themes import expanding_themes

        lex = yaml.safe_load(open(CONFIG_DIR / "themes.yaml", encoding="utf-8"))["themes"]
        tq = read_df("theme_quarterly")
        master = read_df("security_master")[["security_id", "symbol", "sector"]].set_index("security_id")
        exp = expanding_themes(pd.Timestamp.today() + pd.DateOffset(months=3))   # include the current quarter for the live view
        timmer = read_df("x_theme_weekly").sort_values("week", ascending=False) if has_table("x_theme_weekly") else pd.DataFrame()
        tmap = {"ai_compute": "ai_compute", "memory_hbm": "ai_compute", "agentic_ai": "ai_compute", "ai_power_grid": "ai_compute", "nuclear": "oil_commodities",
                "tariffs_trade": "oil_commodities", "rates_refinancing": "rates", "crypto_digital_assets": "gold_crypto"}
        for theme, info in sorted(exp.items(), key=lambda kv: -kv[1]["breadth_now"]):
            g = tq[(tq.theme == theme) & (tq.quarter == info["quarter"])]
            new = json.loads(g["new_entrants"].iloc[0]) if len(g) else []
            syms = [f"{master.loc[s, 'symbol']} ({master.loc[s, 'sector'] or '?'})" for s in new if s in master.index][:12]
            tk = ""
            if not timmer.empty and tmap.get(theme):
                hit = timmer[timmer.bucket == tmap[theme]]
                if len(hit):
                    tk = f"{hit['week'].iloc[0]}: {hit['sample_summary'].iloc[0]}"
            out["expanding"].append({"theme": lex.get(theme, {}).get("label", theme), "quarter": info["quarter"], "breadth_now": info["breadth_now"],
                                     "breadth_4q_ago": info["breadth_4q_ago"], "n_sectors": info["n_sectors"], "new_entrants": syms,
                                     "top_sectors": ", ".join(json.loads(g["top_sectors"].iloc[0])) if len(g) else "", "timmer": tk})
    if has_table("theme_emerging"):
        te = read_df("theme_emerging")
        if not te.empty:
            q = te["quarter"].max()
            out["quarter"] = q
            out["emerging"] = te[te.quarter == q].sort_values("ratio_vs_prior_year", ascending=False).head(20).to_dict("records")
    return out
