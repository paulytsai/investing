"""`snapshot()` — the single look-ahead guard. Returns only facts with available_from ≤ as_of, first-filed
wins, TTM aggregation, staleness. Vectorized `snapshot_all()` for a formation date across the universe."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import timedelta

import numpy as np
import pandas as pd

from ..config import sources
from ..store import connect, has_table, read_df
from .fields import FLOW_FIELDS, STOCK_FIELDS

TTM_LOOKBACK_DAYS = 550


@dataclass
class Snapshot:
    security_id: str
    as_of: pd.Timestamp
    metrics: dict[str, float | None] = field(default_factory=dict)
    period_end: pd.Timestamp | None = None
    basis: str = "TTM"
    stale: bool = False
    n_quarters: int = 0
    prior_ttm: dict[str, float | None] = field(default_factory=dict)
    fy_history: pd.DataFrame | None = None
    q_rows: pd.DataFrame | None = None   # visible quarterly rows (period_end, field, value, available_from)
    currency: str | None = None          # reporting currency of the latest visible statements (ADRs may report in ARS, BRL, …)

    def eps_ttm_series(self) -> pd.Series:
        """TTM diluted EPS keyed by the date each quarter became visible (available_from) — for P/E history."""
        return self.ttm_series("eps_diluted")

    def ttm_series(self, field_: str) -> pd.Series:
        """Rolling 4-quarter sum of a flow field keyed by available_from (point-in-time)."""
        if self.q_rows is None or self.q_rows.empty:
            return pd.Series(dtype=float)
        q = self.q_rows[self.q_rows.field == field_].sort_values("period_end")
        if q.empty:
            return pd.Series(dtype=float)
        q = q.drop_duplicates("period_end")
        ttm = q["value"].rolling(4).sum()
        s = pd.Series(ttm.values, index=pd.to_datetime(q["available_from"]).values).dropna()
        return s[~s.index.duplicated(keep="last")].sort_index()

    def level_series(self, field_: str) -> pd.Series:
        """Latest value of a level field (e.g. shares_diluted) keyed by available_from (point-in-time)."""
        if self.q_rows is None or self.q_rows.empty:
            return pd.Series(dtype=float)
        q = self.q_rows[self.q_rows.field == field_].sort_values("period_end").drop_duplicates("period_end")
        if q.empty:
            return pd.Series(dtype=float)
        s = pd.Series(q["value"].values, index=pd.to_datetime(q["available_from"]).values).dropna()
        return s[~s.index.duplicated(keep="last")].sort_index()


def _visible(as_of: pd.Timestamp, security_ids: list[str] | None = None) -> pd.DataFrame:
    """First-filed fundamentals visible on as_of (long form)."""
    if not has_table("fundamentals_long"):
        return pd.DataFrame()
    con = connect()
    where = f"available_from <= DATE '{as_of.date()}'"
    if security_ids:
        ids = ",".join("'" + s + "'" for s in security_ids)
        where += f" AND security_id IN ({ids})"
    q = f"""
    WITH vis AS (SELECT * FROM fundamentals_long WHERE {where}),
    ff AS (SELECT *, row_number() OVER (PARTITION BY security_id, statement, period_type, period_end, field
                                        ORDER BY available_from, restatement_rank) AS rn FROM vis)
    SELECT security_id, statement, period_type, period_end, field, value, available_from, lag_imputed, currency FROM ff WHERE rn = 1
    """
    df = con.execute(q).df()
    df["period_end"] = pd.to_datetime(df["period_end"])
    return df


def _ttm_from_quarters(q: pd.DataFrame, as_of: pd.Timestamp) -> tuple[dict, pd.Timestamp | None, int]:
    """q: rows (period_end, field, value) of period_type Q for one security; returns TTM sums for flow fields."""
    if q.empty:
        return {}, None, 0
    piv = q.pivot_table(index="period_end", columns="field", values="value", aggfunc="first").sort_index()
    piv = piv[piv.index >= as_of - timedelta(days=TTM_LOOKBACK_DAYS)]
    if piv.empty:
        return {}, None, 0
    last4 = piv.tail(4)
    out: dict = {}
    for f in piv.columns:
        if f in FLOW_FIELDS:
            vals = last4[f].dropna()
            out[f] = float(vals.sum()) if len(vals) == 4 else (float(vals.sum()) * 4 / len(vals) if len(vals) >= 2 else None)
            if len(vals) < 4:
                out[f"{f}__partial"] = len(vals)
        else:
            v = last4[f].dropna()
            out[f] = float(v.iloc[-1]) if len(v) else None
    return out, piv.index[-1], len(last4)


def _prior_ttm(q: pd.DataFrame, end: pd.Timestamp) -> dict:
    piv = q.pivot_table(index="period_end", columns="field", values="value", aggfunc="first").sort_index()
    prior = piv[piv.index <= end - timedelta(days=350)].tail(4)
    if len(prior) < 4:
        return {}
    return {f: float(prior[f].sum()) for f in prior.columns if f in FLOW_FIELDS and prior[f].notna().sum() == 4}


def _synthesize_q4(q: pd.DataFrame, fy: pd.DataFrame) -> pd.DataFrame:
    """Add Q4 = FY − (Q1+Q2+Q3) rows where FY is visible but the fourth quarter is not (flow fields only)."""
    if fy.empty or q.empty:
        return q
    qp = q.pivot_table(index="period_end", columns="field", values="value", aggfunc="first").sort_index()
    fp = fy.pivot_table(index="period_end", columns="field", values="value", aggfunc="first").sort_index()
    add = []
    for pe, row in fp.iterrows():
        if pe in qp.index:
            continue
        prev = qp[(qp.index < pe) & (qp.index >= pe - timedelta(days=300))]
        if len(prev) != 3:
            continue
        for f in fp.columns:
            if f in FLOW_FIELDS and pd.notna(row[f]) and prev[f].notna().all():
                add.append({"period_end": pe, "field": f, "value": float(row[f]) - float(prev[f].sum())})
            elif f in STOCK_FIELDS and pd.notna(row[f]):
                add.append({"period_end": pe, "field": f, "value": float(row[f])})
    if add:
        q = pd.concat([q[["period_end", "field", "value"]], pd.DataFrame(add)], ignore_index=True)
    return q


def build_snapshot(security_id: str, as_of: pd.Timestamp, vis: pd.DataFrame) -> Snapshot:
    stale_days = int(sources()["lags"]["stale_days"])
    snap = Snapshot(security_id=security_id, as_of=as_of)
    q = vis[(vis.security_id == security_id) & (vis.period_type == "Q")][["period_end", "field", "value"]]
    fy = vis[(vis.security_id == security_id) & (vis.period_type == "FY")][["period_end", "field", "value"]]
    q = _synthesize_q4(q, fy)
    ttm, end, n = _ttm_from_quarters(q, as_of)
    if n >= 2 and end is not None:
        snap.metrics, snap.period_end, snap.n_quarters = ttm, end, n
        snap.basis = "TTM" if n == 4 else "TTM_partial"
        snap.prior_ttm = _prior_ttm(q, end)
    elif not fy.empty:
        piv = fy.pivot_table(index="period_end", columns="field", values="value", aggfunc="first").sort_index()
        last = piv.iloc[-1]
        snap.metrics = {f: (float(v) if pd.notna(v) else None) for f, v in last.items()}
        snap.period_end, snap.basis, snap.n_quarters = piv.index[-1], "FY", 0
        if len(piv) >= 2:
            snap.prior_ttm = {f: float(v) for f, v in piv.iloc[-2].items() if pd.notna(v)}
    if snap.period_end is None or (as_of - snap.period_end).days > stale_days:
        snap.stale = True
    if not fy.empty:
        snap.fy_history = fy.pivot_table(index="period_end", columns="field", values="value", aggfunc="first").sort_index()
    snap.q_rows = vis[(vis.security_id == security_id) & (vis.period_type == "Q")][["period_end", "field", "value", "available_from"]]
    if "currency" in vis.columns:
        cur = vis[(vis.security_id == security_id) & (vis.field == "revenue")].sort_values("period_end")["currency"].dropna()
        snap.currency = str(cur.iloc[-1]).upper() if len(cur) else None
    return snap


def snapshot(security_id: str, as_of) -> Snapshot:
    as_of = pd.Timestamp(as_of)
    vis = _visible(as_of, [security_id])
    return build_snapshot(security_id, as_of, vis)


def snapshot_all(as_of, security_ids: list[str]) -> dict[str, Snapshot]:
    as_of = pd.Timestamp(as_of)
    vis = _visible(as_of, security_ids)
    return {sid: build_snapshot(sid, as_of, vis) for sid in security_ids}


# ---- prices & caps visible at as_of ---------------------------------------------------------------
def price_on(security_id: str, as_of, field_: str = "close_adj") -> tuple[pd.Timestamp | None, float | None]:
    df = read_df("prices_daily", f"security_id = '{security_id}' AND date <= DATE '{pd.Timestamp(as_of).date()}'")
    if df.empty:
        return None, None
    r = df.sort_values("date").iloc[-1]
    return pd.Timestamp(r["date"]), float(r[field_])


def price_history(security_id: str, end=None, start=None) -> pd.DataFrame:
    w = f"security_id = '{security_id}'"
    if end is not None:
        w += f" AND date <= DATE '{pd.Timestamp(end).date()}'"
    if start is not None:
        w += f" AND date >= DATE '{pd.Timestamp(start).date()}'"
    df = read_df("prices_daily", w).sort_values("date")
    df["date"] = pd.to_datetime(df["date"])
    return df


def market_cap_on(security_id: str, as_of) -> float | None:
    df = read_df("market_cap_daily", f"security_id = '{security_id}' AND date <= DATE '{pd.Timestamp(as_of).date()}'")
    if df.empty:
        return None
    return float(df.sort_values("date").iloc[-1]["market_cap"])


def symbol_to_sid(symbol: str) -> str | None:
    m = read_df("security_master", f"symbol = '{symbol.upper()}'")
    return None if m.empty else str(m.iloc[0]["security_id"])


def audit(symbol: str, as_of: str) -> None:
    sid = symbol_to_sid(symbol) or symbol
    s = snapshot(sid, as_of)
    print(f"{symbol} ({sid}) as of {as_of}: basis={s.basis} period_end={s.period_end.date() if s.period_end else None} "
          f"quarters={s.n_quarters} stale={s.stale}")
    for k in ("revenue", "operating_income", "net_income", "eps_diluted", "ocf", "capex", "fcf", "total_debt", "cash_st_inv", "total_equity", "shares_diluted"):
        v = s.metrics.get(k)
        print(f"  {k:<18} {v:>18,.0f}" if isinstance(v, float) and abs(v) >= 100 else f"  {k:<18} {v}")
    vis = _visible(pd.Timestamp(as_of), [sid])
    if not vis.empty:
        print(f"  latest available_from in snapshot: {vis['available_from'].max()}  (as_of {as_of}) — "
              f"{'OK' if pd.Timestamp(vis['available_from'].max()) <= pd.Timestamp(as_of) else 'LOOK-AHEAD!'}")
    d, p = price_on(sid, as_of)
    print(f"  last price ≤ as_of: {d.date() if d else None} close_adj={p}")
    _ = np
