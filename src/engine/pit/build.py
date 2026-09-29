"""Normalize raw pulls (data/raw) into point-in-time parquet tables (data/pit)."""
from __future__ import annotations

import gzip
import hashlib
import json
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from ..config import sources
from ..connectors.fmp import FMP
from ..connectors.fred import SERIES
from ..store import write_region, RAW_DIR, read_df, table_path, write_table
from .fields import FMP_FIELDS, first_value
from .prices import frame_from_fmp


# ------------------------------------------------------------------------------------------
# helpers
# ------------------------------------------------------------------------------------------
def _load_cached_json(path: Path):
    return json.loads(gzip.decompress(path.read_bytes()).decode("utf-8"))


def _cached(source: str, endpoint: str) -> dict[str, Path]:
    """symbol/key → newest cached file for an endpoint."""
    d = RAW_DIR / source / endpoint.replace("/", "_")
    out: dict[str, Path] = {}
    if not d.exists():
        return out
    for p in sorted(d.glob("*.gz")):
        key = p.name.split("__")[0]
        out[key] = p
    return out


def next_trading_day(cal: np.ndarray, d: pd.Timestamp) -> pd.Timestamp:
    i = np.searchsorted(cal, np.datetime64(d.to_datetime64()), side="right")
    return pd.Timestamp(cal[min(i, len(cal) - 1)])


def security_id_for(symbol: str, cik: str | None, ipo: str | None) -> str:
    if cik and str(cik).strip("0"):
        return f"US:{str(cik).zfill(10)}"
    return f"US:{symbol}@{ipo or 'na'}"


