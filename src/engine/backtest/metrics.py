"""Cohort and pooled statistics (spec §5.4: CAGR and simple side by side, batting average F-119), rank-IC per angle
with Newey–West t-stats for overlapping cohorts."""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats

from ..frameworks.core import returns_pair


def cohort_stats(results, hold_months: int, rf: float = 0.0) -> dict:
    """Equal-weight and Kelly-weight cohort returns. Hold may vary per pick (cycle rule): CAGR uses the mean realised hold.
    `in_flight` = any position still open (marked at the last close); `n_open` counts them."""
    ok = [r for r in results if r.ret is not None and r.status in ("ok", "delisted_cash", "in_flight")]
    if not ok:
        return {"n": 0}
    rets = np.array([r.ret for r in ok])
    bench = [r.bench_ret for r in ok if r.bench_ret is not None]
    b = float(np.mean(bench)) if bench else None
    years = float(np.mean([r.hold_years for r in ok if r.hold_years])) if any(r.hold_years for r in ok) else hold_months / 12.0
    R = float(rets.mean())
    pair = returns_pair(R, years)
    bpair = returns_pair(b, years) if b is not None else {"cagr": None, "simple": None}
    kelly = _kelly_returns(ok, years, rf)
    return {
        "n": len(ok), "n_delisted": sum(1 for r in ok if r.status == "delisted_cash"), "in_flight": any(r.status == "in_flight" for r in ok),
        "n_open": sum(1 for r in ok if r.status == "in_flight"), "hold_years": years,
        "exit_reasons": sorted({r.exit_reason for r in ok}), **kelly,
        "ret_mean": R, "ret_median": float(np.median(rets)), "p10": float(np.percentile(rets, 10)), "p90": float(np.percentile(rets, 90)),
        "cagr": pair["cagr"], "simple": pair["simple"], "bench_ret": b, "bench_cagr": bpair["cagr"], "bench_simple": bpair["simple"],
        "excess": (R - b) if b is not None else None, "batting_pos": float((rets > 0).mean()),
        "batting_beat": float(np.mean([r.ret > r.bench_ret for r in ok if r.bench_ret is not None])) if bench else None,
        "best": max(ok, key=lambda r: r.ret).symbol, "worst": min(ok, key=lambda r: r.ret).symbol,
        "bench2_ret": (float(np.mean([r.bench2_ret for r in ok if r.bench2_ret is not None])) if any(r.bench2_ret is not None for r in ok) else None),
        "excess_ew": ((R - float(np.mean([r.bench2_ret for r in ok if r.bench2_ret is not None]))) if any(r.bench2_ret is not None for r in ok) else None),
        "batting_beat_ew": (float(np.mean([r.ret > r.bench2_ret for r in ok if r.bench2_ret is not None])) if any(r.bench2_ret is not None for r in ok) else None),
    }


def _kelly_returns(ok, years: float, rf: float) -> dict:
    """Cohort return under the Kelly weights: fully invested (weights normalised, isolates the sizing effect) and with the
    cash remainder earning the risk-free rate over the mean hold."""
    if not any(r.weight is not None for r in ok):
        return {}
    w = np.array([float(r.weight or 0.0) for r in ok])
    rets = np.array([r.ret for r in ok])
    bench = np.array([r.bench_ret if r.bench_ret is not None else np.nan for r in ok])
    gross = float(w.sum())
    if gross <= 0:
        return {"kelly_gross": 0.0, "ret_kelly": None, "ret_kelly_cash": None, "kelly_n_funded": 0}
    rk = float((w * rets).sum() / gross)
    cash_ret = (1.0 + rf) ** years - 1.0
    rkc = float((w * rets).sum() + (1.0 - gross) * cash_ret)
    bk = float(np.nansum(w * bench) / gross) if np.isfinite(bench).any() else None
    return {"kelly_gross": gross, "ret_kelly": rk, "ret_kelly_cash": rkc, "kelly_n_funded": int((w > 0).sum()),
            "excess_kelly": (rk - bk) if bk is not None else None, "cagr_kelly": returns_pair(rk, years)["cagr"],
            "kelly_max_weight": float(w.max()), "kelly_top": [r.symbol for r in sorted(ok, key=lambda r: -(r.weight or 0))[:5]]}


