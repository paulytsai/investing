"""Cohort and pooled statistics (spec §5.4: CAGR and simple side by side, batting average F-119), rank-IC per angle
with Newey–West t-stats for overlapping cohorts."""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats

from ..frameworks.core import returns_pair


def cohort_stats(results, hold_months: int) -> dict:
    ok = [r for r in results if r.ret is not None and r.status in ("ok", "delisted_cash", "in_flight")]
    if not ok:
        return {"n": 0}
    rets = np.array([r.ret for r in ok])
    bench = [r.bench_ret for r in ok if r.bench_ret is not None]
    b = float(np.mean(bench)) if bench else None
    years = hold_months / 12.0
    R = float(rets.mean())
    pair = returns_pair(R, years)
    bpair = returns_pair(b, years) if b is not None else {"cagr": None, "simple": None}
    return {
        "n": len(ok), "n_delisted": sum(1 for r in ok if r.status == "delisted_cash"), "in_flight": all(r.status == "in_flight" for r in ok),
        "ret_mean": R, "ret_median": float(np.median(rets)), "p10": float(np.percentile(rets, 10)), "p90": float(np.percentile(rets, 90)),
        "cagr": pair["cagr"], "simple": pair["simple"], "bench_ret": b, "bench_cagr": bpair["cagr"], "bench_simple": bpair["simple"],
        "excess": (R - b) if b is not None else None, "batting_pos": float((rets > 0).mean()),
        "batting_beat": float(np.mean([r.ret > r.bench_ret for r in ok if r.bench_ret is not None])) if bench else None,
        "best": max(ok, key=lambda r: r.ret).symbol, "worst": min(ok, key=lambda r: r.ret).symbol,
        "bench2_ret": (float(np.mean([r.bench2_ret for r in ok if r.bench2_ret is not None])) if any(r.bench2_ret is not None for r in ok) else None),
        "excess_ew": ((R - float(np.mean([r.bench2_ret for r in ok if r.bench2_ret is not None]))) if any(r.bench2_ret is not None for r in ok) else None),
        "batting_beat_ew": (float(np.mean([r.ret > r.bench2_ret for r in ok if r.bench2_ret is not None])) if any(r.bench2_ret is not None for r in ok) else None),
    }


def pooled_stats(cohort_rows: list[dict]) -> dict:
    done = [c for c in cohort_rows if c.get("n") and not c.get("in_flight")]
    if not done:
        return {}
    m = np.array([c["ret_mean"] for c in done])
    ex = np.array([c["excess"] for c in done if c.get("excess") is not None])
    return {
        "cohorts": len(done), "mean_cohort_ret": float(m.mean()), "median_cohort_ret": float(np.median(m)),
        "mean_excess": float(ex.mean()) if len(ex) else None, "share_cohorts_beating": float((ex > 0).mean()) if len(ex) else None,
        "mean_batting_pos": float(np.mean([c["batting_pos"] for c in done])),
        "mean_batting_beat": float(np.mean([c["batting_beat"] for c in done if c.get("batting_beat") is not None])),
        "rolling_hit_rate": [float(x) for x in pd.Series([c["batting_beat"] for c in done]).rolling(4).mean().dropna()],
        "mean_excess_ew": (float(np.mean([c["excess_ew"] for c in done if c.get("excess_ew") is not None])) if any(c.get("excess_ew") is not None for c in done) else None),
        "share_cohorts_beating_ew": (float(np.mean([c["excess_ew"] > 0 for c in done if c.get("excess_ew") is not None])) if any(c.get("excess_ew") is not None for c in done) else None),
        "mean_batting_beat_ew": (float(np.mean([c["batting_beat_ew"] for c in done if c.get("batting_beat_ew") is not None])) if any(c.get("batting_beat_ew") is not None for c in done) else None),
    }


