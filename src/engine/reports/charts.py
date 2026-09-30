"""The one chart builder. Produces a ChartSpec (plain dict) that `_chart.html.j2` renders with Plotly.js.
Palette and mark specs follow the dataviz skill's reference palette (thin 2px lines, hairline grid, text in ink
tokens, series colors on marks only, drawdown shading as a 10% wash, no dual axes — separate panels instead)."""
from __future__ import annotations

import json
from datetime import date

import numpy as np
import pandas as pd

PALETTE = {
    "light": {"surface": "#fcfcfb", "ink": "#0b0b0b", "ink2": "#52514e", "muted": "#898781", "grid": "#e1e0d9", "axis": "#c3c2b7",
              "s1": "#2a78d6", "s2": "#eb6834", "s3": "#1baf7a", "s4": "#eda100", "s5": "#e87ba4", "s6": "#008300", "s7": "#4a3aa7", "s8": "#e34948",
              "good": "#0ca30c", "critical": "#d03b3b", "neutral": "#f0efec"},
    "dark": {"surface": "#1a1a19", "ink": "#ffffff", "ink2": "#c3c2b7", "muted": "#898781", "grid": "#2c2c2a", "axis": "#383835",
             "s1": "#3987e5", "s2": "#d95926", "s3": "#199e70", "s4": "#c98500", "s5": "#d55181", "s6": "#008300", "s7": "#9085e9", "s8": "#e66767",
             "good": "#0ca30c", "critical": "#d03b3b", "neutral": "#383835"},
}
EVENT_STYLE = {
    "earnings_beat": {"symbol": "triangle-up", "slot": "s3", "label": "Earnings beat"},
    "earnings_miss": {"symbol": "triangle-down", "slot": "s8", "label": "Earnings miss"},
    "filing_8k": {"symbol": "diamond", "slot": "s7", "label": "8-K"},
    "form4_buy": {"symbol": "circle", "slot": "s6", "label": "Insider buy"},
    "form4_sell": {"symbol": "circle-open", "slot": "s2", "label": "Insider sell"},
    "regulatory": {"symbol": "star", "slot": "s4", "label": "Federal Register"},
    "macro": {"symbol": "square", "slot": "s5", "label": "Macro episode"},
    "jp_tanshin": {"symbol": "square", "slot": "s3", "label": "決算短信"},
}
PHASE_COLOR = {"earnings_led": "s3", "multiple_led": "s1", "event": "s7", "macro": "s5", "mixed": "s4"}


def _d(x) -> str:
    return pd.Timestamp(x).strftime("%Y-%m-%d")


