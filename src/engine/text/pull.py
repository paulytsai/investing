"""Pull dated text: every earnings-call transcript since `since_year` (FMP, dated by call) and the latest 10-K (or 20-F) and
10-Q items from EDGAR, for the names that can enter a cohort. Raw HTTP responses are cached by the client; this module
normalizes them into `transcripts` and `filings_text` (point-in-time: available_from = next trading day after the date)."""
from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date

import pandas as pd

from ..config import Hypotheses
from ..connectors.edgar import EDGAR, split_items
from ..connectors.fmp import FMP
from ..pit.build import next_trading_day
from ..store import has_table, read_df, write_table

ITEM_CAPS = {"1": 60_000, "1A": 40_000, "7": 60_000, "2": 40_000, "4": 60_000, "5": 60_000}


def text_universe(min_cap_mult: float = 1.0, since: str = "2015-01-01") -> pd.DataFrame:
    """Names whose market cap ever reached `min_cap_mult` × the cap floor since `since` (backtest-relevant), plus holdings."""
    from ..config import holdings

    hyp = Hypotheses.load()
    floor = float(hyp.get("universe.cap_floor_usd") or 2e9) * min_cap_mult
    m = read_df("security_master", "region = 'US' AND NOT coalesce(is_fund, false)")
    caps = read_df("market_cap_daily", f"date >= DATE '{since}'")
    mx = caps.groupby("security_id")["market_cap"].max()
    held = {str(h.get("symbol", "")).upper() for h in (holdings().get("positions") or [])}
    m["max_cap"] = m["security_id"].map(mx).fillna(0.0)
    return m[(m["max_cap"] >= floor) | m["symbol"].isin(held)][["security_id", "symbol", "cik", "max_cap"]].reset_index(drop=True)


def _cal():
    import numpy as np

    tc = read_df("trading_calendar", "region = 'US'")
    return np.array(sorted(pd.to_datetime(tc["date"]).values.astype("datetime64[D]")))


def _pull_transcripts(fmp: FMP, sid: str, sym: str, since_year: int, cal) -> list[dict]:
    rows = []
    try:
        dates = fmp.transcript_dates(sym)
    except Exception:  # noqa: BLE001
        return rows
    for d in dates:
        fy, q = d.get("fiscalYear"), d.get("quarter")
        if not fy or not q or int(fy) < since_year:
            continue
        try:
            tr = fmp.transcript(sym, int(fy), int(q))
        except Exception:  # noqa: BLE001
            continue
        if not tr or not tr.get("content") or not tr.get("date"):
            continue
        cd = pd.Timestamp(str(tr["date"])[:10])
        rows.append({"security_id": sid, "symbol": sym, "fiscal_year": int(fy), "quarter": int(q), "call_date": cd.date(),
                     "available_from": next_trading_day(cal, cd), "content": tr["content"], "source": "fmp"})
    return rows


def _pull_filings(ed: EDGAR, sid: str, sym: str, cik: str, cal, n_10k: int = 1, n_10q: int = 1) -> list[dict]:
    rows = []
    try:
        idx = ed.filing_index(cik, forms=("10-K", "10-Q", "20-F"))
    except Exception:  # noqa: BLE001
        return rows
    ks = [f for f in idx if f["form"] in ("10-K", "20-F")][:n_10k]
    qs = [f for f in idx if f["form"] == "10-Q"][:n_10q]
    for f in ks + qs:
        if not f.get("primary_doc"):
            continue
        try:
            text = ed.document_text(cik, f["accession"], f["primary_doc"])
        except Exception:  # noqa: BLE001
            continue
        items = split_items(text)
        wanted = ("1", "1A", "7") if f["form"] == "10-K" else (("4", "5") if f["form"] == "20-F" else ("2",))
        filed = pd.Timestamp(f["filed"])
        for it in wanted:
            body = items.get(it)
            if not body or len(body) < 500:
                continue
            body = body[: ITEM_CAPS.get(it, 40_000)]
            rows.append({"security_id": sid, "symbol": sym, "form": f["form"], "accession": f["accession"], "filed": filed.date(),
                         "report_date": (pd.Timestamp(f["report_date"]).date() if f.get("report_date") else None),
                         "available_from": next_trading_day(cal, filed), "item": it, "text": body, "words": len(re.findall(r"\w+", body)), "source": "edgar"})
    return rows


def pull_text(symbols: list[str] | None = None, since_year: int = 2015, workers: int = 4, filings: bool = True, transcripts: bool = True,
              min_cap_mult: float = 1.0) -> dict:
    uni = text_universe(min_cap_mult)
    if symbols:
        uni = uni[uni["symbol"].isin([s.upper() for s in symbols])]
    cal = _cal()
    fmp, ed = FMP(), EDGAR()
    have_tr = read_df("transcripts")[["security_id", "fiscal_year", "quarter"]] if has_table("transcripts") else pd.DataFrame(columns=["security_id", "fiscal_year", "quarter"])
    print(f"[text pull] {len(uni)} names; transcripts since {since_year}={transcripts}, latest filings={filings}", flush=True)
    tr_rows: list[dict] = []
    fl_rows: list[dict] = []
    done = 0

    def one(r):
        out_t = _pull_transcripts(fmp, r.security_id, r.symbol, since_year, cal) if transcripts else []
        out_f = _pull_filings(ed, r.security_id, r.symbol, r.cik, cal) if (filings and r.cik) else []
        return out_t, out_f

    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(one, r) for r in uni.itertuples(index=False)]
        for f in as_completed(futs):
            t, fl = f.result()
            tr_rows.extend(t)
            fl_rows.extend(fl)
            done += 1
            if done % 50 == 0 or done == len(uni):
                print(f"[text pull] {done}/{len(uni)} names; transcripts {len(tr_rows)}, filing items {len(fl_rows)}", flush=True)
    if tr_rows:
        new = pd.DataFrame(tr_rows)
        old = read_df("transcripts") if has_table("transcripts") else pd.DataFrame()
        allt = pd.concat([old, new], ignore_index=True) if not old.empty else new
        allt = allt.drop_duplicates(["security_id", "fiscal_year", "quarter"], keep="last")
        write_table("transcripts", allt)
    if fl_rows:
        new = pd.DataFrame(fl_rows)
        old = read_df("filings_text") if has_table("filings_text") else pd.DataFrame()
        allf = pd.concat([old, new], ignore_index=True) if not old.empty else new
        allf = allf.drop_duplicates(["security_id", "accession", "item"], keep="last")
        write_table("filings_text", allf)
    rep = {"names": int(len(uni)), "transcripts_new": len(tr_rows), "filing_items_new": len(fl_rows), "at": str(date.today())}
    print(f"[text pull] done {json.dumps(rep)}", flush=True)
    _ = have_tr
    return rep
