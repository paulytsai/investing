"""Street (adjusted) EPS versions of the decomposition, and earnings response.

FMP's per-report ``epsActual`` is the adjusted "street" figure analysts
forecast (KO Q4-2017: 0.39 street vs -0.65 GAAP), and ``epsEstimated`` is the
consensus just before the report. Both are point-in-time at the
announcement date.

  * street_panel: log P = log(P / TTM street EPS) + log(TTM street EPS)
  * reactions:    per report, EPS surprise vs. the stock's 2-day move net of
                  SPY, the "exchange rate" from EPS news to price
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from investing.volstudy import data
from investing.volstudy import decompose as dc


def street_ttm(sym: str) -> pd.Series:
    """TTM street EPS indexed by announcement date (non-positive -> NaN)."""
    e = data.street_eps(sym)
    ttm = e["epsActual"].rolling(4, min_periods=4).sum()
    return pd.Series(ttm.where(ttm > 0).values, index=e["date"])


def street_panel(sym: str) -> pd.DataFrame:
    px = data.split_adj_close(sym)
    df = pd.DataFrame({"v": np.log(px)})
    f = street_ttm(sym)
    s = f.reindex(df.index.union(f.index)).ffill().reindex(df.index)
    df["f_st"] = np.log(s)
    df["m_st"] = df["v"] - df["f_st"]
    return df


def reactions(sym: str, spy: pd.Series | None = None) -> pd.DataFrame:
    """One row per report: surprise and 2-day market-adjusted reaction."""
    px = data.prices(sym)
    spy = data.prices("SPY") if spy is None else spy
    r = np.log(px).diff()
    rm = np.log(spy).diff().reindex(r.index)
    e = data.street_eps(sym).dropna(subset=["epsEstimated"])
    rows = []
    for _, x in e.iterrows():
        i = r.index.searchsorted(x["date"])
        if i < 1 or i + 2 > len(r):
            continue
        p_pre = px.iloc[i - 1]
        rows.append({
            "sym": sym, "date": x["date"], "act": x["epsActual"], "est": x["epsEstimated"],
            "surprise_pct": (x["epsActual"] - x["epsEstimated"]) / abs(x["epsEstimated"]) if x["epsEstimated"] else np.nan,
            "surprise_px": (x["epsActual"] - x["epsEstimated"]) / p_pre,
            "react": r.iloc[i : i + 2].sum() - rm.iloc[i : i + 2].sum(),
        })
    return pd.DataFrame(rows)