def pooled_stats(cohort_rows: list[dict], include_open: bool = False) -> dict:
    done = [c for c in cohort_rows if c.get("n") and (include_open or not c.get("in_flight"))]
    if not done:
        return {}
    m = np.array([c["ret_mean"] for c in done])
    ex = np.array([c["excess"] for c in done if c.get("excess") is not None])
    mk = [c["ret_kelly"] for c in done if c.get("ret_kelly") is not None]
    mkc = [c["ret_kelly_cash"] for c in done if c.get("ret_kelly_cash") is not None]
    exk = [c["excess_kelly"] for c in done if c.get("excess_kelly") is not None]
    return {
        "cohorts": len(done), "mean_cohort_ret": float(m.mean()), "median_cohort_ret": float(np.median(m)),
        "mean_hold_years": float(np.mean([c.get("hold_years") or 0 for c in done])),
        "n_open_positions": int(sum(c.get("n_open") or 0 for c in done)),
        "mean_cohort_ret_kelly": float(np.mean(mk)) if mk else None, "mean_cohort_ret_kelly_cash": float(np.mean(mkc)) if mkc else None,
        "mean_excess_kelly": float(np.mean(exk)) if exk else None, "share_cohorts_beating_kelly": float(np.mean([x > 0 for x in exk])) if exk else None,
        "mean_kelly_gross": float(np.mean([c["kelly_gross"] for c in done if c.get("kelly_gross") is not None])) if mk else None,
        "share_kelly_beats_ew": float(np.mean([c["ret_kelly"] > c["ret_mean"] for c in done if c.get("ret_kelly") is not None])) if mk else None,
        "mean_excess": float(ex.mean()) if len(ex) else None, "share_cohorts_beating": float((ex > 0).mean()) if len(ex) else None,
        "mean_batting_pos": float(np.mean([c["batting_pos"] for c in done])),
        "mean_batting_beat": float(np.mean([c["batting_beat"] for c in done if c.get("batting_beat") is not None])),
        "rolling_hit_rate": [float(x) for x in pd.Series([c["batting_beat"] for c in done]).rolling(4).mean().dropna()],
        "mean_excess_ew": (float(np.mean([c["excess_ew"] for c in done if c.get("excess_ew") is not None])) if any(c.get("excess_ew") is not None for c in done) else None),
        "share_cohorts_beating_ew": (float(np.mean([c["excess_ew"] > 0 for c in done if c.get("excess_ew") is not None])) if any(c.get("excess_ew") is not None for c in done) else None),
        "mean_batting_beat_ew": (float(np.mean([c["batting_beat_ew"] for c in done if c.get("batting_beat_ew") is not None])) if any(c.get("batting_beat_ew") is not None for c in done) else None),
        "mean_excess_vs_sector": (float(np.mean([c["excess_vs_sector"] for c in done if c.get("excess_vs_sector") is not None])) if any(c.get("excess_vs_sector") is not None for c in done) else None),
        "mean_allocation": (float(np.mean([c["allocation"] for c in done if c.get("allocation") is not None])) if any(c.get("allocation") is not None for c in done) else None),
        "mean_selection": (float(np.mean([c["selection"] for c in done if c.get("selection") is not None])) if any(c.get("selection") is not None for c in done) else None),
        "mean_batting_beat_sector": (float(np.mean([c["batting_beat_sector"] for c in done if c.get("batting_beat_sector") is not None])) if any(c.get("batting_beat_sector") is not None for c in done) else None),
        "sector_summary": _sector_summary(done),
    }


def _sector_summary(done: list[dict]) -> list[dict]:
    """Across completed cohorts: per theme sector, picks, mean pick return, mean sector return, stance mix."""
    agg: dict[str, dict] = {}
    for c in done:
        for s, d in (c.get("sector_detail") or {}).items():
            a = agg.setdefault(s, {"sector": s, "picks": 0, "pick_rets": [], "sector_rets": [], "stances": {}})
            a["picks"] += d.get("picks", 0)
            if d.get("r_picks") is not None:
                a["pick_rets"].extend([d["r_picks"]] * max(1, d.get("picks", 0)))
            if d.get("r_sector") is not None:
                a["sector_rets"].append(d["r_sector"])
            st = (c.get("sector_calls") or {}).get(s, {}).get("stance")
            if st:
                a["stances"][st] = a["stances"].get(st, 0) + 1
    out = []
    for s, a in agg.items():
        out.append({"sector": s, "picks": a["picks"], "mean_pick_ret": (float(np.mean(a["pick_rets"])) if a["pick_rets"] else None),
                    "mean_sector_ret": (float(np.mean(a["sector_rets"])) if a["sector_rets"] else None),
                    "stances": ", ".join(f"{k} {v}" for k, v in sorted(a["stances"].items(), key=lambda kv: -kv[1]))})
    return sorted(out, key=lambda x: -x["picks"])


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


def sector_attribution(picks: list, universe: list) -> dict:
    """Sector-adjusted view of one cohort. Sector return = equal-weight return of every eligible member of the theme sector
    over the hold; excess_vs_sector = mean(pick − own sector); Brinson: allocation = Σ (w_pick_s − w_univ_s)·(R_s − R_univ),
    selection = Σ w_pick_s·(R_picks_s − R_s), interaction folded into selection."""
    ok_u = [r for r in universe if r.ret is not None and r.status in ("ok", "delisted_cash", "in_flight")]
    ok_p = [r for r in picks if r.ret is not None and r.status in ("ok", "delisted_cash", "in_flight")]
    if not ok_u or not ok_p:
        return {}
    by_s: dict[str, list[float]] = {}
    for r in ok_u:
        by_s.setdefault(r.theme_sector, []).append(r.ret)
    r_univ = float(np.mean([r.ret for r in ok_u]))
    r_s = {s: float(np.mean(v)) for s, v in by_s.items()}
    w_u = {s: len(v) / len(ok_u) for s, v in by_s.items()}
    p_by: dict[str, list[float]] = {}
    for r in ok_p:
        p_by.setdefault(r.theme_sector, []).append(r.ret)
    w_p = {s: len(v) / len(ok_p) for s, v in p_by.items()}
    alloc = sum((w_p.get(s, 0.0) - w_u.get(s, 0.0)) * (r_s.get(s, r_univ) - r_univ) for s in set(w_u) | set(w_p))
    select = sum(w_p[s] * (float(np.mean(v)) - r_s.get(s, r_univ)) for s, v in p_by.items())
    exc = [r.ret - r_s.get(r.theme_sector, r_univ) for r in ok_p]
    return {"excess_vs_sector": float(np.mean(exc)), "batting_beat_sector": float(np.mean([e > 0 for e in exc])), "allocation": float(alloc),
            "selection": float(select), "r_univ_ew": r_univ, "sectors": {s: {"picks": len(p_by.get(s, [])), "w_pick": w_p.get(s, 0.0), "w_univ": w_u.get(s, 0.0),
                                                                       "r_sector": r_s.get(s), "r_picks": (float(np.mean(p_by[s])) if s in p_by else None)} for s in sorted(set(w_u) | set(w_p))}}
