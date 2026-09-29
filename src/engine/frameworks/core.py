"""Spec §8.5 calculators: valuation band (F-13), PEG (F-14), move decomposition (F-12), operating leverage
(F-81), hurdle (F-18), asymmetry (F-76), receipts (F-40/F-41), returns (CAGR and simple, §5.4)."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd


def safe_div(a, b):
    try:
        if a is None or b is None or b == 0 or (isinstance(b, float) and math.isnan(b)):
            return None
        return float(a) / float(b)
    except (TypeError, ValueError):
        return None


def growth(cur, prev):
    """YoY growth; None when the base is non-positive (a sign flip is not growth)."""
    if cur is None or prev is None or prev <= 0:
        return None
    return cur / prev - 1.0


def cagr(end_value, start_value, years: float):
    if end_value is None or start_value is None or start_value <= 0 or end_value <= 0 or years <= 0:
        return None
    return (end_value / start_value) ** (1.0 / years) - 1.0


def returns_pair(cum_return: float, years: float) -> dict:
    """Both conventions side by side (spec §5.4: Paul's 年率 = simple)."""
    if years <= 0:
        return {"cagr": None, "simple": None}
    return {"cagr": (1.0 + cum_return) ** (1.0 / years) - 1.0 if cum_return > -1 else -1.0, "simple": cum_return / years}


# ---- F-13 own-history valuation band ----------------------------------------------------------
def band_percentile(series: pd.Series, current: float | None, lookback_years: int = 10) -> dict:
    """Percentile of `current` within the last `lookback_years` of `series` (positive values only)."""
    if current is None or series is None or series.empty:
        return {"percentile": None, "low": None, "median": None, "high": None, "n": 0}
    s = series.dropna()
    s = s[s > 0]
    if s.empty:
        return {"percentile": None, "low": None, "median": None, "high": None, "n": 0}
    cutoff = s.index.max() - pd.Timedelta(days=365 * lookback_years)
    s = s[s.index >= cutoff]
    if len(s) < 60:
        return {"percentile": None, "low": float(s.quantile(0.1)), "median": float(s.median()), "high": float(s.quantile(0.9)), "n": len(s)}
    pct = float((s < current).mean() * 100)
    return {"percentile": pct, "low": float(s.quantile(0.1)), "median": float(s.median()), "high": float(s.quantile(0.9)), "n": len(s)}


# ---- F-14 PEG ------------------------------------------------------------------------------------
def peg(pe: float | None, growth_pct: float | None):
    if pe is None or growth_pct is None or pe <= 0 or growth_pct <= 0:
        return None
    return pe / growth_pct


# ---- F-12 move decomposition: Δln P = Δln EPS + Δln multiple --------------------------------------
def move_decomposition(p0, p1, e0, e1) -> dict:
    out = {"dln_p": None, "dln_eps": None, "dln_mult": None, "f_eps": None, "f_mult": None, "basis": "none"}
    if not p0 or not p1 or p0 <= 0 or p1 <= 0:
        return out
    dln_p = math.log(p1 / p0)
    out["dln_p"] = dln_p
    if e0 and e1 and e0 > 0 and e1 > 0:
        dln_e = math.log(e1 / e0)
        out.update({"dln_eps": dln_e, "dln_mult": dln_p - dln_e, "basis": "pe"})
        if abs(dln_p) > 1e-9:
            out["f_eps"] = dln_e / dln_p
            out["f_mult"] = 1.0 - dln_e / dln_p
    return out


# ---- F-81 operating leverage -----------------------------------------------------------------------
def operating_leverage(oi_now, oi_prev, rev_now, rev_prev) -> dict:
    d_rev = None if rev_now is None or rev_prev is None else rev_now - rev_prev
    d_oi = None if oi_now is None or oi_prev is None else oi_now - oi_prev
    incremental = safe_div(d_oi, d_rev) if d_rev and d_rev > 0 else None
    margin = safe_div(oi_now, rev_now)
    # ±1% revenue scenario at the incremental margin → EPS impact (as % of operating income)
    eps_impact_pct = None
    if incremental is not None and oi_now and oi_now > 0 and rev_now:
        eps_impact_pct = incremental * 0.01 * rev_now / oi_now * 100
    return {"incremental_margin": incremental, "operating_margin": margin, "eps_impact_per_1pct_rev": eps_impact_pct}


# ---- F-18 hurdle ------------------------------------------------------------------------------------
def hurdle_test(expected_return_pct: float | None, risk_free_pct: float | None, margin_pct: float) -> dict:
    if expected_return_pct is None or risk_free_pct is None:
        return {"passes": None, "hurdle_pct": None, "gap_pct": None}
    h = risk_free_pct + margin_pct
    return {"passes": expected_return_pct > h, "hurdle_pct": h, "gap_pct": expected_return_pct - h}


# ---- F-76 asymmetry -----------------------------------------------------------------------------------
def asymmetry(price: float | None, upside_ref: float | None, floor_ref: float | None) -> dict:
    if not price or price <= 0:
        return {"upside_pct": None, "downside_pct": None, "ratio": None}
    up = None if upside_ref is None else (upside_ref / price - 1.0) * 100
    dn = None if floor_ref is None else (1.0 - floor_ref / price) * 100
    ratio = safe_div(up, dn) if up is not None and dn is not None and dn > 0 else None
    return {"upside_pct": up, "downside_pct": dn, "ratio": ratio}


# ---- F-40 / F-41 receipts ------------------------------------------------------------------------------
def receipts(rpo: float | None, capex_annual: float | None, fcf: float | None) -> dict:
    ratio = safe_div(rpo, abs(capex_annual) if capex_annual else None)
    return {"receipts_ratio": ratio, "fcf_positive_during_capex": (fcf is not None and fcf > 0) if capex_annual else None}


# ---- z-scores / percentiles ----------------------------------------------------------------------------
def winsorize(s: pd.Series, pct: float = 2.5) -> pd.Series:
    if s.dropna().empty:
        return s
    lo, hi = np.nanpercentile(s.dropna(), pct), np.nanpercentile(s.dropna(), 100 - pct)
    return s.clip(lower=lo, upper=hi)


def zscore(s: pd.Series, pct: float = 2.5) -> pd.Series:
    w = winsorize(s.astype(float), pct)
    sd = w.std(ddof=0)
    if sd is None or sd == 0 or np.isnan(sd):
        return pd.Series(0.0, index=s.index).where(s.notna())
    return (w - w.mean()) / sd


def percentile_rank(s: pd.Series) -> pd.Series:
    return s.rank(pct=True) * 100
