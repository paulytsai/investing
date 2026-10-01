"""Where a stock sits in its own valuation cycle (F-13 own-history band, T-03 "on sale vs fair value" framing).
Pure functions over a daily multiple series (P/E, or P/S for names without earnings). The band thresholds that name
the phases are hypotheses carried in by the caller (D-25)."""
from __future__ import annotations

import pandas as pd

PHASES = ("trough", "below norm", "normal", "above norm", "peak")


def phase_for(percentile: float | None, trough_pctile: float = 20.0, peak_pctile: float = 80.0) -> str | None:
    if percentile is None:
        return None
    if percentile <= trough_pctile:
        return "trough"
    if percentile >= peak_pctile:
        return "peak"
    if percentile < 40:
        return "below norm"
    if percentile > 60:
        return "above norm"
    return "normal"


def monthly(hist: pd.Series, years: int = 10) -> list[list]:
    """Month-end samples of a daily series over the last `years`, as [[date, value], …] for the page and the chart."""
    if hist is None or hist.empty:
        return []
    s = hist.dropna().sort_index()
    s = s[s.index >= s.index.max() - pd.Timedelta(days=365 * years)]
    m = s.resample("ME").last().dropna()
    return [[str(d.date()), round(float(v), 2)] for d, v in m.items()]


def valuation_cycle(hist: pd.Series, current: float | None, *, basis: str = "pe", lookback_years: int = 10,
                    trough_pctile: float = 20.0, peak_pctile: float = 80.0, min_days: int = 750) -> dict:
    """Describe today's multiple against its own history.

    Returns {basis, current, percentile, low, median, high, n_years, phase, cheapest_since, share_cheaper,
             months_at_or_below, sentence}. `percentile` is None (and phase None) with fewer than `min_days` of history."""
    out = {"basis": basis, "current": current, "percentile": None, "low": None, "median": None, "high": None, "n_years": 0.0, "phase": None,
           "cheapest_since": None, "share_cheaper": None, "months_at_or_below": None, "sentence": None}
    if hist is None or hist.empty or current is None or current <= 0:
        out["sentence"] = "No usable multiple history." if basis == "pe" else "No usable sales-multiple history."
        return out
    s = hist.dropna().sort_index()
    s = s[s > 0]
    s = s[s.index >= s.index.max() - pd.Timedelta(days=365 * lookback_years)]
    out["n_years"] = round(len(s) / 250.0, 1)
    if len(s) < min_days:
        out["sentence"] = f"Only {out['n_years']:.1f} years of meaningful history — too short to say where this sits in its cycle."
        return out
    out["low"], out["median"], out["high"] = float(s.quantile(0.1)), float(s.median()), float(s.quantile(0.9))
    pct = float((s < current).mean() * 100)
    out["percentile"] = pct
    out["phase"] = phase_for(pct, trough_pctile, peak_pctile)
    cheaper = s[s <= current]
    if not cheaper.empty:
        last_cheaper = cheaper.index.max()
        # the last date the multiple was at or below today's level, excluding the most recent run (today itself)
        earlier = cheaper[cheaper.index < s.index.max() - pd.Timedelta(days=60)]
        out["cheapest_since"] = str(earlier.index.max().date()) if not earlier.empty else str(last_cheaper.date())
    out["share_cheaper"] = pct
    out["months_at_or_below"] = round(len(cheaper) / 21.0, 0)
    name = "trailing earnings" if basis == "pe" else "sales"
    x = f"{current:.1f}x {name}"
    if out["phase"] == "trough":
        where = f"near the bottom of its own range — cheaper only {pct:.0f}% of the time in the last {out['n_years']:.0f} years"
    elif out["phase"] == "peak":
        where = f"near the top of its own range — more expensive only {100 - pct:.0f}% of the time in the last {out['n_years']:.0f} years"
    elif out["phase"] == "below norm":
        where = f"below its norm — cheaper {pct:.0f}% of the time, against a usual {out['median']:.0f}x"
    elif out["phase"] == "above norm":
        where = f"above its norm — more expensive only {100 - pct:.0f}% of the time, against a usual {out['median']:.0f}x"
    else:
        where = f"about where it usually trades ({out['median']:.0f}x is the norm)"
    out["sentence"] = f"At {x} the stock is {where}; its range over that period ran from {out['low']:.0f}x to {out['high']:.0f}x."
    return out
