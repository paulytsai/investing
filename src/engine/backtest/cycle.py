"""Cycle-aware exits (Paul, D-24): a pick is held until its theme-sector cycle is judged over, not for a fixed number of
months. Judged point-in-time from later quarterly evaluations only: the sector stance falls to underweight/avoid at K
consecutive evaluations, or the theme's transcript breadth sits ≥ drop% below its trailing peak at K consecutive quarters
(breadth of the previous quarter, because calls for a quarter are held after it ends). Bounded by min/max hold."""
from __future__ import annotations

import pandas as pd

from ..store import has_table, read_df

OVER_STANCES = ("underweight", "avoid")


def theme_breadth() -> dict[str, pd.Series]:
    """{theme: Series(quarter_end → breadth_pct)} from theme_quarterly (transcripts with the theme / all transcripts)."""
    if not has_table("theme_quarterly"):
        return {}
    t = read_df("theme_quarterly")
    out = {}
    for th, g in t.groupby("theme"):
        idx = pd.PeriodIndex(g["quarter"], freq="Q").to_timestamp(how="end").normalize()
        out[th] = pd.Series(g["breadth_pct"].values, index=idx).sort_index()
    return out


def breadth_over(theme: str | None, at: pd.Timestamp, breadth: dict[str, pd.Series], drop_pct: float, lookback_q: int = 12) -> bool:
    """True when the theme's breadth in the last completed quarter before `at` is ≥ drop_pct below its trailing peak."""
    if not theme or theme not in breadth:
        return False
    s = breadth[theme]
    s = s[s.index < at]                       # the quarter ending at `at` is not yet reported at `at`
    if len(s) < 4:
        return False
    peak = float(s.tail(lookback_q).max())
    return peak > 0 and float(s.iloc[-1]) <= peak * (1.0 - drop_pct / 100.0)


def exit_targets(formation: pd.Timestamp, eval_dates: list[pd.Timestamp], stances: dict[pd.Timestamp, dict[str, str]], themes: dict[str, str | None],
                 breadth: dict[str, pd.Series], min_months: int, max_months: int, k: int, drop_pct: float) -> dict[str, dict]:
    """Per theme sector: {target: Timestamp, reason: str, evaluations: [...]} for names formed at `formation`."""
    lo = formation + pd.DateOffset(months=min_months)
    hi = formation + pd.DateOffset(months=max_months)
    later = [d for d in eval_dates if d > formation and d <= hi]
    sectors = set()
    for d in later:
        sectors.update((stances.get(d) or {}).keys())
    sectors.update(themes.keys())
    out = {}
    for s in sectors:
        run, trail, hit = 0, [], None
        for d in later:
            st = (stances.get(d) or {}).get(s)
            b_over = breadth_over(themes.get(s), d, breadth, drop_pct)
            over = (st in OVER_STANCES) or b_over
            run = run + 1 if over else 0
            trail.append({"date": str(d.date()), "stance": st, "breadth_over": b_over})
            if run >= k:
                hit = d
                reason = "sector stance " + str(st) if st in OVER_STANCES else "theme breadth off its peak"
                break
        if hit is not None:
            out[s] = {"target": max(hit, lo), "reason": f"cycle over at {hit.date()} ({reason}, {k} consecutive evaluations)", "evaluations": trail}
        else:
            out[s] = {"target": hi, "reason": f"cycle not over by the last evaluation → max hold {max_months}m", "evaluations": trail}
    return out