def curve_stats(curve: pd.DataFrame, n_sleeves: int) -> dict:
    """Headline from the first date all sleeves are live; ramp shown separately."""
    if curve.empty:
        return {}
    full = curve[curve["n_live_sleeves"] >= n_sleeves]
    seg = full if len(full) > 250 else curve
    p, b = seg["portfolio"], seg["benchmark"]
    years = (seg.index[-1] - seg.index[0]).days / 365.25
    pr, br = p.iloc[-1] / p.iloc[0] - 1, b.iloc[-1] / b.iloc[0] - 1
    lp = np.log(p).diff().dropna()
    lb = np.log(b).diff().dropna()
    out = {"start": seg.index[0].date(), "end": seg.index[-1].date(), "years": years, "portfolio_cum": float(pr), "bench_cum": float(br),
           "portfolio": returns_pair(float(pr), years), "benchmark": returns_pair(float(br), years),
           "max_dd": float((p / p.cummax() - 1).min()), "bench_max_dd": float((b / b.cummax() - 1).min()),
           "vol": float(lp.std() * np.sqrt(252)), "bench_vol": float(lb.std() * np.sqrt(252))}
    if len(lp) > 30:
        beta = float(np.cov(lp, lb.reindex(lp.index).fillna(0))[0, 1] / lb.var()) if lb.var() > 0 else None
        out["beta"] = beta
    cal = p.resample("YE").last().pct_change().dropna()
    calb = b.resample("YE").last().pct_change().dropna()
    out["calendar_years"] = [{"year": int(i.year), "portfolio": float(v), "benchmark": float(calb.get(i, np.nan))} for i, v in cal.items()]
    return out


def rank_ic(cohort_scored: dict[pd.Timestamp, list], results_by_formation: dict[pd.Timestamp, dict[str, float]], angle_keys: list[str]) -> dict:
    """Spearman IC between angle score (all eligible names at formation) and subsequent hold return; NW t-stat lag 7."""
    ics: dict[str, list[float]] = {k: [] for k in angle_keys + ["idea_strength"]}
    for f, cands in cohort_scored.items():
        rets = results_by_formation.get(f, {})
        rows = [(c, rets[c.security_id]) for c in cands if c.eligible and c.security_id in rets and rets[c.security_id] is not None
                and not (isinstance(rets[c.security_id], float) and np.isnan(rets[c.security_id]))]
        if len(rows) < 8:
            continue
        y = np.array([r for _, r in rows])
        for k in angle_keys:
            x = np.array([next((a.score for a in c.angles if a.key == k), np.nan) for c, _ in rows], dtype=float)
            m = ~np.isnan(x)
            if m.sum() >= 8 and np.std(x[m]) > 0:
                ic = float(stats.spearmanr(x[m], y[m]).correlation)
                if not np.isnan(ic):
                    ics[k].append(ic)
        x = np.array([c.idea_strength if c.idea_strength is not None else np.nan for c, _ in rows], dtype=float)
        m = ~np.isnan(x)
        if m.sum() >= 8 and np.std(x[m]) > 0:
            ic = float(stats.spearmanr(x[m], y[m]).correlation)
            if not np.isnan(ic):
                ics["idea_strength"].append(ic)
    out = {}
    for k, v in ics.items():
        if not v:
            out[k] = {"mean_ic": None, "hit_rate": None, "t_nw": None, "n": 0}
            continue
        arr = np.array(v)
        out[k] = {"mean_ic": float(arr.mean()), "hit_rate": float((arr > 0).mean()), "t_nw": _nw_t(arr, lag=min(7, len(arr) - 1)), "n": len(arr)}
    return out


def _nw_t(x: np.ndarray, lag: int) -> float | None:
    n = len(x)
    if n < 3:
        return None
    e = x - x.mean()
    s = float((e * e).sum()) / n
    for L in range(1, max(0, lag) + 1):
        w = 1 - L / (lag + 1)
        s += 2 * w * float((e[L:] * e[:-L]).sum()) / n
    if s <= 0:
        return None
    return float(x.mean() / np.sqrt(s / n))


def result_by_formation(results: dict[pd.Timestamp, list]) -> dict[pd.Timestamp, dict[str, float]]:
    return {f: {r.security_id: r.ret for r in rs} for f, rs in results.items()}
