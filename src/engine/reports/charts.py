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


def build_rebased_chart(chart_id: str, title: str, series: dict[str, pd.Series], *, bold: set[str] | None = None, dashed: set[str] | None = None,
                        thin: bool = False, height: int = 340, subtitle: str = "", max_thin: int = 60) -> dict:
    """Several price lines rebased to 100 on one panel: `bold` names (the sector index, the chosen stocks) drawn on top
    with full colour, `dashed` names (the benchmark) as a reference, everything else as muted thin lines with hover labels
    (the "every stock in the sector" chart). Legend click isolates a line; thin lines are hidden from the legend when
    there are many."""
    bold, dashed = bold or set(), dashed or set()
    slots = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"]
    traces, x0, x1 = [], None, None
    others = [n for n in series if n not in bold and n not in dashed]
    many = len(others) > 12
    ci = 0
    order = others + [n for n in series if n in dashed] + [n for n in series if n in bold]   # bold last → drawn on top
    for name in order:
        s = series[name].dropna()
        if name not in bold and name not in dashed and isinstance(s.index, pd.DatetimeIndex) and len(s) > 200:
            s = s.resample("W-FRI").last().dropna()      # thin lines weekly: 60 members × 3 years stays under 300 KB
        if s.empty:
            continue
        x0 = min(x0, s.index.min()) if x0 is not None else s.index.min()
        x1 = max(x1, s.index.max()) if x1 is not None else s.index.max()
        base = {"panel": "main", "overlay": "series", "type": "scatter", "mode": "lines", "name": name, "x": [_d(d) for d in s.index],
                "y": s.round(2).tolist(), "hovertemplate": "%{x}<br>%{y:.0f}<extra>" + name + "</extra>"}
        if name in bold:
            base["line"] = {"width": 3 if name == next(iter(bold), None) else 2, "color": f"var(--{slots[ci % 8]})"}
            ci += 1
        elif name in dashed:
            base["line"] = {"width": 1.5, "color": "var(--ink2)", "dash": "dash"}
        else:
            base["line"] = {"width": 1, "color": "var(--axis)"}
            base["opacity"] = 0.55
            if many:
                base["showlegend"] = False
        traces.append(base)
    shapes = [{"type": "line", "xref": "paper", "yref": "y", "x0": 0, "x1": 1, "y0": 100, "y1": 100, "panel": "main",
               "line": {"width": 1, "color": "var(--grid)", "dash": "dot"}, "absolute_y": True}]
    return {"id": chart_id, "empty": not traces, "title": title, "subtitle": subtitle,
            "panels": [{"id": "main", "height": 1.0, "title": "rebased to 100", "log": True}], "traces": traces, "shapes": shapes, "annotations": [],
            "compact": False, "height": height, "x_range": [_d(x0), _d(x1)] if x0 is not None else None, "meta": {"sources": ["fmp"], "n_lines": len(traces)}}


def build_valuation_chart(chart_id: str, symbol: str, history: list[list], cycle: dict | None, *, height: int = 240) -> dict:
    """Where the stock sits in its own valuation cycle: the multiple (P/E, or P/S for names without earnings) over ten
    years, the 10th–90th band shaded, the median dashed, today's point annotated with its percentile. One panel."""
    cycle = cycle or {}
    basis = cycle.get("basis") or "pe"
    label = "P/E (trailing)" if basis == "pe" else "P/S (trailing)"
    if not history:
        return {"id": chart_id, "empty": True, "title": f"{symbol} — {label}", "subtitle": "", "panels": [], "traces": [], "shapes": [], "annotations": [],
                "compact": False, "height": height, "x_range": None, "meta": {}}
    xs = [h[0] for h in history]
    ys = [h[1] for h in history]
    traces = [{"panel": "main", "overlay": "multiple", "type": "scatter", "mode": "lines", "name": label, "x": xs, "y": ys,
               "line": {"width": 2, "color": "var(--s1)"}, "hovertemplate": "%{x}<br>%{y:.1f}x<extra>" + label + "</extra>"}]
    shapes, annotations = [], []
    lo, hi, med, cur = cycle.get("low"), cycle.get("high"), cycle.get("median"), cycle.get("current")
    if lo and hi:
        shapes.append({"type": "rect", "xref": "paper", "yref": "y", "x0": 0, "x1": 1, "y0": lo, "y1": hi, "panel": "main", "absolute_y": True,
                       "fillcolor": "var(--s1)", "opacity": 0.08, "line": {"width": 0}, "layer": "below"})
    if med:
        shapes.append({"type": "line", "xref": "paper", "yref": "y", "x0": 0, "x1": 1, "y0": med, "y1": med, "panel": "main", "absolute_y": True,
                       "line": {"width": 1, "color": "var(--ink2)", "dash": "dash"}})
    if cur:
        traces.append({"panel": "main", "overlay": "now", "type": "scatter", "mode": "markers", "name": "now", "x": [xs[-1]], "y": [round(float(cur), 2)],
                       "marker": {"size": 10, "color": "var(--s2)"}, "hovertemplate": f"now: {cur:.1f}x<extra></extra>"})
    pct = cycle.get("percentile")
    sub = (f"now {cur:.1f}x — {pct:.0f}th percentile of {cycle.get('n_years', 0):.0f} years · band 10th–90th {lo:.0f}x–{hi:.0f}x · median {med:.0f}x"
           if cur and pct is not None and lo and hi and med else (cycle.get("sentence") or ""))
    return {"id": chart_id, "empty": False, "title": f"{symbol} — {label}, own history", "subtitle": sub,
            "panels": [{"id": "main", "height": 1.0, "title": label, "log": False}], "traces": traces, "shapes": shapes, "annotations": annotations,
            "compact": False, "height": height, "x_range": [xs[0], xs[-1]], "meta": {"basis": basis, "sources": ["fmp", "engine"]}}


