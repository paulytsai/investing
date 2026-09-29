"""Universe membership at a formation date (survivorship-controlled)."""
from __future__ import annotations

import pandas as pd

from ..config import Hypotheses
from ..store import connect, has_table


def members(as_of, region: str = "US", hyp: Hypotheses | None = None, kind: str | None = None) -> pd.DataFrame:
    """Securities listed on as_of with PIT market cap ≥ floor and ≥ min_listing_days of history.
    Returns security_id, symbol, sector, industry, market_cap."""
    hyp = hyp or Hypotheses.load()
    kind = kind or hyp.get("universe.kind")
    floor = hyp.get("universe.cap_floor_usd" if region == "US" else "universe.cap_floor_jpy")
    min_days = int(hyp.get("universe.min_listing_days"))
    as_of = pd.Timestamp(as_of)
    if not has_table("universe_membership"):
        return pd.DataFrame(columns=["security_id", "symbol", "sector", "industry", "market_cap"])
    con = connect()
    q = f"""
    WITH m AS (
      SELECT u.security_id FROM universe_membership u
      WHERE u.region = '{region}' AND u.start_date <= DATE '{(as_of - pd.Timedelta(days=min_days)).date()}'
        AND (u.end_date IS NULL OR u.end_date > DATE '{as_of.date()}')
    ),
    cap AS (
      SELECT security_id, market_cap FROM (
        SELECT security_id, market_cap, row_number() OVER (PARTITION BY security_id ORDER BY date DESC) rn
        FROM market_cap_daily WHERE date <= DATE '{as_of.date()}' AND date >= DATE '{(as_of - pd.Timedelta(days=45)).date()}'
      ) WHERE rn = 1
    )
    SELECT s.security_id, s.symbol, s.sector, s.industry, cap.market_cap
    FROM m JOIN security_master s USING (security_id) JOIN cap USING (security_id)
    WHERE cap.market_cap >= {float(floor)} AND NOT coalesce(s.is_fund, false)
    """
    df = con.execute(q).df()
    if kind == "sp500_pit":
        df = df[df.symbol.isin(sp500_members(as_of))]
    return df.reset_index(drop=True)


def sp500_members(as_of) -> set[str]:
    """Reconstruct S&P 500 membership at as_of from FMP's historical constituent changes."""
    from ..connectors.fmp import FMP

    fmp = FMP()
    current = {r["symbol"] for r in fmp.sp500_current()}
    changes = fmp.sp500_history()
    as_of = pd.Timestamp(as_of)
    members_ = set(current)
    for ch in sorted(changes, key=lambda r: r.get("date", ""), reverse=True):
        d = pd.Timestamp(ch.get("date"))
        if d <= as_of:
            break
        # undo the change: remove what was added, add back what was removed
        if ch.get("symbol"):
            members_.discard(ch["symbol"])
        if ch.get("removedTicker"):
            members_.add(ch["removedTicker"])
    return members_
