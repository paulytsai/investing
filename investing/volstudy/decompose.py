"""Split log market value into log(multiple) + log(TTM fundamental).

    log V_t = log M_t + log F_t,      M_t = V_t / F_t

V is market cap, F is a trailing-twelve-month fundamental (net income ->
the P/E multiple; revenue -> P/S). F is point-in-time: a quarter's figure
enters only on its earnings-announcement date, so between announcements all
of the value change is multiple change and on announcement days the change
splits between the two.

Over any horizon the identity  dv = dm + df  gives

    Var(dv) = Var(dm) + Var(df) + 2 Cov(dm, df)
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from investing.volstudy import data

FUNDAMENTALS = {"ni": "netIncome", "oi": "operatingIncome", "ebitda": "ebitda", "rev": "revenue"}
TRADING_DAYS = 252


def announcement_dates(sym: str, inc: pd.DataFrame) -> pd.Series:
    """Map each fiscal quarter to the date the market learned it."""
    earn = data.earnings_dates(sym)
    out = []
    for period_end, filed in zip(inc["date"], inc["filingDate"]):
        hits = earn[(earn > period_end) & (earn <= period_end + pd.Timedelta(days=120))]
        if len(hits):
            out.append(hits[0])
        elif filed > period_end:
            out.append(filed)
        else:  # old rows where FMP sets filingDate = period end
            out.append(period_end + pd.Timedelta(days=45))
    return pd.Series(out, index=inc.index)


def ttm_fundamentals(sym: str) -> pd.DataFrame:
    """TTM fundamentals indexed by announcement date (non-positive -> NaN)."""
    inc = data.income(sym)
    inc["ann"] = announcement_dates(sym, inc)
    out = pd.DataFrame({"ann": inc["ann"], "period": inc["date"]})
    for key, col in FUNDAMENTALS.items():
        q = inc[col].astype(float).where(inc[col] != 0)  # 0 = missing in FMP
        ttm = q.rolling(4, min_periods=4).sum()
        out[key] = ttm.where(ttm > 0)
    out = out.sort_values("ann").drop_duplicates("ann", keep="last")
    return out.set_index("ann")


def daily_panel(sym: str) -> pd.DataFrame:
    """Daily log price return, log value, log fundamentals, log multiples."""
    px = data.prices(sym)
    mc = data.market_cap(sym).reindex(px.index).ffill()
    df = pd.DataFrame({"ret": np.log(px).diff(), "v": np.log(mc)})
    f = ttm_fundamentals(sym)
    earn = data.earnings_dates(sym)
    for key in FUNDAMENTALS:
        # value known from announcement date onward; align to trading days
        s = f[key].reindex(df.index.union(f.index)).ffill().reindex(df.index)
        df[f"f_{key}"] = np.log(s)
        df[f"m_{key}"] = df["v"] - df[f"f_{key}"]
    # announcement window: day of and day after (covers pre-open and post-close)
    pos = df.index.searchsorted(earn)
    flag = np.zeros(len(df), bool)
    for p in pos:
        flag[p : p + 2] = True
    df["earn_win"] = flag
    return df


def period_changes(panel: pd.DataFrame, freq: str = "QE") -> pd.DataFrame:
    """Changes of v, m, f sampled at period ends (default calendar quarter)."""
    cols = ["v"] + [f"{p}_{k}" for k in FUNDAMENTALS for p in ("m", "f")]
    lv = panel[cols].groupby(pd.Grouper(freq=freq)).last()
    ch = lv.diff()
    ch["ret"] = panel["ret"].groupby(pd.Grouper(freq=freq)).sum(min_count=1)
    return ch.dropna(subset=["v"])


def variance_decomp(ch: pd.DataFrame, key: str = "ni", periods_per_year: int = 4) -> dict:
    """Annualized vol of dv, dm, df and correlation, over the rows given."""
    x = ch[["v", f"m_{key}", f"f_{key}"]].dropna()
    if len(x) < 8:
        return {}
    a = periods_per_year
    sv, sm, sf = (x.std() * np.sqrt(a)).values
    rho = x[f"m_{key}"].corr(x[f"f_{key}"])
    return {
        "n": len(x),
        "vol_v": sv,
        "vol_m": sm,
        "vol_f": sf,
        "rho_mf": rho,
        "share_m": sm**2 / sv**2,
        "share_f": sf**2 / sv**2,
        "share_cov": 2 * rho * sm * sf / sv**2,
        "m_gt_f": sm > sf,
        # orthogonal split: dv = a + beta*df + e ; R^2 = share explained by fundamentals
        "beta_f": x["v"].cov(x[f"f_{key}"]) / x[f"f_{key}"].var(),
        "r2_f": x["v"].corr(x[f"f_{key}"]) ** 2,
    }
