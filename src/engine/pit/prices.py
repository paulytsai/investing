"""Price series: split-adjusted (valuation) and total-return (returns) closes."""
from __future__ import annotations

import pandas as pd


def split_factor(index: pd.DatetimeIndex, splits: list[dict]) -> pd.Series:
    """Cumulative factor of splits that occur AFTER each date (raw = adjusted × factor)."""
    factor = pd.Series(1.0, index=index)
    for sp in splits or []:
        d = pd.Timestamp(sp["date"])
        num, den = float(sp.get("numerator") or 1), float(sp.get("denominator") or 1)
        if den == 0 or num == 0:
            continue
        factor[factor.index < d] *= num / den
    return factor


def frame_from_fmp(symbol: str, full: list[dict], divadj: list[dict], splits: list[dict], security_id: str, source: str = "fmp") -> pd.DataFrame:
    if not full:
        return pd.DataFrame(columns=["security_id", "date", "close_raw", "close_adj", "close_tr", "volume", "source"])
    # FMP /stable `close` is already split-adjusted (verified: NVDA 2020-06-30 = 9.50 post 40x). Reconstruct raw.
    raw = pd.DataFrame(full)[["date", "close", "volume"]].rename(columns={"close": "close_adj"})
    raw["date"] = pd.to_datetime(raw["date"])
    raw = raw.drop_duplicates("date").sort_values("date")
    out = raw.set_index("date")
    out["close_adj"] = out["close_adj"].astype(float)
    out["close_raw"] = out["close_adj"] * split_factor(out.index, splits)
    if divadj:
        d = pd.DataFrame(divadj)
        d["date"] = pd.to_datetime(d["date"])
        tr = d.drop_duplicates("date").set_index("date")["adjClose"].astype(float)
        out["close_tr"] = tr.reindex(out.index)
        # dividend-adjusted series is rebased to today; fill gaps by carrying the ratio to close_adj
        ratio = (out["close_tr"] / out["close_adj"]).ffill().bfill()
        out["close_tr"] = out["close_tr"].fillna(out["close_adj"] * ratio)
    else:
        out["close_tr"] = out["close_adj"]
    out = out.reset_index()
    out["security_id"] = security_id
    out["source"] = source
    return out[["security_id", "date", "close_raw", "close_adj", "close_tr", "volume", "source"]]


def weekly(series: pd.Series) -> pd.Series:
    """Last close of each ISO week."""
    return series.resample("W-FRI").last().dropna()


def drawdown(series: pd.Series) -> pd.Series:
    peak = series.cummax()
    return series / peak - 1.0
