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
    bench2_ret: float | None = None   # equal-weight benchmark (RSP total return) — fair for an equal-weight 20-name book
    theme_sector: str = "other"       # stage-1 sector of the name at formation (sector-adjusted excess, Brinson attribution)
    idea_strength: float | None = None
    angles: dict = field(default_factory=dict)
    action: str = ""
    sector: str | None = None
    weight: float | None = None       # Kelly weight at entry (None = equal weight only)
    exit_reason: str = "fixed hold"
    hold_years: float | None = None


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
        self.bench2 = None
        if region == "US":
            b2 = read_df("benchmark_daily", "benchmark_id = 'RSP_TR'")
            if not b2.empty:
                b2["date"] = pd.to_datetime(b2["date"])
                self.bench2 = b2.set_index("date")["level"].sort_index()
        self.cal = self.bench.index
        self.today = self.cal.max()

    def entry_exit(self, formation: pd.Timestamp, hold_months: int, target: pd.Timestamp | None = None) -> tuple[pd.Timestamp | None, pd.Timestamp | None, bool]:
        """Entry = first trading day after formation; exit = last trading day ≤ target (formation + hold_months unless a
        cycle-rule target is given). A target beyond today marks the position open (in flight, marked at the last close)."""
        after = self.cal[self.cal > formation]
        if len(after) == 0:
            return None, None, False
        entry = after[0]
        target = target if target is not None else formation + pd.DateOffset(months=hold_months)
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


def _bench2_ret(book: PriceBook, entry, exit_) -> float | None:
    if book.bench2 is None:
        return None
    s = book.bench2[(book.bench2.index >= entry) & (book.bench2.index <= exit_)]
    return float(s.iloc[-1] / s.iloc[0] - 1.0) if len(s) > 1 else None


def evaluate_cohort(picks, formation: pd.Timestamp, hold_months: int, book: PriceBook, exits: dict | None = None, weights: dict | None = None) -> list[PickResult]:
    """Holding returns per pick. `exits` = {theme_sector: {target, reason}} from the cycle rule (else fixed hold);
    `weights` = Kelly weights by security_id (else equal weight)."""
    out = []
    for c in picks:
        sec = getattr(c, "theme_sector", "other")
        ex = (exits or {}).get(sec)
        entry, exit_, in_flight = book.entry_exit(formation, hold_months, ex["target"] if ex else None)
        if entry is None:
            out.append(PickResult(c.security_id, c.symbol, formation, None, None, None, None, None, None, "no_prices", theme_sector=sec))
            continue
        p0, p1, r, st = book.ret(c.security_id, entry, exit_)
        if in_flight and st == "ok":
            st = "in_flight"
        out.append(PickResult(c.security_id, c.symbol, formation, entry, exit_, p0, p1, r, book.bench_ret(entry, exit_), st,
                              bench2_ret=_bench2_ret(book, entry, exit_), theme_sector=sec,
                              idea_strength=c.idea_strength, angles={a.key: a.score for a in c.angles}, action=c.action, sector=c.sector,
                              weight=(weights or {}).get(c.security_id), exit_reason=(ex["reason"] if ex else f"fixed {hold_months}m hold"),
                              hold_years=(exit_ - entry).days / 365.25))
    return out


def overlapping_curve(cohorts: dict[pd.Timestamp, list[PickResult]], book: PriceBook, hold_months: int, cadence_months: int = 3, weighted: bool = False) -> pd.DataFrame:
    """Portfolio of overlapping cohorts. Each cohort is a buy-and-hold basket (equal weight, or the Kelly weights with the
    remainder in cash) whose picks may exit on different dates (cycle rule): after a pick's exit its proceeds track the
    benchmark until the cohort's last exit (the same convention as an acquired name), so an early exit is a switch into
    the index, not years of idle cash. Capital is split equally across the cohorts live on each day, so the portfolio's
    daily return is the mean of the live baskets' daily returns — for a fixed hold this is the classic sleeve structure."""
    forms = sorted(cohorts)
    daily = pd.DataFrame(index=book.cal)
    basket_rets = []
    for f in forms:
        picks = [p for p in cohorts[f] if p.entry_date is not None and p.status != "no_prices"]
        if not picks:
            continue
        entry = min(p.entry_date for p in picks)
        last_exit = max(p.exit_date for p in picks)
        idx = daily.index[(daily.index >= entry) & (daily.index <= last_exit)]
        bench = book.bench.reindex(idx).ffill()
        paths, ws = [], []
        for p in picks:
            s = book.path(p.security_id, entry, p.exit_date)
            if s.empty:
                continue
            s = s.reindex(idx).ffill()
            after = idx > p.exit_date
            if after.any() and p.exit_date in bench.index and bench.loc[p.exit_date] > 0:
                s[after] = float(s.loc[p.exit_date]) * bench[after] / float(bench.loc[p.exit_date])   # proceeds track the benchmark
            paths.append(s)
            ws.append(float(p.weight) if (weighted and p.weight is not None) else 1.0)
        if not paths:
            continue
        W = np.array(ws)
        if weighted:
            cash = max(0.0, 1.0 - W.sum())
            basket = (pd.concat(paths, axis=1).values * W).sum(axis=1) + cash   # cash earns 0 (stated)
            basket = pd.Series(basket, index=idx)
        else:
            basket = pd.concat(paths, axis=1).mean(axis=1)
        basket_rets.append(basket.pct_change().rename(str(f.date())))
    if not basket_rets:
        return pd.DataFrame()
    R = pd.concat(basket_rets, axis=1).reindex(daily.index)
    live = R.notna().sum(axis=1)
    port_ret = R.mean(axis=1).fillna(0.0)
    daily["portfolio"] = (1.0 + port_ret).cumprod()
    daily["n_live_sleeves"] = live
    daily = daily[live.values > 0]
    daily["benchmark"] = book.bench.reindex(daily.index).ffill()
    return daily.dropna(subset=["portfolio"])
