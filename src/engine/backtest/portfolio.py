"""Holding-period returns per pick (total return), delisting handling, benchmark alignment, and the overlapping
8-sleeve portfolio equity curve."""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from ..store import read_df


@dataclass
class PickResult:
    security_id: str
    symbol: str
    formation: pd.Timestamp
    entry_date: pd.Timestamp | None
    exit_date: pd.Timestamp | None
    entry_px: float | None
    exit_px: float | None
    ret: float | None
    bench_ret: float | None
    status: str = "ok"           # ok | delisted_cash | no_prices | in_flight
    idea_strength: float | None = None
    angles: dict = field(default_factory=dict)
    action: str = ""
    sector: str | None = None


class PriceBook:
    """Total-return closes for the securities of a run, loaded once."""

    def __init__(self, security_ids: list[str], region: str = "US"):
        ids = ",".join("'" + s + "'" for s in set(security_ids))
        df = read_df("prices_daily", f"security_id IN ({ids})")
        df["date"] = pd.to_datetime(df["date"])
        self.tr = df.pivot_table(index="date", columns="security_id", values="close_tr").sort_index()
        b = read_df("benchmark_daily", "benchmark_id = 'SPY_TR'" if region == "US" else "benchmark_id = 'TOPIX_PR'")
        b["date"] = pd.to_datetime(b["date"])
        self.bench = b.set_index("date")["level"].sort_index()
        self.cal = self.bench.index
        self.today = self.cal.max()

    def entry_exit(self, formation: pd.Timestamp, hold_months: int) -> tuple[pd.Timestamp | None, pd.Timestamp | None, bool]:
        after = self.cal[self.cal > formation]
        if len(after) == 0:
            return None, None, False
        entry = after[0]
        target = formation + pd.DateOffset(months=hold_months)
        before = self.cal[self.cal <= target]
        exit_ = before[-1]
        in_flight = target > self.today
        return entry, exit_, in_flight

    def ret(self, sid: str, entry: pd.Timestamp, exit_: pd.Timestamp) -> tuple[float | None, float | None, float | None, str]:
        if sid not in self.tr.columns:
            return None, None, None, "no_prices"
        s = self.tr[sid].dropna()
        s_in = s[s.index >= entry]
        if s_in.empty:
            return None, None, None, "no_prices"
        p0 = float(s_in.iloc[0])
        s_win = s[(s.index >= entry) & (s.index <= exit_)]
        if s_win.empty:                       # first price only after the hold window: no return can be measured
            return None, None, None, "no_prices"
        p1 = float(s_win.iloc[-1])
        status = "ok"
        if s_win.index[-1] < exit_ - pd.Timedelta(days=10):
            status = "delisted_cash"        # series ended inside the hold: exit at last close, then cash (0%)
        return p0, p1, p1 / p0 - 1.0, status

    def bench_ret(self, entry: pd.Timestamp, exit_: pd.Timestamp) -> float | None:
        b = self.bench[(self.bench.index >= entry) & (self.bench.index <= exit_)]
        if len(b) < 2:
            return None
        return float(b.iloc[-1] / b.iloc[0] - 1.0)

    def path(self, sid: str, entry: pd.Timestamp, exit_: pd.Timestamp) -> pd.Series:
        if sid not in self.tr.columns:
            return pd.Series(dtype=float)
        s = self.tr[sid].dropna()
        s = s[(s.index >= entry) & (s.index <= exit_)]
        if s.empty:
            return s
        return s / s.iloc[0]


def evaluate_cohort(picks, formation: pd.Timestamp, hold_months: int, book: PriceBook) -> list[PickResult]:
    entry, exit_, in_flight = book.entry_exit(formation, hold_months)
    out = []
    for c in picks:
        if entry is None:
            out.append(PickResult(c.security_id, c.symbol, formation, None, None, None, None, None, None, "no_prices"))
            continue
        p0, p1, r, st = book.ret(c.security_id, entry, exit_)
        if in_flight and st == "ok":
            st = "in_flight"
        out.append(PickResult(c.security_id, c.symbol, formation, entry, exit_, p0, p1, r, book.bench_ret(entry, exit_), st,
                              idea_strength=c.idea_strength, angles={a.key: a.score for a in c.angles}, action=c.action, sector=c.sector))
    return out


def overlapping_curve(cohorts: dict[pd.Timestamp, list[PickResult]], book: PriceBook, hold_months: int, cadence_months: int = 3) -> pd.DataFrame:
    """8 sleeves (hold/cadence); sleeve k holds cohorts k, k+8, …; equal weight at entry, buy-and-hold, proceeds roll."""
    n_sleeves = max(1, hold_months // cadence_months)
    forms = sorted(cohorts)
    daily = pd.DataFrame(index=book.cal)
    sleeve_val = {}
    for i, f in enumerate(forms):
        k = i % n_sleeves
        picks = [p for p in cohorts[f] if p.entry_date is not None and p.status != "no_prices"]
        if not picks:
            continue
        entry, exit_ = picks[0].entry_date, picks[0].exit_date
        paths = []
        for p in picks:
            s = book.path(p.security_id, entry, exit_)
            if s.empty:
                continue
            s = s.reindex(daily.index[(daily.index >= entry) & (daily.index <= exit_)]).ffill()
            paths.append(s)
        if not paths:
            continue
        basket = pd.concat(paths, axis=1).mean(axis=1)
        start_val = sleeve_val.get(k, 1.0)
        col = f"sleeve{k}"
        if col not in daily:
            daily[col] = np.nan
        seg = basket * start_val
        daily.loc[seg.index, col] = seg.values
        sleeve_val[k] = float(seg.iloc[-1])
    daily = daily.ffill()
    live = daily.notna().sum(axis=1)
    daily["portfolio"] = daily.filter(like="sleeve").mean(axis=1)
    daily["n_live_sleeves"] = live
    daily["benchmark"] = book.bench.reindex(daily.index).ffill()
    return daily.dropna(subset=["portfolio"])