# ------------------------------------------------------------------------------------------
# US build
# ------------------------------------------------------------------------------------------
def build_us() -> None:
    fmp = FMP()
    lags = sources()["lags"]

    # --- benchmark + calendar --------------------------------------------------------------
    bench_rows = []
    cal = None
    for b in ("SPY", "RSP", "QQQ", "XLE", "XLRE", "VNQ", "URA"):
        full = fmp.prices(b)
        div = fmp.prices_div_adjusted(b)
        if not full:
            continue
        df = frame_from_fmp(b, full, div, fmp.splits(b), f"BENCH:{b}")
        for _, r in df.iterrows():
            bench_rows.append({"benchmark_id": f"{b}_TR", "date": r["date"], "level": r["close_tr"]})
            bench_rows.append({"benchmark_id": f"{b}_PR", "date": r["date"], "level": r["close_adj"]})
        if b == "SPY":
            cal = np.array(sorted(pd.to_datetime(df["date"]).values.astype("datetime64[D]")))
    assert cal is not None, "SPY prices missing; run `engine pull us` first"
    write_region("benchmark_daily", pd.DataFrame(bench_rows), "US")
    write_region("trading_calendar", pd.DataFrame({"region": "US", "date": pd.to_datetime(cal)}), "US")

    # --- macro + fx --------------------------------------------------------------------------
    macro_rows = []
    for key, p in _cached("fred", "fred/series/observations").items():
        sid = key.split("_")[0]
        d = _load_cached_json(p)
        for o in d.get("observations", []):
            if o.get("value") not in (None, ".", ""):
                macro_rows.append({"series_id": sid, "date": o["date"], "value": float(o["value"])})
    if macro_rows:
        write_table("macro_daily", pd.DataFrame(macro_rows))
    fx = fmp.fx("USDJPY")
    if fx:
        write_table("fx_daily", pd.DataFrame([{"pair": "USDJPY", "date": r["date"], "rate": r["close"]} for r in fx]))
    _ = SERIES

    # --- security master from cached profiles + delisted list ---------------------------------
    profiles = {}
    for sym, p in _cached("fmp", "stable/profile").items():
        d = _load_cached_json(p)
        if d:
            profiles[sym] = d[0]
    delisted = {r["symbol"]: r for r in (fmp.delisted() if _cached("fmp", "stable/delisted-companies") else [])}
    master_rows = []
    sid_of: dict[str, str] = {}
    seen_sids: set[str] = set()
    for sym, pr in sorted(profiles.items(), key=lambda kv: -(kv[1].get("marketCap") or 0)):
        dl = delisted.get(sym)
        sid = security_id_for(sym, pr.get("cik"), pr.get("ipoDate"))
        if sid in seen_sids:                 # share classes (GOOG/GOOGL): keep the larger class as the CIK id
            sid = f"{sid}:{sym}"
        seen_sids.add(sid)
        sid_of[sym] = sid
        master_rows.append({
            "security_id": sid, "symbol": sym, "region": "US", "name": pr.get("companyName"), "exchange": pr.get("exchange"),
            "currency": pr.get("currency"), "cik": (str(pr.get("cik")).zfill(10) if pr.get("cik") else None),
            "sector": pr.get("sector"), "industry": pr.get("industry"),
            "ipo_date": pr.get("ipoDate") or (dl or {}).get("ipoDate"),
            "delisted_date": (dl or {}).get("delistedDate") if dl else (None if pr.get("isActivelyTrading", True) else None),
            "delist_reason": None, "is_adr": bool(pr.get("isAdr")), "is_fund": bool(pr.get("isEtf") or pr.get("isFund")),
            "source": "fmp",
        })
    master = pd.DataFrame(master_rows).drop_duplicates("security_id")
    write_region("security_master", master, "US")

    # --- prices + market cap -----------------------------------------------------------------
    price_frames, cap_rows = [], []
    for sym, sid in sid_of.items():
        full_p = _cached("fmp", "stable/historical-price-eod/full").get(sym)
        if not full_p:
            continue
        full = _load_cached_json(full_p)
        div_p = _cached("fmp", "stable/historical-price-eod/dividend-adjusted").get(sym)
        div = _load_cached_json(div_p) if div_p else []
        sp_p = _cached("fmp", "stable/splits").get(sym)
        splits = _load_cached_json(sp_p) if sp_p else []
        if isinstance(full, list) and full:
            price_frames.append(frame_from_fmp(sym, full, div if isinstance(div, list) else [], splits if isinstance(splits, list) else [], sid))
        for key, p in _cached("fmp", "stable/historical-market-capitalization").items():
            if key.split("_")[0] != sym:
                continue
            for r in _load_cached_json(p) or []:
                cap_rows.append({"security_id": sid, "date": r["date"], "market_cap": r["marketCap"], "source": "fmp"})
    if price_frames:
        prices = pd.concat(price_frames, ignore_index=True).drop_duplicates(["security_id", "date"])
        write_region("prices_daily", prices, "US")
        # infer delisting for names whose series stopped
        last = prices.groupby("security_id")["date"].max()
    else:
        last = pd.Series(dtype="object")
    if cap_rows:
        caps = pd.DataFrame(cap_rows).drop_duplicates(["security_id", "date"])
        write_region("market_cap_daily", caps, "US")

    # --- universe membership (interval) ------------------------------------------------------
    today = pd.Timestamp(date.today())
    mem_rows = []
    for _, r in master.iterrows():
        start = pd.to_datetime(r["ipo_date"]) if pd.notna(r["ipo_date"]) else pd.Timestamp("1990-01-01")
        end = pd.to_datetime(r["delisted_date"]) if pd.notna(r["delisted_date"]) else None
        if end is None and r["security_id"] in last.index:
            ld = pd.Timestamp(last[r["security_id"]])
            if (today - ld).days > 10:
                end = ld + timedelta(days=1)
        mem_rows.append({"security_id": r["security_id"], "region": "US", "start_date": start, "end_date": end,
                         "market_code": r["exchange"], "source": "fmp", "snapshot_date": today})
    write_region("universe_membership", pd.DataFrame(mem_rows), "US")

    # --- fundamentals long ----------------------------------------------------------------------
    fund_rows = []
    fy_lag, q_lag = int(lags["fy_days_if_no_filing_date"]), int(lags["q_days_if_no_filing_date"])

    def add_statement_rows(sid: str, kind: str, rows: list[dict], period_type: str, source: str) -> None:
        for r in rows:
            pe = r.get("date")
            if not pe:
                continue
            pe_ts = pd.Timestamp(pe)
            fd_raw = r.get("filingDate")
            fd = pd.Timestamp(str(fd_raw)[:10]) if fd_raw and str(fd_raw) not in ("None", "nan") else None
            imputed = False
            if fd is None or fd <= pe_ts:   # missing or bulk artefact (filingDate == period end) → impute
                fd = pe_ts + timedelta(days=fy_lag if period_type == "FY" else q_lag)
                imputed = True
            avail = next_trading_day(cal, fd)
            period = str(r.get("period") or ("FY" if period_type == "FY" else "Q"))
            fy = r.get("fiscalYear") or r.get("calendarYear")
            for field, keys in FMP_FIELDS[kind].items():
                v = first_value(r, keys)
                if v is None:
                    continue
                fund_rows.append({
                    "security_id": sid, "statement": kind, "period_type": period_type, "fiscal_year": int(fy) if fy else None,
                    "fiscal_period": period, "period_start": None, "period_end": pe_ts, "field": field, "value": v,
                    "currency": r.get("reportedCurrency"), "filing_date": fd, "available_from": avail, "lag_imputed": imputed,
                    "restatement_rank": 0, "source": source, "source_ref": str(r.get("acceptedDate") or ""),
                })

    # per-symbol statements
    for kind, ep in (("income", "stable/income-statement"), ("balance", "stable/balance-sheet-statement"), ("cashflow", "stable/cash-flow-statement")):
        for key, p in _cached("fmp", ep).items():
            sym, _, period = key.rpartition("_")
            if sym not in sid_of:
                continue
            rows = _load_cached_json(p)
            if isinstance(rows, list):
                add_statement_rows(sid_of[sym], kind, rows, "FY" if period == "annual" else "Q", "fmp")
    # bulk statements (CSV)
    for kind, ep in (("income", "stable/income-statement-bulk"), ("balance", "stable/balance-sheet-statement-bulk"), ("cashflow", "stable/cash-flow-statement-bulk")):
        for key, p in _cached("fmp", ep).items():
            year, _, period = key.partition("_")
            with gzip.open(p, "rt", encoding="utf-8") as f:
                try:
                    df = pd.read_csv(f, low_memory=False)
                except Exception:
                    continue
            df = df[df["symbol"].isin(sid_of.keys())]
            recs = df.to_dict("records")
            by_sym: dict[str, list[dict]] = {}
            for r in recs:
                by_sym.setdefault(r["symbol"], []).append(r)
            for sym, rows in by_sym.items():
                add_statement_rows(sid_of[sym], kind, rows, "FY" if period == "FY" else "Q", "fmp_bulk")

    if fund_rows:
        fl = pd.DataFrame(fund_rows)
        fl = fl.sort_values(["security_id", "statement", "period_type", "period_end", "field", "available_from"])
        fl["restatement_rank"] = fl.groupby(["security_id", "statement", "period_type", "period_end", "field"]).cumcount()
        fl = fl.drop_duplicates(["security_id", "statement", "period_type", "period_end", "field", "value", "available_from"])
        write_region("fundamentals_long", fl, "US")

    # --- events ----------------------------------------------------------------------------------
    ev_rows = []

    def ev(sid: str, d, etype: str, payload: dict, source: str, ref: str) -> None:
        if not d:
            return
        dts = pd.Timestamp(str(d)[:10])
        eid = hashlib.sha1(f"{sid}|{etype}|{dts.date()}|{ref}".encode()).hexdigest()[:16]
        ev_rows.append({"event_id": eid, "security_id": sid, "event_date": dts, "available_from": next_trading_day(cal, dts),
                        "event_type": etype, "payload": json.dumps(payload, default=str), "source": source, "source_ref": ref})

    for sym, p in _cached("fmp", "stable/earnings").items():
        if sym not in sid_of:
            continue
        for r in _load_cached_json(p) or []:
            if r.get("epsActual") is None:
                continue
            est, act = r.get("epsEstimated"), r.get("epsActual")
            surprise = ((act - est) / abs(est) * 100) if est not in (None, 0) else None
            ev(sid_of[sym], r["date"], "earnings", {"eps_actual": act, "eps_estimate": est, "surprise_pct": surprise,
                                                    "revenue_actual": r.get("revenueActual"), "revenue_estimate": r.get("revenueEstimated")}, "fmp", f"earn:{r['date']}")
    for key, p in _cached("fmp", "stable/insider-trading/search").items():
        sym = key.rsplit("_p", 1)[0]
        if sym not in sid_of:
            continue
        for r in _load_cached_json(p) or []:
            tt = str(r.get("transactionType", ""))
            if not (tt.startswith("P-") or tt.startswith("S-")):
                continue
            shares, price = float(r.get("securitiesTransacted") or 0), float(r.get("price") or 0)
            ev(sid_of[sym], r.get("filingDate") or r.get("transactionDate"), "form4_buy" if tt.startswith("P-") else "form4_sell",
               {"name": r.get("reportingName"), "owner_type": r.get("typeOfOwner"), "shares": shares, "price": price,
                "value_usd": shares * price, "transaction_date": r.get("transactionDate")}, "fmp", f"f4:{r.get('link','')[-40:]}")
    sub_files = [p for d in (RAW_DIR / "edgar").glob("submissions_CIK*") for p in d.glob("*.gz")] if (RAW_DIR / "edgar").exists() else []
    for p in sub_files:
        sub = _load_cached_json(p)
        rec = sub.get("filings", {}).get("recent", {})
        sym_list = sub.get("tickers") or []
        sid = None
        for s in sym_list:
            if s in sid_of:
                sid = sid_of[s]
                break
        if sid is None:
            continue
        forms = rec.get("form", [])
        for i, form in enumerate(forms):
            if form in ("8-K", "10-K", "10-Q", "20-F", "6-K"):
                ev(sid, rec["filingDate"][i], f"filing_{form.lower().replace('-', '')}",
                   {"items": rec.get("items", [""] * len(forms))[i], "accession": rec["accessionNumber"][i],
                    "primary_doc": rec.get("primaryDocument", [""] * len(forms))[i]}, "edgar", rec["accessionNumber"][i])
    for sym, p in _cached("fmp", "stable/dividends").items():
        if sym not in sid_of:
            continue
        rows = _load_cached_json(p) or []
        rows = sorted(rows, key=lambda r: r.get("date", ""))
        prev = None
        for r in rows:
            amt = r.get("adjDividend") or r.get("dividend")
            if amt is None:
                continue
            if prev is not None and amt != prev:
                ev(sid_of[sym], r.get("declarationDate") or r["date"], "dividend_change", {"from": prev, "to": amt}, "fmp", f"div:{r['date']}")
            prev = amt
    if ev_rows:
        new_ev = pd.DataFrame(ev_rows).drop_duplicates("event_id")
        if table_path("events").exists():                      # keep regulatory / macro rows pulled by the inbox
            keep = read_df("events", "security_id = 'MACRO'")
            if not keep.empty:
                new_ev = pd.concat([new_ev, keep], ignore_index=True).drop_duplicates("event_id")
        write_region("events", new_ev, "US")
    print(f"[build us] master={len(master)} prices={len(price_frames)} fundamentals_rows={len(fund_rows)} events={len(ev_rows)}")


def build(region: str = "us") -> None:
    if region in ("us", "all"):
        build_us()
    if region in ("jp", "all"):
        from .jp_fundamentals import build_jp

        build_jp()
