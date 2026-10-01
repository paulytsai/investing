"""Ex-ante vol features and forward realized-vol targets for one stock.

Between earnings announcements the TTM fundamental is constant, so every
daily return is a change in the multiple. That gives a clean daily split:

  * diffusive / multiple variance: squared returns on non-announcement days
  * fundamental-news (jump) variance: excess squared return in the 2-day
    window around each announcement

plus slow-moving accounting features from the quarterly decomposition
(trailing vol of TTM revenue / operating income, and of the multiple).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from investing.volstudy import data
from investing.volstudy import decompose as dc

ANN = dc.TRADING_DAYS


def _rv(r2: pd.Series, w: int, minp: float = 0.6) -> pd.Series:
    return np.sqrt(ANN * r2.rolling(w, min_periods=int(w * minp)).mean())


def _fwd_rv(r2: pd.Series, h: int) -> pd.Series:
    """Annualized realized vol over days t+1..t+h."""
    return np.sqrt(ANN * r2[::-1].rolling(h, min_periods=h).mean()[::-1].shift(-1))


def jump_var(panel: pd.DataFrame, n_last: int = 8) -> pd.Series:
    """Trailing mean excess variance of the 2-day announcement window
    (daily series, known as of each date), in daily-variance units."""
    r2 = panel["ret"] ** 2
    base = r2.where(~panel["earn_win"]).rolling(63, min_periods=30).mean()
    win = panel["earn_win"].astype(int)
    starts = panel.index[(win.diff() == 1).values]
    vals = {}
    for d in starts:
        i = panel.index.get_loc(d)
        if i + 2 > len(panel):
            continue
        j2 = r2.iloc[i : i + 2].sum() - 2 * base.iloc[i - 1] if i > 0 else np.nan
        vals[panel.index[min(i + 1, len(panel) - 1)]] = j2  # known after window
    s = pd.Series(vals).sort_index()
    s = s.rolling(n_last, min_periods=4).mean().clip(lower=0)
    return s.reindex(panel.index.union(s.index)).ffill().reindex(panel.index)


def earnings_within(panel: pd.DataFrame, h: int) -> pd.Series:
    """1 if an announcement window starts within the next h trading days."""
    start = (panel["earn_win"].astype(int).diff() == 1).astype(float)
    return (start[::-1].rolling(h, min_periods=1).max()[::-1].shift(-1) > 0).astype(float)


def quarterly_features(panel: pd.DataFrame, nq: int = 12) -> pd.DataFrame:
    ch = dc.period_changes(panel, "QE")
    q = pd.DataFrame(index=ch.index)
    for key in ("rev", "oi", "ni"):
        q[f"sf_{key}"] = ch[f"f_{key}"].rolling(nq, min_periods=8).std() * 2
        q[f"sm_{key}"] = ch[f"m_{key}"].rolling(nq, min_periods=8).std() * 2
    return q


def build(sym: str, horizons: tuple[int, ...] = (21, 63)) -> pd.DataFrame:
    p = dc.daily_panel(sym)
    r2 = p["ret"] ** 2
    r2d = r2.where(~p["earn_win"])  # multiple-only days
    f = pd.DataFrame(index=p.index)
    for w in (21, 63, 252):
        f[f"rv{w}"] = _rv(r2, w)
        f[f"dv{w}"] = _rv(r2d, w)
    f["jv"] = np.sqrt(ANN * jump_var(p))  # annualized jump size (vol units)
    # multiple level vs own 5y history (P/S z-score)
    m = p["m_rev"]
    f["mz"] = (m - m.rolling(1260, min_periods=500).mean()) / m.rolling(1260, min_periods=500).std()
    q = quarterly_features(p)
    # point-in-time already: F only changes on announcement dates
    f = f.join(q.reindex(f.index.union(q.index)).ffill().reindex(f.index))
    for h in horizons:
        f[f"earn{h}"] = earnings_within(p, h)
        f[f"y{h}"] = _fwd_rv(r2, h)
        f[f"yd{h}"] = _fwd_rv(r2d.fillna(r2d.rolling(63, min_periods=20).mean()), h)
    f["sym"] = sym
    f["sector"] = data.sector(sym)
    return f
