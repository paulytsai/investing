"""Kelly criterion as a position-sizing algorithm: the fraction that maximises expected log growth of wealth given the
investor's own probability distribution of outcomes. Scenario form (bull/base/bear from the DCF, never the mean/variance
shortcut when scenarios exist), fractional Kelly, a practical cap, and the multi-asset form w* = Σ⁻¹(μ − r_f) so names
that share a driver are not sized as if independent. Pure functions; every number shown to Paul comes from these."""
from __future__ import annotations

import math

import numpy as np


def growth(f: float, probs: list[float], rets: list[float]) -> float:
    """G(f) = Σ p_i ln(1 + f r_i); −inf where any scenario wipes the portfolio."""
    g = 0.0
    for p, r in zip(probs, rets):
        x = 1.0 + f * r
        if x <= 0:
            return -math.inf
        g += p * math.log(x)
    return g


def kelly_scenarios(probs: list[float], rets: list[float], fraction: float = 0.5, cap: float = 0.15, f_max: float = 1.0,
                    confidence: float = 1.0, grid: int = 4001) -> dict:
    """Full Kelly by numerical search on [0, min(f_max, 1/|r_min| − ε)], then half/quarter Kelly and the practical position
    (fraction × f* × confidence, capped). Long-only: f* ≤ 0 → 0%. Returns every input so the output is auditable."""
    if not probs or len(probs) != len(rets):
        return {}
    ps = np.array(probs, dtype=float)
    ps = ps / ps.sum()
    rs = np.array(rets, dtype=float)
    er = float((ps * rs).sum())
    r_min = float(rs.min())
    upper = min(float(f_max), (-1.0 / r_min) * 0.999 if r_min < 0 else float(f_max))
    if upper <= 0:
        return {"expected_return": er, "worst": r_min, "full": 0.0, "half": 0.0, "quarter": 0.0, "practical": 0.0, "cap": cap, "fraction": fraction,
                "confidence": confidence, "note": "worst scenario wipes out any position"}
    # search the unconstrained domain (0, 1/|r_min|) first so the report can say when full Kelly would exceed 100%
    dom = (-1.0 / r_min) * 0.999 if r_min < 0 else max(4.0, float(f_max))
    fs = np.linspace(0.0, dom, grid)
    gs = np.array([growth(float(f), list(ps), list(rs)) for f in fs])
    i = int(np.nanargmax(gs))
    f_unc = float(fs[i]) if gs[i] > 0 else 0.0      # G(0) = 0: no allocation unless growth is positive somewhere
    if er <= 0:                                      # G'(0) = E[R]: no positive expectation → f* ≤ 0 → long-only 0%
        f_unc = 0.0
    f_star = min(f_unc, upper)
    practical = min(fraction * f_star * confidence, cap)
    return {"expected_return": er, "worst": r_min, "full": f_star, "full_unconstrained": f_unc, "half": 0.5 * f_star, "quarter": 0.25 * f_star,
            "practical": practical, "growth_at_full": growth(f_star, list(ps), list(rs)) if f_star > 0 else 0.0, "cap": cap, "fraction": fraction, "confidence": confidence,
            "scenarios": [{"prob": float(p), "return": float(r)} for p, r in zip(ps, rs)],
            "note": ("no long allocation: expected log growth is not positive" if f_star == 0.0 else
                     ("capped at the maximum position" if practical >= cap - 1e-12 else "")), "f_upper": upper}


def portfolio_kelly(mu: np.ndarray, sigma: np.ndarray, rf: float = 0.0, fraction: float = 0.5, cap: float = 0.15, gross_max: float = 1.0,
                    shrink: float = 0.2) -> np.ndarray:
    """Multi-asset Kelly w* = Σ⁻¹(μ − r_f·1) (annual, decimals), long-only, then fraction, per-name cap and a gross cap
    (no leverage). `shrink` blends Σ toward its diagonal (Ledoit-Wolf-style) so a 250-day estimate does not blow up."""
    mu = np.asarray(mu, dtype=float)
    S = np.asarray(sigma, dtype=float)
    n = len(mu)
    if n == 0:
        return np.zeros(0)
    d = np.diag(np.diag(S))
    Sh = (1 - shrink) * S + shrink * d + np.eye(n) * 1e-8
    try:
        w = np.linalg.solve(Sh, mu - rf)
    except np.linalg.LinAlgError:
        w = (mu - rf) / np.maximum(np.diag(S), 1e-8)
    w = np.clip(w, 0.0, None) * fraction
    w = np.minimum(w, cap)
    g = w.sum()
    if g > gross_max:
        w = w * (gross_max / g)
    return w
