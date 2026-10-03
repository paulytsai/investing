"""Option-implied and valuation-implied earnings expectations.

Option side (from at-the-money quotes across expiries):
    total implied variance to expiry T:  w(T) = s_d^2 * T + n(T) * J^2
    s_d = implied normal-day ("multiple") vol, J = implied earnings-day move,
    n(T) = number of earnings reports before T. Fit by non-negative least
    squares across the PRE / POST / ~6m / ~1y expiries.

Valuation side (reverse DCF on consensus street EPS):
    price = PV of cash returned to shareholders, where EPS follows consensus
    for the years analysts cover, then grows at g until year 10, then 3%
    forever. Solve for g: the growth the price is "pricing in".
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import brentq, nnls
from scipy.stats import norm

from investing.volstudy import data

RF_1Y = 0.0444    # FRED DGS1, 2026-10-01
RF_10Y = 0.0524   # FRED DGS10, 2026-10-01
ERP = 0.05        # equity risk premium assumption
G_TERMINAL = 0.03
HORIZON = 10
QUARTER_DAYS = 91


# ---------- option side ----------

def black76(F: float, K: float, T: float, vol: float, df: float, call: bool) -> float:
    if vol <= 0 or T <= 0:
        return df * max((F - K) if call else (K - F), 0.0)
    d1 = (math.log(F / K) + 0.5 * vol * vol * T) / (vol * math.sqrt(T))
    d2 = d1 - vol * math.sqrt(T)
    if call:
        return df * (F * norm.cdf(d1) - K * norm.cdf(d2))
    return df * (K * norm.cdf(-d2) - F * norm.cdf(-d1))


def implied_vol(price: float, F: float, K: float, T: float, df: float, call: bool) -> float:
    intrinsic = df * max((F - K) if call else (K - F), 0.0)
    if not price or price <= intrinsic + 1e-6:
        return float("nan")
    return brentq(lambda v: black76(F, K, T, v, df, call) - price, 1e-4, 5.0)


def leg_iv(leg: dict, asof: pd.Timestamp, r: float = RF_1Y) -> dict:
    """ATM implied vol from call/put mids; forward from put-call parity."""
    T = (pd.Timestamp(leg["expiry"]) - asof).days / 365.0
    mids = {}
    for side in ("call", "put"):
        b, a = leg.get(f"{side}_bid"), leg.get(f"{side}_ask")
        mids[side] = (b + a) / 2 if b and a and a >= b else None
    if T <= 0 or not mids["call"] or not mids["put"]:
        return {"T": T, "iv": float("nan")}
    K = float(leg["strike"])
    df = math.exp(-r * T)
    F = K + (mids["call"] - mids["put"]) / df
    ivc = implied_vol(mids["call"], F, K, T, df, True)
    ivp = implied_vol(mids["put"], F, K, T, df, False)
    return {"T": T, "F": F, "K": K, "iv": np.nanmean([ivc, ivp]), "iv_call": ivc, "iv_put": ivp}


def fit_term_structure(row: dict, asof: pd.Timestamp, extra_legs: list[dict] | None = None) -> dict:
    """Implied earnings move from the expiries either side of the report.

    w_POST = s^2 * T_POST + J^2 with s = the pre-earnings expiry's vol, so
    J^2 = T_POST * (iv_POST^2 - iv_PRE^2). The ~1y expiry gives total 1y vol;
    removing its n earnings jumps leaves the implied normal-day vol. If no
    pre-earnings quote exists, fall back to a least-squares fit across all
    expiries (flagged).
    """
    e1 = pd.Timestamp(row["earnings"])
    pts = []
    for leg in list(row["legs"]) + list(extra_legs or []):
        if not leg.get("expiry"):
            continue
        x = leg_iv(leg, asof)
        if not np.isfinite(x["iv"]):
            continue
        exp = pd.Timestamp(leg["expiry"])
        n = sum(1 for k in range(8) if e1 + pd.Timedelta(days=QUARTER_DAYS * k) <= exp)
        pts.append({"tag": leg["tag"], "expiry": exp, "T": x["T"], "iv": x["iv"], "n": n})
    pts = pd.DataFrame(pts).sort_values("T")
    pre = pts[(pts["n"] == 0)]
    post = pts[(pts["n"] == 1)].head(1)
    long = pts.iloc[-1]
    if len(pre) and len(post):
        p0, p1 = pre.iloc[-1], post.iloc[0]
        j2 = max(p1["T"] * (p1["iv"] ** 2 - p0["iv"] ** 2), 0.0)
        method, short_vol = "pre/post", p0["iv"]
    else:
        A = pts[["T", "n"]].values
        (a, j2), _ = nnls(A, (pts["iv"] ** 2 * pts["T"]).values)
        method, short_vol = "term fit", math.sqrt(a)
    sd_long = math.sqrt(max(long["iv"] ** 2 * long["T"] - long["n"] * j2, 0.0) / long["T"])
    return {
        "jump": math.sqrt(j2), "short_vol": short_vol, "vol_1y": long["iv"], "T_long": long["T"],
        "sigma_d_1y": sd_long, "n_long": int(long["n"]), "method": method,
        "ivs": {r.tag: round(r.iv, 4) for r in pts.itertuples()},
    }


# ---------- valuation side ----------

def beta(sym: str, years: int = 5) -> float:
    """Weekly beta vs SPY over the last few years, shrunk toward 1."""
    a = np.log(data.prices(sym)).resample("W").last().diff()
    m = np.log(data.prices("SPY")).resample("W").last().diff()
    d = pd.concat([a, m], axis=1).dropna().iloc[-52 * years :]
    b = d.cov().iloc[0, 1] / d.iloc[:, 1].var()
    return float(np.clip(0.67 * b + 0.33, 0.5, 1.8))


def payout_ratio(sym: str) -> float:
    """(Dividends + net buybacks) / net income over the last three fiscal years."""
    cf = data.cash_flow(sym).tail(3)
    paid = -(cf["commonDividendsPaid"].fillna(0) + cf["netCommonStockIssuance"].fillna(0)).sum()
    ni = cf["netIncome"].sum()
    return float(np.clip(paid / ni if ni > 0 else 0.6, 0.3, 1.0))


def consensus_path(sym: str, asof: pd.Timestamp, min_analysts: int = 5) -> pd.DataFrame:
    """Consensus EPS for fiscal years ending after asof, while coverage is decent."""
    e = data.estimates(sym)
    e = e[e["date"] > asof]
    keep = []
    for _, r in e.iterrows():
        if (r.get("numAnalystsEps") or 0) < min_analysts and keep:
            break
        keep.append(r)
    return pd.DataFrame(keep)[["date", "epsAvg", "epsLow", "epsHigh", "numAnalystsEps"]].reset_index(drop=True)


def annual_path(cons: pd.DataFrame, asof: pd.Timestamp, col: str = "epsAvg") -> list[float]:
    """EPS for the 12 months ending asof + 1y, + 2y, ... by log-interpolating
    fiscal-year consensus. Stops at the last covered fiscal year."""
    t = ((cons["date"] - asof).dt.days / 365.25).values
    y = np.log(cons[col].clip(lower=1e-6).values)
    out, k = [], 1
    while k <= t[-1] + 0.1:  # a fiscal year ending days short of the mark still counts
        out.append(float(np.exp(np.interp(k, t, y))))
        k += 1
    return out


def dcf_value(eps_path: list[float], g: float, r: float, payout: float) -> float:
    """PV of payout*EPS. EPS follows consensus, then grows at g to year 10,
    then G_TERMINAL forever. Payout fades linearly from today's level to the
    steady-state 1 - G_TERMINAL / r (a mature firm reinvesting just enough
    to grow at G_TERMINAL with returns equal to its cost of capital)."""
    eps = list(eps_path)
    while len(eps) < HORIZON:
        eps.append(eps[-1] * (1 + g))
    p_ss = 1 - G_TERMINAL / r
    pv = 0.0
    for t, x in enumerate(eps):
        po = payout + (p_ss - payout) * t / (HORIZON - 1)
        pv += po * x / (1 + r) ** (t + 1)
    tv = p_ss * eps[-1] * (1 + G_TERMINAL) / (r - G_TERMINAL)
    return pv + tv / (1 + r) ** HORIZON


def implied_growth(price: float, eps_path: list[float], r: float, payout: float) -> float:
    f = lambda g: dcf_value(eps_path, g, r, payout) - price
    lo, hi = -0.30, 0.80
    if f(lo) > 0:
        return lo
    if f(hi) < 0:
        return hi
    return brentq(f, lo, hi)


def hist_eps_cagr(sym: str, years: int = 10) -> float:
    ttm = data.street_eps(sym).set_index("date")["epsActual"].rolling(4).sum().dropna()
    now, past = ttm.iloc[-1], ttm[ttm.index <= ttm.index[-1] - pd.DateOffset(years=years)]
    if past.empty or past.iloc[-1] <= 0 or now <= 0:
        return float("nan")
    return (now / past.iloc[-1]) ** (1 / years) - 1
