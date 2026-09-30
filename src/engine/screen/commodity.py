"""Commodity-cycle read for a group at a date (point-in-time): where the cycle stands (aggregate TTM operating margin vs the
group's own ten-year range), capex discipline (reinvestment vs the group's own norm), whether the swings have dampened, and
the typical cycle length. Oil became less cyclical as capex discipline grew; memory runs the same pattern on a longer cycle."""
from __future__ import annotations

from functools import lru_cache

import numpy as np
import pandas as pd

from ..pit.commodity import cfg
from ..store import has_table, read_df


@lru_cache(maxsize=64)
def _series(group: str, as_of: str) -> pd.DataFrame:
    if not has_table("commodity_cycle_quarterly"):
        return pd.DataFrame()
    df = read_df("commodity_cycle_quarterly", f"\"group\" = '{group}' AND available_from <= DATE '{as_of}'").sort_values("quarter_end")
    if df.empty:
        return df
    df["quarter_end"] = pd.to_datetime(df["quarter_end"])
    df = df.set_index("quarter_end")
    for c in ("revenue", "op_income", "ocf", "capex"):
        df[f"{c}_ttm"] = df[c].rolling(4).sum()
    df["margin"] = df["op_income_ttm"] / df["revenue_ttm"]
    df["capex_ocf"] = df["capex_ttm"] / df["ocf_ttm"].where(df["ocf_ttm"] > 0)
    df["capex_rev"] = df["capex_ttm"] / df["revenue_ttm"]
    return df.dropna(subset=["margin"])


def _ord(i: int) -> str:
    return f"{i}{'th' if 10 <= i % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(i % 10, 'th')}"


def _peaks(x: np.ndarray, min_sep: int = 4) -> list[int]:
    out = []
    for i in range(2, len(x) - 2):
        if x[i] == max(x[max(0, i - min_sep):i + min_sep + 1]) and x[i] > np.nanmedian(x):
            if not out or i - out[-1] >= min_sep:
                out.append(i)
    return out


def cycle_read(group: str, as_of) -> dict:
    """{} when there is no history. Otherwise phase, margin percentile, capex discipline (0–100), amplitude ratio, cycle length,
    a plain-English verdict and the score adjustment for the sector call."""
    k = cfg()
    p = k["params"]
    label = k["groups"].get(group, {}).get("label", group)
    s = _series(group, str(pd.Timestamp(as_of).date()))
    if len(s) < 12:
        return {}
    hist = s.tail(int(p["history_years"]) * 4)
    m = hist["margin"].values
    now = float(m[-1])
    pct = float((m[:-1] < now).mean() * 100) if len(m) > 1 else 50.0
    chg_4q = float(now - m[-5]) if len(m) >= 5 else 0.0
    rising = float(m[-1] - m[-3]) > 0 if len(m) >= 3 else False
    if pct >= float(p["peak_pctile"]):
        phase = "peak, rolling over" if chg_4q < 0 else "peak"
    elif pct <= float(p["trough_pctile"]):
        phase = "trough, turning up" if rising else "trough"
    else:
        phase = "mid-cycle, margins rising" if chg_4q > 0 else "mid-cycle, margins falling"
    ci = s["capex_ocf"].replace([np.inf, -np.inf], np.nan).dropna()      # the whole history: discipline is judged against how the group used to reinvest
    disc, disc_txt = None, ""
    if len(ci) >= 8 and np.isfinite(ci.iloc[-1]):
        norm = float(ci.median())
        cur = float(ci.iloc[-1])
        disc = float(100.0 - (ci.iloc[:-1] < cur).mean() * 100.0)        # 100 = reinvesting less than at any time in its history
        disc_txt = f"capex is {cur*100:.0f}% of operating cash flow vs a {norm*100:.0f}% norm since {ci.index[0].year} (lower than {disc:.0f}% of its history)"
    amp = None
    if len(m) >= 40:
        recent, prior = np.nanstd(m[-20:]), np.nanstd(m[-40:-20])
        amp = float(recent / prior) if prior > 0 else None
    pk = _peaks(m)
    cyc = float(np.median(np.diff(pk)) / 4.0) if len(pk) >= 2 else None
    disciplined = disc is not None and disc >= float(p["discipline_high"])
    dampened = amp is not None and amp <= float(p["dampened_ratio"])
    adj = 0.0
    mx = float(p["score_adjust_max"])
    if phase.startswith("trough") and disciplined:
        adj = mx
    elif phase.startswith("peak") and not disciplined:
        adj = -mx
    elif phase.startswith("peak") and disciplined:
        adj = -mx / 2
    elif phase.startswith("trough"):
        adj = mx / 2
    verdict = (f"{label}: {phase} — aggregate operating margin {now*100:.0f}%, the {_ord(int(round(pct)))} percentile of ten years"
               + (f"; {disc_txt} — capex discipline {'high' if disciplined else 'low'} ({disc:.0f}/100)" if disc is not None else "")
               + (f"; swings {amp:.1f}× the prior five years — {'the cycle has dampened' if dampened else 'still fully cyclical'}" if amp is not None else "")
               + (f"; typical cycle ≈ {cyc:.1f} years" if cyc else "") + ".")
    return {"group": group, "label": label, "phase": phase, "margin": now, "margin_pctile": pct, "margin_change_4q": chg_4q, "capex_discipline": disc,
            "capex_ocf": (float(ci.iloc[-1]) if len(ci) else None), "capex_ocf_norm": (float(ci.median()) if len(ci) >= 8 else None), "amplitude_ratio": amp,
            "dampened": dampened, "disciplined": disciplined, "cycle_years": cyc, "n_quarters": int(len(hist)), "score_adjust": adj, "verdict": verdict,
            "rule_ids": ["R-15", "F-26", "F-04", "D-04"]}


def group_for(industry: str | None, symbol: str | None) -> str | None:
    k = cfg()
    for g, spec in k["groups"].items():
        if symbol and symbol in (spec.get("symbols") or []):
            return g
    for g, spec in k["groups"].items():
        if industry and industry in (spec.get("industries") or []):
            return g
    return None


def reads_for_sectors(as_of) -> dict[str, dict]:
    """{theme_sector: read} for the sectors that have a commodity group configured."""
    out = {}
    for sector, g in (cfg().get("sector_group") or {}).items():
        r = cycle_read(g, as_of)
        if r:
            out[sector] = r
    return out