def build_bubble_chart(chart_id: str, title: str, points: list[dict], *, x_key: str = "x", y_key: str = "y", size_key: str = "size", label_key: str = "label",
                       x_title: str = "", y_title: str = "", x_ref: float | None = None, y_ref: float | None = None, highlight: str | None = None,
                       height: int = 320, subtitle: str = "", color_key: str | None = None) -> dict:
    """A product/brand map or a share line: one panel, bubbles sized by `size_key`, reference lines at the portfolio averages,
    the highlighted name in the accent colour, direct labels on every point (identity never by colour alone)."""
    pts = [p for p in points if p.get(x_key) is not None and p.get(y_key) is not None]
    if not pts:
        return {"id": chart_id, "empty": True, "title": title, "subtitle": subtitle, "panels": [], "traces": [], "shapes": [], "annotations": [], "compact": False, "height": height, "x_range": None, "meta": {}}
    sizes = [abs(float(p.get(size_key) or 0)) for p in pts]
    smax = max(sizes) or 1.0
    scaled = [8 + 32 * (s / smax) ** 0.5 for s in sizes]
    colors = ["var(--s2)" if highlight and p.get(label_key) == highlight else "var(--s1)" for p in pts]
    traces = [{"panel": "main", "overlay": "points", "type": "scatter", "mode": "markers+text", "name": title, "x": [p[x_key] for p in pts], "y": [p[y_key] for p in pts],
               "text": [str(p.get(label_key, "")) for p in pts], "textposition": "top center", "textfont": {"size": 10, "color": "var(--ink2)"},
               "marker": {"size": scaled, "color": colors, "opacity": 0.75, "line": {"width": 1, "color": "var(--surface)"}},
               "hovertemplate": "%{text}<br>" + (x_title or "x") + " %{x:.1f}<br>" + (y_title or "y") + " %{y:.1f}<extra></extra>", "showlegend": False}]
    shapes = []
    if x_ref is not None:
        shapes.append({"type": "line", "xref": "x", "yref": "paper", "x0": x_ref, "x1": x_ref, "y0": 0, "y1": 1, "panel": "main", "absolute_y": True, "line": {"width": 1, "color": "var(--ink2)", "dash": "dot"}})
    if y_ref is not None:
        shapes.append({"type": "line", "xref": "paper", "yref": "y", "x0": 0, "x1": 1, "y0": y_ref, "y1": y_ref, "panel": "main", "absolute_y": True, "line": {"width": 1, "color": "var(--ink2)", "dash": "dot"}})
    return {"id": chart_id, "empty": False, "title": title, "subtitle": subtitle, "panels": [{"id": "main", "height": 1.0, "title": y_title, "log": False}],
            "traces": traces, "shapes": shapes, "annotations": [], "compact": False, "height": height, "x_range": None, "x_title": x_title, "meta": {"sources": ["engine"]}}


def build_share_line_chart(chart_id: str, label: str, sl: dict, highlight: str | None = None, height: int = 320) -> dict:
    """The share/profit line (§6.3): x = ln(relative share) shown as the share index, y = operating margin %, the fitted line, members as bubbles by revenue."""
    import math

    rows = sl.get("rows") or []
    pts = [{"x": math.log(r["share_index"]), "y": r["ros"] * 100, "size": r["revenue"], "label": r["symbol"]} for r in rows if r.get("share_index", 0) > 0]
    spec = build_bubble_chart(chart_id, f"{label}: margin against relative share", pts, x_title="ln(relative share)", y_title="operating margin %", highlight=highlight, height=height,
                              subtitle=f"operating margin rises {sl['ros_gain_per_doubling']*100:.1f} points per doubling of share; {sl['n']} names, bubble = revenue")
    if not spec["empty"] and pts:
        xs = sorted(p["x"] for p in pts)
        a, b = sl["a_ros_at_parity"], sl["b_per_log_ratio"]
        spec["traces"].append({"panel": "main", "overlay": "fit", "type": "scatter", "mode": "lines", "name": "share line", "x": [xs[0], xs[-1]], "y": [(a + b * xs[0]) * 100, (a + b * xs[-1]) * 100],
                               "line": {"width": 2, "color": "var(--ink2)", "dash": "dash"}, "hoverinfo": "skip", "showlegend": False})
    return spec
