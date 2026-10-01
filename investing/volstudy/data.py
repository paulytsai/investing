"""Data loading for the vol-decomposition study, cached to ``data/volstudy``.

Sources:
  * FMP: dividend-adjusted daily prices, daily market cap, quarterly income
    statements, earnings-announcement dates, company profile (sector).
  * CBOE: 30-day implied-vol indices for single stocks (VXAPL, VXAZN, VXGOG,
    VXGS, VXIBM) and VIX. These are the only free *historical* single-stock
    implied-vol series available to this project.
"""

from __future__ import annotations

import io
import json
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd

from investing import fmp

CACHE = Path(__file__).resolve().parents[2] / "data" / "volstudy"

# S&P 100 constituents (recent composition). Using today's list over a 20+ year
# history introduces survivorship bias; see README.
SP100 = """
AAPL ABBV ABT ACN ADBE AIG AMD AMGN AMT AMZN AVGO AXP BA BAC BK BKNG BLK BMY
BRK-B C CAT CHTR CL CMCSA COF COP COST CRM CSCO CVS CVX DE DHR DIS DUK EMR F
FDX GD GE GILD GM GOOGL GS HD HON IBM INTC INTU ISRG JNJ JPM KO LIN LLY LMT
LOW MA MCD MDLZ MDT MET META MMM MO MRK MS MSFT NEE NFLX NKE NOW NVDA ORCL PEP
PFE PG PLTR PM PYPL QCOM RTX SBUX SCHW SO SPG T TGT TMO TMUS TSLA TXN UBER UNH
UNP UPS USB V VZ WFC WMT XOM
""".split()

# CBOE single-stock 30-day implied vol indices -> underlying ticker.
CBOE_IV = {"VXAPL": "AAPL", "VXAZN": "AMZN", "VXGOG": "GOOGL", "VXGS": "GS", "VXIBM": "IBM"}

START = "1999-01-01"


def _cached_json(name: str, fetch) -> object:
    path = CACHE / f"{name}.json"
    if path.exists():
        return json.loads(path.read_text())
    data = fetch()
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data))
    return data


def _daily_chunks(endpoint: str, symbol: str) -> list[dict]:
    """FMP caps daily endpoints at ~5000 rows per call; walk in 10y chunks."""
    rows: list[dict] = []
    for y0 in range(int(START[:4]), 2027, 10):
        rows += fmp.get(endpoint, symbol=symbol, **{"from": f"{y0}-01-01", "to": f"{y0 + 9}-12-31"}, limit=5000)
    return rows


def fetch_symbol(sym: str) -> None:
    """Fetch and cache everything for one ticker."""
    _cached_json(f"px_{sym}", lambda: _daily_chunks("historical-price-eod/dividend-adjusted", sym))
    _cached_json(f"mcap_{sym}", lambda: _daily_chunks("historical-market-capitalization", sym))
    _cached_json(f"inc_{sym}", lambda: fmp.get("income-statement", symbol=sym, period="quarter", limit=200))
    _cached_json(f"earn_{sym}", lambda: fmp.get("earnings", symbol=sym, limit=300))
    _cached_json(f"prof_{sym}", lambda: fmp.get("profile", symbol=sym))


def fetch_all(symbols: list[str] = SP100, workers: int = 8) -> None:
    with ThreadPoolExecutor(workers) as ex:
        for sym, err in zip(symbols, ex.map(_safe_fetch, symbols)):
            if err:
                print(f"{sym}: {err}")


def _safe_fetch(sym: str) -> str | None:
    try:
        fetch_symbol(sym)
    except Exception as e:  # noqa: BLE001 - report and continue
        return str(e)[:200]
    return None


def prices(sym: str) -> pd.Series:
    df = pd.DataFrame(_cached_json(f"px_{sym}", lambda: []))
    s = df.set_index(pd.to_datetime(df["date"]))["adjClose"].sort_index()
    return s[~s.index.duplicated()].astype(float)


def market_cap(sym: str) -> pd.Series:
    df = pd.DataFrame(_cached_json(f"mcap_{sym}", lambda: []))
    s = df.set_index(pd.to_datetime(df["date"]))["marketCap"].sort_index()
    return s[~s.index.duplicated()].astype(float)


def income(sym: str) -> pd.DataFrame:
    df = pd.DataFrame(_cached_json(f"inc_{sym}", lambda: []))
    df["date"] = pd.to_datetime(df["date"])
    df["filingDate"] = pd.to_datetime(df["filingDate"])
    return df.sort_values("date").drop_duplicates("date").reset_index(drop=True)


def earnings_dates(sym: str) -> pd.DatetimeIndex:
    """Historical earnings-announcement dates (only those with a reported EPS)."""
    rows = _cached_json(f"earn_{sym}", lambda: [])
    dates = [r["date"] for r in rows if r.get("epsActual") is not None]
    return pd.DatetimeIndex(sorted(set(pd.to_datetime(dates))))


def sector(sym: str) -> str:
    rows = _cached_json(f"prof_{sym}", lambda: [])
    return rows[0].get("sector") or "Unknown" if rows else "Unknown"


def cboe_iv(index: str) -> pd.Series:
    """CBOE vol index close, as a decimal annualized vol."""
    path = CACHE / f"cboe_{index}.csv"
    if not path.exists():
        url = f"https://cdn.cboe.com/api/global/us_indices/daily_prices/{index}_History.csv"
        req = urllib.request.Request(url, headers={"User-Agent": "investing/0.1"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            CACHE.mkdir(parents=True, exist_ok=True)
            path.write_bytes(resp.read())
    df = pd.read_csv(path)
    df.columns = [c.strip().upper() for c in df.columns]
    s = df.set_index(pd.to_datetime(df["DATE"]))["CLOSE"].astype(float) / 100.0
    return s.sort_index()


if __name__ == "__main__":
    fetch_all()
    for idx in [*CBOE_IV, "VIX"]:
        cboe_iv(idx)
    print("done:", len(list(CACHE.glob("px_*.json"))), "symbols cached")
