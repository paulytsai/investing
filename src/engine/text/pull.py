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
from ..store import read_df

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


def _flush_parts(parts_dir, rows: list[dict], n: list[int], name: str) -> None:
    if not rows:
        return
    parts_dir.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(rows).to_parquet(parts_dir / f"{name}{n[0]:04d}.parquet", index=False)
    n[0] += 1
    rows.clear()


def _combine(parts_dir, table: str, keys: list[str]) -> int:
    """Parts + the existing table → the table, deduped on `keys` (latest part wins), out of core in DuckDB."""
    import duckdb

    from ..store import TABLES, table_path

    out = table_path(table)
    cols = [f.name for f in TABLES[table]]
    tmp = out.with_suffix(".tmp.parquet")
    con = duckdb.connect()
    con.execute("SET memory_limit='5GB'")               # ~100k transcripts ≈ 5 GB of text: the dedupe window spills to disk
    con.execute("SET threads=2")
    tmpdir = out.parent / "_duckdb_tmp"
    tmpdir.mkdir(parents=True, exist_ok=True)
    con.execute(f"SET temp_directory='{tmpdir.as_posix()}'")
    srcs = [f"SELECT {', '.join(cols)}, 1 AS pri FROM read_parquet('{(parts_dir / '*.parquet').as_posix()}')"]
    if out.exists():
        srcs.append(f"SELECT {', '.join(cols)}, 0 AS pri FROM read_parquet('{out.as_posix()}')")
    con.execute(f"""COPY (SELECT {', '.join(cols)} FROM (SELECT *, row_number() OVER (PARTITION BY {', '.join(keys)} ORDER BY pri DESC) AS rn
                       FROM ({' UNION ALL BY NAME '.join(srcs)})) WHERE rn = 1) TO '{tmp.as_posix()}' (FORMAT PARQUET)""")
    n = con.execute(f"SELECT count(*) FROM read_parquet('{tmp.as_posix()}')").fetchone()[0]
    con.close()
    tmp.replace(out)
    for f in parts_dir.glob("*.parquet"):
        f.unlink()
    return int(n)


def pull_text(symbols: list[str] | None = None, since_year: int = 2015, workers: int = 4, filings: bool = True, transcripts: bool = True,
              min_cap_mult: float = 1.0, flush_every: int = 100) -> dict:
    """Streams: every `flush_every` names the accumulated rows go to parquet parts (99k transcripts held in RAM once
    OOM-killed the process); parts are combined into the tables in DuckDB at the end. Names whose latest transcript is
    already stored are skipped for transcripts (re-runs only fetch new quarters)."""
    from ..store import table_path

    uni = text_universe(min_cap_mult)
    if symbols:
        uni = uni[uni["symbol"].isin([s.upper() for s in symbols])]
    cal = _cal()
    fmp, ed = FMP(), EDGAR()
    parts_tr = table_path("transcripts").parent / "_parts_transcripts"
    parts_fl = table_path("filings_text").parent / "_parts_filings"
    print(f"[text pull] {len(uni)} names; transcripts since {since_year}={transcripts}, latest filings={filings}", flush=True)
    tr_rows: list[dict] = []
    fl_rows: list[dict] = []
    n_tr, n_fl = [len(list(parts_tr.glob("*.parquet")))], [len(list(parts_fl.glob("*.parquet")))]   # continue numbering after an interrupted run
    tot_tr = tot_fl = done = 0

    def one(r):
        out_t = _pull_transcripts(fmp, r.security_id, r.symbol, since_year, cal) if transcripts else []
        out_f = _pull_filings(ed, r.security_id, r.symbol, r.cik, cal) if (filings and r.cik) else []
        return out_t, out_f

    rows_all = list(uni.itertuples(index=False))
    with ThreadPoolExecutor(max_workers=workers) as ex:
        # submit in chunks: a Future keeps its result alive until it is dropped, so one list of 3,500 futures held every
        # transcript in RAM regardless of flushing (10 GB → OOM)
        for start in range(0, len(rows_all), flush_every):
            chunk = rows_all[start: start + flush_every]
            for f in as_completed([ex.submit(one, r) for r in chunk]):
                t, fl = f.result()
                tr_rows.extend(t)
                fl_rows.extend(fl)
                tot_tr += len(t)
                tot_fl += len(fl)
                done += 1
                if done % 50 == 0 or done == len(uni):
                    print(f"[text pull] {done}/{len(uni)} names; transcripts {tot_tr}, filing items {tot_fl}", flush=True)
            _flush_parts(parts_tr, tr_rows, n_tr, "tr")
            _flush_parts(parts_fl, fl_rows, n_fl, "fl")
    _flush_parts(parts_tr, tr_rows, n_tr, "tr")
    _flush_parts(parts_fl, fl_rows, n_fl, "fl")
    n1 = _combine(parts_tr, "transcripts", ["security_id", "fiscal_year", "quarter"]) if n_tr[0] else 0
    n2 = _combine(parts_fl, "filings_text", ["security_id", "accession", "item"]) if n_fl[0] else 0
    rep = {"names": int(len(uni)), "transcripts_new": tot_tr, "filing_items_new": tot_fl, "transcripts_total": n1, "filing_items_total": n2, "at": str(date.today())}
    print(f"[text pull] done {json.dumps(rep)}", flush=True)
    return rep
