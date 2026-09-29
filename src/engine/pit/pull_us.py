"""Pull US raw data into data/raw (resumable; every call is cached and ledgered by connectors.http)."""
from __future__ import annotations

import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from pathlib import Path

import pandas as pd

from ..config import DATA_DIR, Hypotheses, holdings, sources
from ..store import RAW_DIR
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
    # foreign-domiciled names listed on US exchanges (ADRs, Irish/Bermuda/Canadian filers…) above the cap floor:
    # Chinese and EM names carry the X-27 SOFT geopolitical penalty in the screen, they are never excluded here
    floor = float(Hypotheses.load().get("universe.cap_floor_usd") or 2e9)
    for exch in ("NYSE", "NASDAQ"):
        for r in fmp.screener(exchange=exch, isEtf="false", isFund="false", isActivelyTrading="true", marketCapMoreThan=int(floor)):
            if str(r.get("country") or "US") == "US" or "." in r["symbol"] or "-" in r["symbol"]:
                continue
            rows.append({"symbol": r["symbol"], "name": r.get("companyName"), "exchange": r.get("exchange"), "sector": r.get("sector"),
                         "industry": r.get("industry"), "market_cap": r.get("marketCap"), "source": "fmp_screener_foreign",
                         "ipo_date": None, "delisted_date": None})
    for r in fmp.delisted():
        if r.get("exchange") in US_EXCHANGES and "." not in str(r.get("symbol", "")):
            rows.append({"symbol": r["symbol"], "name": r.get("companyName"), "exchange": r.get("exchange"), "sector": None,
                         "industry": None, "market_cap": None, "source": "fmp_delisted", "ipo_date": r.get("ipoDate"),
                         "delisted_date": r.get("delistedDate")})
    # every ticker that ever left the S&P 500 in the window (acquired names are often missing from the delisted list):
    # survivorship control for the sp500_pit universe and the cap-floor backtest alike
    try:
        have = {r["symbol"] for r in rows}
        for ch in fmp.sp500_history():
            t = ch.get("removedTicker")
            if t and t not in have and "." not in t and str(ch.get("date", "")) >= "2009-01-01":
                rows.append({"symbol": t, "name": ch.get("removedSecurity"), "exchange": None, "sector": None, "industry": None,
                             "market_cap": None, "source": "sp500_removed", "ipo_date": None, "delisted_date": ch.get("date")})
                have.add(t)
    except Exception as e:  # noqa: BLE001
        print(f"[pull us] sp500 removed tickers skipped: {e}")
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
    """Pull every per-symbol endpoint; one failing endpoint never aborts the others (each is cached and resumable).
    `ok` is True when the core endpoints (profile, prices) succeeded; every endpoint error is recorded by name."""
    t = time.time()
    info: dict = {"symbol": sym, "errors": {}}

    def step(name: str, fn):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001
            info["errors"][name] = str(e)[:120]
            return None

    prof = step("profile", lambda: fmp.profile(sym))
    info["cik"] = (prof or {}).get("cik")
    step("prices", lambda: fmp.prices(sym))
    step("prices_div_adjusted", lambda: fmp.prices_div_adjusted(sym))
    step("splits", lambda: fmp.splits(sym))
    step("dividends", lambda: fmp.dividends(sym))
    step("market_cap_history", lambda: fmp.market_cap_history(sym))
    step("earnings", lambda: fmp.earnings(sym))
    step("insider_trades", lambda: fmp.insider_trades(sym))
    step("filings", lambda: fmp.filings(sym))
    if with_statements:
        for kind in ("income", "balance", "cashflow"):
            step(f"{kind}_annual", lambda k=kind: fmp.statement(k, sym, "annual", 40))
            step(f"{kind}_quarter", lambda k=kind: fmp.statement(k, sym, "quarter", 160))
    if info.get("cik"):
        step("edgar_submissions", lambda: edgar.submissions(info["cik"]))
    info["ok"] = not ({"profile", "prices"} & set(info["errors"]))
    info["secs"] = round(time.time() - t, 1)
    return info


def _results_path() -> Path:
    return RAW_DIR / "fmp" / "pull_us_results.jsonl"


def _done_symbols() -> set[str]:
    p = _results_path()
    if not p.exists():
        return set()
    out = set()
    for line in p.read_text(encoding="utf-8").splitlines():
        try:
            r = json.loads(line)
        except json.JSONDecodeError:
            continue
        if r.get("ok") and not r.get("errors"):
            out.add(r["symbol"])
    return out


def pull_us(pilot: bool = False, symbols: list[str] | None = None, workers: int = 8, bulk: bool = True, refresh_bulk: bool = True,
            shard: tuple[int, int] | None = None) -> None:
    """`shard=(i, n)` pulls every n-th symbol starting at i (run n processes in parallel: the per-symbol phase is CPU-bound in
    one process); set ENGINE_RPS_SCALE=1/n so the shards share each host's quota. `refresh_bulk=False` skips the bulk
    CSV loop when it is already cached (statements still come from bulk, not per symbol)."""
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
    if use_bulk and refresh_bulk:
        this_year = date.today().year
        for year in range(FIRST_YEAR, this_year + 1):
            for period in ("FY", "Q1", "Q2", "Q3", "Q4"):
                for kind in ("income", "balance", "cashflow"):
                    try:
                        df = fmp.bulk_statements(kind, year, period)
                        print(f"[bulk] {kind} {year} {period}: {len(df)} rows")
                    except Exception as e:  # noqa: BLE001
                        print(f"[bulk] {kind} {year} {period}: {e}")

    already = _done_symbols() if not symbols else set()
    if shard:
        i, n = shard
        syms = syms[i::n]
        print(f"[pull us] shard {i}/{n}: {len(syms)} symbols")
    todo = [s for s in syms if s not in already]
    print(f"[pull us] {len(already)} symbols complete from earlier runs; {len(todo)} to do")
    done = 0
    fails: list[dict] = []
    partial = 0
    _results_path().parent.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=workers) as ex, open(_results_path(), "a", encoding="utf-8") as out:
        futs = {ex.submit(_pull_symbol, fmp, edgar, s, not use_bulk): s for s in todo}
        for f in as_completed(futs):
            r = f.result()
            done += 1
            out.write(json.dumps(r) + "\n")
            out.flush()
            if not r.get("ok"):
                fails.append(r)
            elif r.get("errors"):
                partial += 1
            if done % 25 == 0 or done == len(todo):
                print(f"[pull us] {done}/{len(todo)} done, {len(fails)} failed, {partial} partial", flush=True)
    if fails:
        print("[pull us] failures:", [(x["symbol"], x.get("errors")) for x in fails[:10]])
    print("[pull us] complete", flush=True)
