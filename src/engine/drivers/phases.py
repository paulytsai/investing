"""Zigzag phase segmentation on weekly closes; per-phase EPS-vs-multiple decomposition; event attachment; labels."""
from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass, field

import numpy as np
import pandas as pd

from ..config import macro_episodes
from ..frameworks.core import move_decomposition

HIGH_8K_ITEMS = ("1.01", "1.03", "2.01", "5.02", "2.02")


@dataclass
class Phase:
    idx: int
    start: pd.Timestamp
    end: pd.Timestamp
    weeks: int
    open: bool
    p0: float
    p1: float
    ret_pct: float
    dln_p: float | None = None
    dln_eps: float | None = None
    dln_mult: float | None = None
    basis: str = "none"
    f_eps: float | None = None
    f_mult: float | None = None
    eps0: float | None = None
    eps1: float | None = None
    bench_ret_pct: float | None = None
    label: str = "mixed"
    events: list[dict] = field(default_factory=list)
    unexplained: bool = False
    shock_type_hindsight: str | None = None
    max_dd_within: float | None = None
    event_summary: str = ""


def zigzag(weekly: pd.Series, threshold_pct: float = 20.0, min_weeks: int = 4) -> list[tuple[pd.Timestamp, pd.Timestamp]]:
    """Pivot detection: commit an extreme once price reverses ≥ threshold from it. Returns [(start, end)] phases."""
    s = weekly.dropna()
    if len(s) < 8:
        return []
    thr = threshold_pct / 100.0
    pivots = [s.index[0]]
    state = 0                    # +1 up-swing, -1 down-swing
    ext_i, ext_v = 0, float(s.iloc[0])
    vals, idx = s.values.astype(float), s.index
    for i in range(1, len(s)):
        v = vals[i]
        if state >= 0 and v > ext_v:
            ext_i, ext_v = i, v
        elif state <= 0 and v < ext_v and state != 0:
            ext_i, ext_v = i, v
        if state == 0:
            if v >= vals[0] * (1 + thr):
                state, ext_i, ext_v = 1, i, v
            elif v <= vals[0] * (1 - thr):
                state, ext_i, ext_v = -1, i, v
            continue
        if state == 1 and v <= ext_v * (1 - thr):
            pivots.append(idx[ext_i])
            state, ext_i, ext_v = -1, i, v
        elif state == -1 and v >= ext_v * (1 + thr):
            pivots.append(idx[ext_i])
            state, ext_i, ext_v = 1, i, v
    if pivots[-1] != idx[-1]:
        pivots.append(idx[-1])
    phases = [(pivots[i], pivots[i + 1]) for i in range(len(pivots) - 1) if pivots[i + 1] > pivots[i]]
    # merge phases shorter than min_weeks into the neighbour with the smaller absolute return
    changed = True
    while changed and len(phases) > 1:
        changed = False
        for i, (a, b) in enumerate(phases):
            if (b - a).days < 7 * min_weeks:
                if i == 0:
                    phases[0] = (a, phases[1][1]); del phases[1]
                elif i == len(phases) - 1:
                    phases[i - 1] = (phases[i - 1][0], b); del phases[i]
                else:
                    ra = abs(math.log(float(s[phases[i - 1][1]]) / float(s[phases[i - 1][0]])))
                    rb = abs(math.log(float(s[phases[i + 1][1]]) / float(s[phases[i + 1][0]])))
                    if ra <= rb:
                        phases[i - 1] = (phases[i - 1][0], b); del phases[i]
                    else:
                        phases[i + 1] = (a, phases[i + 1][1]); del phases[i]
                changed = True
                break
    return phases


def eps_at(eps_series: pd.Series, when: pd.Timestamp) -> float | None:
    if eps_series is None or eps_series.empty:
        return None
    s = eps_series[eps_series.index <= when]
    return float(s.iloc[-1]) if len(s) else None