def build_price_chart(security_id: str, symbol: str, prices: pd.DataFrame, *, start=None, end=None,
                      overlays: set[str] | None = None, eps_series: pd.Series | None = None, pe_band: dict | None = None,
                      events: pd.DataFrame | None = None, phases: list[dict] | None = None, window: tuple | None = None,
                      benchmark: pd.DataFrame | None = None, benchmark_label: str = "SPY (total return)",
                      compact: bool = False, currency: str = "USD", subtitle: str = "") -> dict:
    overlays = overlays or {"price"}
    px = prices.copy()
    px["date"] = pd.to_datetime(px["date"])
    if start is not None:
        px = px[px["date"] >= pd.Timestamp(start)]
    if end is not None:
        px = px[px["date"] <= pd.Timestamp(end)]
    px = px.sort_values("date")
    if px.empty:
        return {"id": f"chart-{symbol}", "empty": True}
    dates = [_d(d) for d in px["date"]]
    close = px["close_adj"].astype(float).round(4).tolist()
    panels = [{"id": "price", "height": 1.0 if compact else 0.56, "title": f"Price ({currency})", "log": True}]
    traces, shapes, annotations, legend_events = [], [], [], []

    traces.append({"panel": "price", "overlay": "price", "type": "scatter", "mode": "lines", "name": f"{symbol} close",
                   "x": dates, "y": close, "line": {"width": 2, "color": "var(--s1)", "shape": "linear"},
                   "hovertemplate": "%{x}<br>%{y:,.2f}<extra></extra>"})
    if "price_tr" in overlays and "close_tr" in px.columns:
        tr = px["close_tr"].astype(float)
        tr = (tr / tr.iloc[0] * close[0]).round(4).tolist()
        traces.append({"panel": "price", "overlay": "price_tr", "type": "scatter", "mode": "lines", "name": "total return (rebased)",
                       "x": dates, "y": tr, "line": {"width": 1.5, "color": "var(--s3)"}, "visible": "legendonly"})
    if "benchmark" in overlays and benchmark is not None and not benchmark.empty:
        b = benchmark.copy()
        b["date"] = pd.to_datetime(b["date"])
        b = b[(b["date"] >= px["date"].iloc[0]) & (b["date"] <= px["date"].iloc[-1])].sort_values("date")
        if not b.empty:
            lvl = b["level"].astype(float)
            tr = px.set_index("date")["close_tr"].astype(float)
            base_ratio = float(tr.iloc[0]) / float(lvl.iloc[0])
            traces.append({"panel": "price", "overlay": "benchmark", "type": "scatter", "mode": "lines", "name": benchmark_label,
                           "x": [_d(d) for d in b["date"]], "y": (lvl * base_ratio).round(4).tolist(),
                           "line": {"width": 1.5, "color": "var(--muted)"}})
            # show the pick itself on a total-return basis for a fair comparison
            traces[0]["y"] = tr.round(4).tolist()
            traces[0]["name"] = f"{symbol} (total return)"
    if "drawdown" in overlays and not compact:
        s = px.set_index("date")["close_adj"].astype(float)
        dd = s / s.cummax() - 1.0
        in_dd, dd_start = False, None
        for d, v in dd.items():
            if v <= -0.20 and not in_dd:
                in_dd, dd_start = True, d
            elif v > -0.20 and in_dd:
                shapes.append({"type": "rect", "xref": "x", "yref": "paper", "x0": _d(dd_start), "x1": _d(d), "y0": 0, "y1": 1,
                               "fillcolor": "var(--s1)", "opacity": 0.08, "line": {"width": 0}, "layer": "below", "panel": "price"})
                in_dd = False
        if in_dd:
            shapes.append({"type": "rect", "xref": "x", "yref": "paper", "x0": _d(dd_start), "x1": dates[-1], "y0": 0, "y1": 1,
                           "fillcolor": "var(--s1)", "opacity": 0.08, "line": {"width": 0}, "layer": "below", "panel": "price"})
    if "pe_band" in overlays and eps_series is not None and not eps_series.empty and not compact:
        daily = px.set_index("date")["close_adj"].astype(float)
        e = eps_series.reindex(daily.index.union(eps_series.index)).ffill().reindex(daily.index)
        pe = (daily / e).where(e > 0)
        pe = pe.replace([np.inf, -np.inf], np.nan)
        roll = pe.rolling(2520, min_periods=250)
        lo, hi, med = roll.quantile(0.1), roll.quantile(0.9), roll.median()
        cap = float(np.nanmax([hi.dropna().iloc[-1] * 3 if hi.notna().any() else np.nan, (pe.dropna().iloc[-1] * 2 if pe.notna().any() else np.nan), 30]))
        panels.append({"id": "pe", "height": 0.24, "title": "TTM P/E", "log": False, "range": [0, cap]})
        traces.append({"panel": "pe", "overlay": "pe_band", "type": "scatter", "mode": "lines", "name": "10th pct", "x": dates,
                       "y": lo.round(2).where(lo.notna(), None).tolist(), "line": {"width": 0}, "showlegend": False, "hoverinfo": "skip"})
        traces.append({"panel": "pe", "overlay": "pe_band", "type": "scatter", "mode": "lines", "name": "own 10–90th pct band", "x": dates,
                       "y": hi.round(2).where(hi.notna(), None).tolist(), "line": {"width": 0}, "fill": "tonexty",
                       "fillcolor": "rgba(42,120,214,0.12)", "hoverinfo": "skip"})
        traces.append({"panel": "pe", "overlay": "pe_band", "type": "scatter", "mode": "lines", "name": "TTM P/E", "x": dates,
                       "y": pe.round(2).where(pe.notna(), None).tolist(), "line": {"width": 2, "color": "var(--s1)"},
                       "hovertemplate": "%{x}<br>P/E %{y:.1f}<extra></extra>"})
        traces.append({"panel": "pe", "overlay": "pe_band", "type": "scatter", "mode": "lines", "name": "10-yr median", "x": dates,
                       "y": med.round(2).where(med.notna(), None).tolist(), "line": {"width": 1, "color": "var(--muted)"}, "hoverinfo": "skip"})
    if "eps" in overlays and eps_series is not None and not eps_series.empty and not compact:
        panels.append({"id": "eps", "height": 0.20, "title": "TTM EPS", "log": False})
        es = eps_series[(eps_series.index >= px["date"].iloc[0] - pd.Timedelta(days=400)) & (eps_series.index <= px["date"].iloc[-1])]
        traces.append({"panel": "eps", "overlay": "eps", "type": "scatter", "mode": "lines", "name": "TTM EPS", "line": {"width": 2, "color": "var(--s2)", "shape": "hv"},
                       "x": [_d(d) for d in es.index], "y": es.round(3).tolist(), "hovertemplate": "%{x}<br>EPS %{y:.2f}<extra></extra>"})
    if "events" in overlays and events is not None and not events.empty and not compact:
        ev = events.copy()
        ev["event_date"] = pd.to_datetime(ev["event_date"])
        ev = ev[(ev["event_date"] >= px["date"].iloc[0]) & (ev["event_date"] <= px["date"].iloc[-1])]
        s = px.set_index("date")["close_adj"].astype(float)
        groups: dict[str, list] = {}
        for _, r in ev.iterrows():
            et = r["event_type"]
            p = json.loads(r["payload"]) if isinstance(r["payload"], str) else (r["payload"] or {})
            if et == "earnings":
                sp = p.get("surprise_pct")
                key = "earnings_beat" if (sp is not None and sp >= 0) else "earnings_miss"
                text = f"EPS {p.get('eps_actual')} vs est {p.get('eps_estimate')} ({sp:+.1f}%)" if sp is not None else "earnings"
            elif et in ("form4_buy", "form4_sell"):
                if float(p.get("value_usd") or 0) < (2e7 if et == "form4_sell" else 1e6):
                    continue
                key, text = et, f"{p.get('name')}: ${float(p.get('value_usd') or 0)/1e6:.1f}M"
            elif et == "filing_8k":
                items = str(p.get("items") or "")
                if not any(i in items for i in ("1.01", "1.03", "2.01", "5.02", "2.02")):
                    continue
                key, text = "filing_8k", f"8-K items {items}"
            elif et in ("regulatory", "macro", "jp_tanshin"):
                key, text = et, p.get("title") or p.get("label") or et
            else:
                continue
            idx = s.index.searchsorted(r["event_date"])
            if idx >= len(s):
                continue
            groups.setdefault(key, []).append((_d(s.index[idx]), float(s.iloc[idx]), text))
        for key, rows in groups.items():
            st = EVENT_STYLE[key]
            if len(rows) > 60:                      # keep marker density readable
                rows = rows[-60:]
            traces.append({"panel": "price", "overlay": "events", "type": "scatter", "mode": "markers", "name": st["label"],
                           "x": [r[0] for r in rows], "y": [r[1] for r in rows], "text": [r[2] for r in rows],
                           "marker": {"symbol": st["symbol"], "size": 9, "color": f"var(--{st['slot']})", "line": {"width": 2, "color": "var(--surface)"}},
                           "hovertemplate": "%{x}<br>%{text}<extra>" + st["label"] + "</extra>"})
            legend_events.append(st["label"])
    if "phases" in overlays and phases and not compact:
        for ph in phases:
            x0, x1 = _d(ph["start"]), _d(ph["end"])
            shapes.append({"type": "line", "xref": "x", "yref": "paper", "x0": x1, "x1": x1, "y0": 0, "y1": 1, "panel": "price",
                           "line": {"width": 1, "color": "var(--axis)"}})
            if ph.get("weeks", 0) < 8 and len(phases) > 6:
                continue
            lbl = f"{ph['ret_pct']:+.0f}% {ph['label'].replace('_', '-')}"
            annotations.append({"panel": "price", "x": x0, "xref": "x", "yref": "paper", "y": 1.0 if ph["ret_pct"] >= 0 else 0.02,
                                "text": lbl, "showarrow": False, "xanchor": "left", "yanchor": "top" if ph["ret_pct"] >= 0 else "bottom",
                                "font": {"size": 11, "color": "var(--ink2)"}, "bgcolor": "var(--surface)", "opacity": 0.9})
    if "window" in overlays and window:
        w0, w1 = _d(window[0]), _d(window[1])
        shapes.append({"type": "rect", "xref": "x", "yref": "paper", "x0": w0, "x1": w1, "y0": 0, "y1": 1, "panel": "price",
                       "fillcolor": "var(--s3)", "opacity": 0.10, "line": {"width": 0}, "layer": "below"})
        for x, nm in ((w0, "entry"), (w1, "exit")):
            annotations.append({"panel": "price", "x": x, "xref": "x", "yref": "paper", "y": 1.0, "text": nm, "showarrow": False,
                                "xanchor": "left", "yanchor": "top", "font": {"size": 11, "color": "var(--ink2)"}})
    return {
        "id": f"chart-{symbol.replace('.', '_')}", "empty": False, "symbol": symbol, "security_id": security_id,
        "title": f"{symbol}", "subtitle": subtitle, "x_range": [dates[0], dates[-1]], "panels": panels, "traces": traces,
        "shapes": shapes, "annotations": annotations, "compact": compact, "legend_events": legend_events, "height": 70 if compact else 620,
        "meta": {"currency": currency, "price_basis": "split-adjusted", "as_of": dates[-1], "sources": ["fmp"], "overlays": sorted(overlays)},
    }


