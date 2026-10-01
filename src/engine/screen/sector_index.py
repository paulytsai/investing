"""Equal-weighted sector index and member price lines for the sector sections of the pitch report (R-23 sector call
first). Daily-rebalanced equal weight over the members' total-return closes — the same arithmetic as the backtest's
overlapping curve — rebased to 100 at the start of the window; SPY (TOPIX for Japan) total return as the reference."""
from __future__ import annotations

import pandas as pd

from ..store import read_df


def _pivot(security_ids: list[str], start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
    if not security_ids:
        return pd.DataFrame()
    ids = ",".join("'" + i + "'" for i in security_ids)
    px = read_df("prices_daily", f"security_id IN ({ids}) AND date >= DATE '{start.date()}' AND date <= DATE '{end.date()}'")
    if px.empty:
        return pd.DataFrame()
    px["date"] = pd.to_datetime(px["date"])
    return px.pivot_table(index="date", columns="security_id", values="close_tr", aggfunc="last").sort_index()


def equal_weight_index(tr: pd.DataFrame, min_members: int = 2) -> pd.Series:
    """Daily-rebalanced equal-weight index of the columns of `tr` (total-return closes), rebased to 100.
    A member counts from its first price; days with fewer than `min_members` live names are dropped."""
    if tr.empty:
        return pd.Series(dtype=float)
    rets = tr.pct_change(fill_method=None)
    live = tr.notna().sum(axis=1)
    r = rets.mean(axis=1, skipna=True).where(live >= min_members).dropna()
    if r.empty:
        return pd.Series(dtype=float)
    return (1 + r).cumprod() * 100


def rebased(s: pd.Series) -> pd.Series:
    s = s.dropna()
    if s.empty or s.iloc[0] <= 0:
        return pd.Series(dtype=float)
    return s / s.iloc[0] * 100


def sector_series(members: list, as_of: pd.Timestamp, years: int = 3, region: str = "US") -> dict:
    """members: candidates (objects or dicts) with security_id, symbol, market_cap. Returns
    {index: pd.Series (rebased 100), benchmark: pd.Series, lines: {symbol: pd.Series rebased}, n_members, start, end}."""
    def g(c, k):
        return c.get(k) if isinstance(c, dict) else getattr(c, k, None)

    start, end = as_of - pd.Timedelta(days=365 * years), as_of
    ids = [g(c, "security_id") for c in members if g(c, "security_id")]
    tr = _pivot(ids, start, end)
    index = equal_weight_index(tr) if not tr.empty else pd.Series(dtype=float)
    sym_of = {g(c, "security_id"): g(c, "symbol") for c in members}
    lines: dict[str, pd.Series] = {}
    for sid in tr.columns if not tr.empty else []:
        s = rebased(tr[sid])
        if not s.empty and len(s) > 20:
            lines[sym_of.get(sid, sid)] = s
    b = read_df("benchmark_daily", "benchmark_id = 'SPY_TR'" if region == "US" else "benchmark_id = 'TOPIX_PR'")
    bench = pd.Series(dtype=float)
    if not b.empty:
        b["date"] = pd.to_datetime(b["date"])
        bs = b.set_index("date")["level"].sort_index()
        bench = rebased(bs[(bs.index >= start) & (bs.index <= end)])
    return {"index": index, "benchmark": bench, "lines": lines, "n_members": len(ids), "start": start, "end": end,
            "benchmark_label": "S&P 500 (total return)" if region == "US" else "TOPIX"}


def member_table(members: list, lines: dict[str, pd.Series], weights: dict | None = None) -> list[dict]:
    """One row per member for the sector section: symbol, name, strength, action, 3-year return, P/E percentile, Kelly weight."""
    def g(c, k):
        return c.get(k) if isinstance(c, dict) else getattr(c, k, None)

    rows = []
    for c in members:
        sym = g(c, "symbol")
        s = lines.get(sym)
        m = g(c, "metrics") or {}
        rows.append({"symbol": sym, "name": g(c, "name"), "strength": g(c, "idea_strength"), "action": g(c, "action"), "rank": g(c, "rank"),
                     "ret_window": (float(s.iloc[-1]) / 100 - 1) if s is not None and not s.empty else None,
                     "pe_pctile": m.get("pe_own_pctile"), "pe": m.get("pe_ttm"), "market_cap": g(c, "market_cap"),
                     "cycle_phase": (m.get("valuation_cycle") or {}).get("phase"),
                     "weight": (weights or {}).get(g(c, "security_id")), "eligible": g(c, "eligible")})
    rows.sort(key=lambda r: -(r["strength"] or -1))
    return rows