def build_phases(prices: pd.DataFrame, eps_series: pd.Series | None, bench: pd.Series | None, events: pd.DataFrame | None,
                 threshold_pct: float = 20.0, min_weeks: int = 4, macro_bench_pct: float = 15.0) -> list[Phase]:
    px = prices.copy()
    px["date"] = pd.to_datetime(px["date"])
    daily = px.drop_duplicates("date").set_index("date")["close_adj"].astype(float).sort_index()
    weekly = daily.resample("W-FRI").last().dropna()
    segs = zigzag(weekly, threshold_pct, min_weeks)
    out: list[Phase] = []
    for i, (a, b) in enumerate(segs):
        seg = daily[(daily.index >= a) & (daily.index <= b)]
        if len(seg) < 2:
            continue
        p0, p1 = float(seg.iloc[0]), float(seg.iloc[-1])
        ph = Phase(idx=i + 1, start=seg.index[0], end=seg.index[-1], weeks=int((b - a).days // 7), open=(i == len(segs) - 1), p0=p0, p1=p1,
                   ret_pct=(p1 / p0 - 1) * 100, max_dd_within=float((seg / seg.cummax() - 1).min() * 100))
        e0, e1 = eps_at(eps_series, ph.start), eps_at(eps_series, ph.end)
        d = move_decomposition(p0, p1, e0, e1)
        ph.dln_p, ph.dln_eps, ph.dln_mult, ph.basis, ph.f_eps, ph.f_mult, ph.eps0, ph.eps1 = (d["dln_p"], d["dln_eps"], d["dln_mult"], d["basis"], d["f_eps"], d["f_mult"], e0, e1)
        if ph.dln_p is not None and abs(ph.dln_p) < 0.05:          # too small a move to attribute meaningfully
            ph.f_eps = ph.f_mult = None
        if bench is not None and not bench.empty:
            bb = bench[(bench.index >= ph.start) & (bench.index <= ph.end)]
            if len(bb) >= 2:
                ph.bench_ret_pct = float(bb.iloc[-1] / bb.iloc[0] - 1) * 100
        ph.events = attach_events(events, ph.start, ph.end)
        ph.label = label_phase(ph, macro_bench_pct)
        ph.unexplained = (ph.label == "mixed" and not ph.events) or ph.basis == "none"
        ph.shock_type_hindsight = hindsight(eps_series, ph) if ph.ret_pct < 0 else None
        ph.event_summary = "; ".join(e["text"] for e in ph.events[:4])
        out.append(ph)
    return out


def attach_events(events: pd.DataFrame | None, start: pd.Timestamp, end: pd.Timestamp, lead_days: int = 7, keep: int = 8) -> list[dict]:
    rows: list[tuple[float, dict]] = []
    if events is not None and not events.empty:
        ev = events.copy()
        ev["event_date"] = pd.to_datetime(ev["event_date"])
        ev = ev[(ev["event_date"] >= start - pd.Timedelta(days=lead_days)) & (ev["event_date"] <= end)]
        for _, r in ev.iterrows():
            p = json.loads(r["payload"]) if isinstance(r["payload"], str) else (r["payload"] or {})
            et = r["event_type"]
            if et == "earnings":
                sp = p.get("surprise_pct")
                sal = abs(sp) if sp is not None else 1.0
                text = f"{r['event_date'].date()} earnings: EPS {p.get('eps_actual')} vs {p.get('eps_estimate')}" + (f" ({sp:+.0f}%)" if sp is not None else "")
                rows.append((sal + 5, {"date": str(r["event_date"].date()), "type": "earnings", "text": text, "surprise_pct": sp, "high": sp is not None and abs(sp) >= 10}))
            elif et == "filing_8k":
                items = str(p.get("items") or "")
                hi = any(i in items for i in HIGH_8K_ITEMS)
                if not hi:
                    continue
                rows.append((8.0, {"date": str(r["event_date"].date()), "type": "8-K", "text": f"{r['event_date'].date()} 8-K items {items}", "high": True}))
            elif et in ("form4_buy", "form4_sell"):
                v = float(p.get("value_usd") or 0)
                if v < 5e6:
                    continue
                rows.append((v / 1e7, {"date": str(r["event_date"].date()), "type": et, "text": f"{r['event_date'].date()} insider {'buy' if et == 'form4_buy' else 'sell'} ${v/1e6:.0f}M {p.get('name', '')}", "high": False}))
            elif et == "dividend_change":
                rows.append((3.0, {"date": str(r["event_date"].date()), "type": "dividend", "text": f"{r['event_date'].date()} dividend {p.get('from')}→{p.get('to')}", "high": False}))
            elif et == "regulatory":
                rows.append((2.0, {"date": str(r["event_date"].date()), "type": "regulatory", "text": f"{r['event_date'].date()} {str(p.get('title'))[:80]}", "high": False}))
    for ep in macro_episodes():
        s, e = pd.Timestamp(ep["start"]), pd.Timestamp(ep["end"])
        if s <= end and e >= start:
            rows.append((6.0, {"date": str(s.date()), "type": "macro", "text": f"{ep['label']} ({s.date()}→{e.date()})", "high": True, "macro": True}))
    rows.sort(key=lambda t: -t[0])
    return [r for _, r in rows[:keep]]


def label_phase(ph: Phase, macro_bench_pct: float) -> str:
    b = ph.bench_ret_pct
    if b is not None and abs(b) >= macro_bench_pct and np.sign(b) == np.sign(ph.ret_pct) and abs(ph.ret_pct) <= 2 * abs(b):
        return "macro"
    if ph.basis == "pe" and ph.f_eps is not None:
        if ph.f_eps >= 0.6:
            return "earnings_led"
        if ph.f_mult is not None and ph.f_mult >= 0.6:
            return "multiple_led"
    span = (ph.end - ph.start).days or 1
    for e in ph.events:
        if e.get("high") and not e.get("macro"):
            if (pd.Timestamp(e["date"]) - ph.start).days <= 0.25 * span:
                return "event"
    return "mixed"


def hindsight(eps_series: pd.Series | None, ph: Phase) -> str | None:
    """Retrospective (uses post-phase EPS — never a signal): temporary if EPS a year later ≥ EPS at phase start."""
    if eps_series is None or eps_series.empty or ph.eps0 is None or ph.eps0 <= 0:
        return None
    later = eps_series[eps_series.index >= ph.end + pd.Timedelta(days=365)]
    if later.empty:
        return "unclear"
    e = float(later.iloc[0])
    if e >= ph.eps0:
        return "temporary"
    if e < 0.8 * ph.eps0:
        return "structural"
    return "unclear"


def phases_to_dicts(phases: list[Phase]) -> list[dict]:
    out = []
    for p in phases:
        d = asdict(p)
        d["start"], d["end"] = str(p.start.date()), str(p.end.date())
        out.append(d)
    return out
