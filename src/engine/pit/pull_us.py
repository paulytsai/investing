"""Pull US raw data into data/raw (resumable; every call is cached and ledgered by connectors.http)."""
from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date

import pandas as pd

from ..config import DATA_DIR, holdings, sources
from ..connectors.edgar import EDGAR
from ..connectors.fmp import FMP
from ..connectors.fred import FRED, SERIES

US_EXCHANGES = {"NYSE", "NASDAQ", "AMEX", "NYSE American", "New York Stock Exchange", "NASDAQ Global Select",
                "NASDAQ Global Market", "NASDAQ Capital Market", "Nasdaq", "NYSE Arca"}
BENCHMARKS = ["SPY", "RSP", "QQQ", "XLE", "XLRE", "VNQ", "URA"]
FIRST_YEAR = 2009


def universe_symbols(fmp: FMP, min_cap: float = 3e8) -> pd.DataFrame:
    """Current US common stocks above `min_cap` ∪ delisted US names. Wide on purpose; the PIT cap floor
    (hypotheses.universe.cap_floor_usd) is applied per formation date, not here."""
    rows = []
    for exch in ("NYSE", "NASDAQ", "AMEX"):
        for r in fmp.screener(country="US", exchange=exch, isEtf="false", isFund="false", isActivelyTrading="true",
                              marketCapMoreThan=int(min_cap)):
            rows.append({"symbol": r["symbol"], "name": r.get("companyName"), "exchange": r.get("exchange"), "sector": r.get("sector"),
                         "industry": r.get("industry"), "market_cap": r.get("marketCap"), "source": "fmp_screener",
                         "ipo_date": None, "delisted_date": None})
    for r in fmp.delisted():
        if r.get("exchange") in US_EXCHANGES and "." not in str(r.get("symbol", "")):
            rows.append({"symbol": r["symbol"], "name": r.get("companyName"), "exchange": r.get("exchange"), "sector": None,
                         "industry": None, "market_cap": None, "source": "fmp_delisted", "ipo_date": r.get("ipoDate"),
                         "delisted_date": r.get("delistedDate")})
    df = pd.DataFrame(rows).drop_duplicates("symbol")
    return df


def pilot_symbols(fmp: FMP) -> list[str]:
    scr = []
    for exch in ("NYSE", "NASDAQ"):
        scr += fmp.screener(country="US", exchange=exch, isEtf="false", isFund="false", isActivelyTrading="true", marketCapMoreThan=50_000_000_000)
    top = sorted(scr, key=lambda r: -(r.get("marketCap") or 0))[:50]
    syms = [r["symbol"] for r in top]
    syms += [p["symbol"] for p in holdings()["positions"]] + [i["symbol"] for i in holdings()["ideas_outside_rp"]]
    syms += sources().get("pilot_symbols_extra", [])
    seen, out = set(), []
    for s in syms:
        if s not in seen and "." not in s:
            seen.add(s)
            out.append(s)
    return out


def _pull_symbol(fmp: FMP, edgar: EDGAR, sym: str, with_statements: bool) -> dict:
    t = time.time()
    info: dict = {"symbol": sym}
    try:
        prof = fmp.profile(sym)
        info["cik"] = (prof or {}).get("cik")
        fmp.prices(sym)
        fmp.prices_div_adjusted(sym)
        fmp.splits(sym)
        fmp.dividends(sym)
        fmp.market_cap_history(sym)
        fmp.earnings(sym)
        fmp.insider_trades(sym)
        fmp.filings(sym)
        if with_statements:
            for kind in ("income", "balance", "cashflow"):
                fmp.statement(kind, sym, "annual", 40)
                fmp.statement(kind, sym, "quarter", 160)
        if info.get("cik"):
            try:
                edgar.submissions(info["cik"])
            except Exception as e:  # noqa: BLE001
                info["edgar_err"] = str(e)[:80]
        info["ok"] = True
    except Exception as e:  # noqa: BLE001
        info["ok"] = False
        info["err"] = str(e)[:160]
    info["secs"] = round(time.time() - t, 1)
    return info


def pull_us(pilot: bool = False, symbols: list[str] | None = None, workers: int = 8, bulk: bool = True) -> None:
    fmp, edgar = FMP(), EDGAR()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if symbols:
        syms = symbols
    elif pilot:
        syms = pilot_symbols(fmp)
    else:
        syms = universe_symbols(fmp)["symbol"].tolist()
    print(f"[pull us] {len(syms)} symbols; bulk statements={bulk and not pilot and not symbols}")

    # benchmarks, macro, fx
    for b in BENCHMARKS:
        fmp.prices(b)
        fmp.prices_div_adjusted(b)
    fmp.fx("USDJPY")
    try:
        fred = FRED()
        for sid in SERIES:
            fred.observations(sid)
    except Exception as e:  # noqa: BLE001
        print(f"[pull us] FRED skipped: {e}")
    try:
        fmp.sp500_history()
        fmp.sp500_current()
    except Exception as e:  # noqa: BLE001
        print(f"[pull us] sp500 history skipped: {e}")

    use_bulk = bulk and not pilot and not symbols
    if use_bulk:
        this_year = date.today().year
        for year in range(FIRST_YEAR, this_year + 1):
            for period in ("FY", "Q1", "Q2", "Q3", "Q4"):
                for kind in ("income", "balance", "cashflow"):
                    try:
                        df = fmp.bulk_statements(kind, year, period)
                        print(f"[bulk] {kind} {year} {period}: {len(df)} rows")
                    except Exception as e:  # noqa: BLE001
                        print(f"[bulk] {kind} {year} {period}: {e}")

    done = 0
    fails = []
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(_pull_symbol, fmp, edgar, s, not use_bulk): s for s in syms}
        for f in as_completed(futs):
            r = f.result()
            done += 1
            if not r.get("ok"):
                fails.append(r)
            if done % 25 == 0 or done == len(syms):
                print(f"[pull us] {done}/{len(syms)} done, {len(fails)} failed")
    if fails:
        print("[pull us] failures:", [(x["symbol"], x.get("err")) for x in fails[:10]])
    print("[pull us] complete")
