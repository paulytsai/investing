"""Kelly position sizing for a cohort (and for the live board): per-name scenario Kelly from the DCF scenarios plus a
volatility-based worst case, and the portfolio Kelly w* = Σ⁻¹(μ − r_f·1) over the trailing return covariance so names
that share a driver (AI infrastructure, semis, oil, China, rates) are not sized as if independent. Point-in-time: only
prices and facts dated on or before the formation date are used."""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..frameworks.kelly import kelly_scenarios, portfolio_kelly


def confidence_of(c) -> tuple[float, str]:
    """Data confidence → Kelly-fraction multiplier (Paul: high 1.0 / medium 0.75 / low 0.5), from factor coverage and
    whether the DCF ran on reported free cash flow."""
    cov = float(getattr(c, "coverage", 0.0) or 0.0)
    dcf = (c.metrics or {}).get("dcf") or {}
    if cov >= 0.9 and dcf.get("scenarios"):
        return 1.0, "high"
    if cov >= 0.75 and dcf.get("scenarios"):
        return 0.75, "medium"
    return 0.5, "low"


def scenario_block(c, ann_vol: float | None, horizon_years: float, fraction: float, cap: float) -> dict | None:
    """Scenario Kelly for one name. Scenarios = the DCF bear/base/bull values vs price (return if price converges over the
    cycle); the bear return is floored at −1σ·√H from the name's own trailing volatility so a losing outcome always exists
    (a DCF bear case that is still above the price is not a worst outcome). Confidence scales the Kelly fraction."""
    dcf = (c.metrics or {}).get("dcf") or {}
    sc = dcf.get("scenarios") or {}
    if not sc or any(k not in sc for k in ("bear", "base", "bull")):
        return None
    conf, conf_label = confidence_of(c)
    vol_floor = -(ann_vol * np.sqrt(max(horizon_years, 0.25))) if ann_vol is not None and np.isfinite(ann_vol) else -0.35
    vol_floor = float(max(vol_floor, -0.90))
    rets = {"bear": min(float(sc["bear"]["upside_pct"]) / 100.0, vol_floor), "base": float(sc["base"]["upside_pct"]) / 100.0, "bull": float(sc["bull"]["upside_pct"]) / 100.0}
    rets = {k: float(np.clip(v, -0.95, 5.0)) for k, v in rets.items()}
    probs = {k: float(sc[k]["prob"]) for k in ("bear", "base", "bull")}
    k = kelly_scenarios([probs[x] for x in ("bear", "base", "bull")], [rets[x] for x in ("bear", "base", "bull")], fraction=fraction, cap=cap, confidence=conf)
    if not k:
        return None
    k["scenario_table"] = [{"name": n, "prob": probs[n], "return": rets[n], "source": ("DCF bear floored at −1σ·√H" if n == "bear" and rets[n] < float(sc["bear"]["upside_pct"]) / 100.0 - 1e-12 else "DCF scenario vs price")} for n in ("bear", "base", "bull")]
    k["horizon_years"] = horizon_years
    k["ann_vol"] = ann_vol
    k["confidence_label"] = conf_label
    k["mu_annual"] = float((1.0 + k["expected_return"]) ** (1.0 / max(horizon_years, 0.25)) - 1.0)
    return k


def trailing_stats(book, ids: list[str], as_of: pd.Timestamp, lookback_days: int = 250, shrink: float = 0.2) -> tuple[np.ndarray, dict[str, float]]:
    """Annualised covariance of daily total returns over the trailing window ending at as_of (PIT), with names lacking
    60 observations given the median variance and zero covariance; returns (Σ, {id: annual vol})."""
    px = book.tr.reindex(columns=ids)
    px = px[px.index <= as_of].tail(lookback_days)
    r = np.log(px).diff().dropna(how="all")
    n = len(ids)
    S = np.full((n, n), np.nan)
    have = [i for i, sid in enumerate(ids) if r[sid].notna().sum() >= 60] if len(r) else []
    if have:
        sub = r.iloc[:, have].dropna()
        if len(sub) >= 60:
            cov = np.cov(sub.values, rowvar=False) * 252.0
            cov = np.atleast_2d(cov)
            for a, i in enumerate(have):
                for b, j in enumerate(have):
                    S[i, j] = cov[a, b]
    med = float(np.nanmedian(np.diag(S))) if np.isfinite(np.nanmedian(np.diag(S))) else 0.09
    for i in range(n):
        if not np.isfinite(S[i, i]):
            S[i, :] = 0.0
            S[:, i] = 0.0
            S[i, i] = med
    S = np.nan_to_num(S, nan=0.0)
    vols = {sid: float(np.sqrt(S[i, i])) for i, sid in enumerate(ids)}
    return S, vols


def kelly_weights(picks: list, as_of: pd.Timestamp, book, hyp, horizon_years: float, rf_pct: float | None) -> dict:
    """Per-name scenario Kelly blocks and the portfolio Kelly weights for one cohort. Returns
    {weights: {id: w}, cash: 1−Σw, blocks: {id: block}, rf, params}. Weights are long-only, half-Kelly by default,
    capped per name, gross ≤ 100% (no leverage); the remainder is cash."""
    fraction = float(hyp.get("sizing.kelly.fraction"))
    cap = float(hyp.get("sizing.kelly.cap_pct")) / 100.0
    shrink = float(hyp.get("sizing.kelly.shrink"))
    lookback = int(hyp.get("sizing.kelly.lookback_days"))
    mu_cap = float(hyp.get("sizing.kelly.mu_cap_pct")) / 100.0
    rf = (float(rf_pct) / 100.0) if rf_pct is not None else 0.02
    ids = [c.security_id for c in picks]
    if not ids:
        return {"weights": {}, "cash": 1.0, "blocks": {}, "rf": rf}
    S, vols = trailing_stats(book, ids, as_of, lookback, shrink)
    blocks, mu, conf = {}, [], []
    for c in picks:
        b = scenario_block(c, vols.get(c.security_id), horizon_years, fraction, cap)
        blocks[c.security_id] = b
        if b is None:
            mu.append(rf)                      # no DCF → no edge assumed → zero Kelly weight
            conf.append(0.5)
        else:
            mu.append(float(np.clip(b["mu_annual"], -0.5, mu_cap)))
            conf.append(b["confidence"])
    mu_arr = np.array(mu)
    w = portfolio_kelly(mu_arr, S, rf=rf, fraction=fraction, cap=cap, gross_max=1.0, shrink=shrink)
    w = w * np.array(conf)                     # confidence reduces the Kelly fraction, never inflates the edge
    for i, c in enumerate(picks):             # a name whose own scenario Kelly is zero gets no weight either
        b = blocks.get(c.security_id)
        if b is not None and b["full"] <= 0:
            w[i] = 0.0
    weights = {sid: float(x) for sid, x in zip(ids, w)}
    return {"weights": weights, "cash": float(max(0.0, 1.0 - w.sum())), "blocks": blocks, "rf": rf, "mu": {sid: float(m) for sid, m in zip(ids, mu_arr)},
            "params": {"fraction": fraction, "cap": cap, "shrink": shrink, "lookback_days": lookback, "horizon_years": horizon_years}}
