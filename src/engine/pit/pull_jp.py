"""Pull Japan raw data: J-Quants master (quarter-end snapshots since 2016-09-30), daily bars per code, 決算短信
summaries per code, TOPIX; EDINET 有価証券報告書 index (dates on demand)."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed

import pandas as pd

from ..config import Hypotheses
from ..connectors.jquants import JQuants

JQ_START = "2016-09-30"


def jp_universe(jq: JQuants, markets: list[str]) -> list[dict]:
    rows = jq.master()
    return [r for r in rows if r.get("MktNm") in markets and not str(r.get("CoName", "")).startswith("ETF")]


def pull_jp(pilot: bool = False, workers: int = 4) -> None:
    jq = JQuants()
    hyp = Hypotheses.load()
    markets = hyp.get("universe.jp_markets")
    uni = jp_universe(jq, markets)
    if pilot:
        uni = [u for u in uni if u.get("ScaleCat") in ("TOPIX Core30", "TOPIX Large70")]
    codes = [u["Code"] for u in uni]
    print(f"[pull jp] {len(codes)} codes ({'pilot: Core30+Large70' if pilot else 'Prime+Standard'})")
    jq.topix(JQ_START)
    for d in pd.date_range("2016-09-30", pd.Timestamp.today(), freq="QE"):
        try:
            jq.master(date=d.strftime("%Y-%m-%d"))
        except Exception as e:  # noqa: BLE001
            print(f"[pull jp] master {d.date()}: {str(e)[:80]}")
    fails = 0

    def one(code: str) -> bool:
        try:
            jq.bars(code, JQ_START)
            jq.fins_summary(code)
            return True
        except Exception as e:  # noqa: BLE001
            print(f"[pull jp] {code}: {str(e)[:100]}")
            return False

    done = 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for ok in as_completed([ex.submit(one, c) for c in codes]):
            done += 1
            fails += 0 if ok.result() else 1
            if done % 100 == 0 or done == len(codes):
                print(f"[pull jp] {done}/{len(codes)} ({fails} failed)")
    print("[pull jp] complete")