def _clean(o):
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if isinstance(o, (np.floating, float)):
        return None if np.isnan(o) or np.isinf(o) else float(o)
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, (pd.Timestamp, date)):
        return _d(o)
    return o


def to_json(spec: dict) -> str:
    return json.dumps(_clean(spec), default=str, allow_nan=False)


def build_series_chart(chart_id: str, title: str, series: dict[str, pd.Series], *, lines: list[float] | None = None, height: int = 260, ytitle: str = "") -> dict:
    """Simple multi-series line chart (macro dashboard): 2px lines in categorical slot order, hairline grid, dashed
    horizontal lines only for stated spec thresholds."""
    traces = []
    slots = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"]
    x0, x1 = None, None
    for i, (name, s) in enumerate(series.items()):
        s = s.dropna()
        if s.empty:
            continue
        x0 = min(x0, s.index.min()) if x0 is not None else s.index.min()
        x1 = max(x1, s.index.max()) if x1 is not None else s.index.max()
        traces.append({"panel": "main", "overlay": "series", "type": "scatter", "mode": "lines", "name": name, "x": [_d(d) for d in s.index],
                       "y": s.round(3).tolist(), "line": {"width": 2, "color": f"var(--{slots[i % 8]})"}, "hovertemplate": "%{x}<br>%{y:.2f}<extra>" + name + "</extra>"})
    shapes = []
    for lv in lines or []:
        shapes.append({"type": "line", "xref": "paper", "yref": "y", "x0": 0, "x1": 1, "y0": lv, "y1": lv, "panel": "main",
                       "line": {"width": 1, "color": "var(--critical)", "dash": "dot"}, "absolute_y": True})
    return {"id": chart_id, "empty": not traces, "title": title, "subtitle": "", "panels": [{"id": "main", "height": 1.0, "title": ytitle, "log": False}],
            "traces": traces, "shapes": shapes, "annotations": [], "compact": False, "height": height,
            "x_range": [_d(x0), _d(x1)] if x0 is not None else None, "meta": {"sources": ["fred"]}}
