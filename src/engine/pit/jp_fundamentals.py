"""Japan point-in-time build from J-Quants: master snapshots → membership; bars → prices (AdjC split-adjusted, TR
approximated from DPS); fins/summary (決算短信) → fundamentals_long with DiscDate as filing_date, YTD flows de-cumulated."""
from __future__ import annotations

import gzip
import hashlib
import json
from datetime import date, timedelta

import numpy as np
import pandas as pd

from ..store import RAW_DIR, read_df, table_path, write_table
from .build import _cached, _load_cached_json, next_trading_day
from .fields import JQ_FIELDS, PER_SHARE_FIELDS

FLOW_JP = {"revenue", "operating_income", "ordinary_income", "net_income", "eps_diluted", "ocf", "cfi", "cff"}


def _num(v):
    try:
        return None if v in (None, "", "None") else float(v)
    except (TypeError, ValueError):
        return None


def share_basis_factor(split_events: list[tuple[pd.Timestamp, float]], period_end) -> float:
    """Product of J-Quants AdjFactor for split dates strictly after `period_end`: restates a per-share figure
    reported on the old share count to today's basis (AdjC uses the same factors), so EPS/BPS/DPS stay comparable
    with split-adjusted prices and YTD de-cumulation never spans a split."""
    pe = pd.Timestamp(period_end)
    f = 1.0
    for d, k in split_events:
        if pd.Timestamp(d) > pe and k and k > 0:
            f *= float(k)
    return f


def restate_per_share(vals: dict, split_events: list[tuple[pd.Timestamp, float]], period_end) -> dict:
    f = share_basis_factor(split_events, period_end)
    if f == 1.0:
        return vals
    out = dict(vals)
    for k in PER_SHARE_FIELDS:
        if out.get(k) is not None:
            out[k] = out[k] * f
    if out.get("shares_out") is not None:
        out["shares_out"] = out["shares_out"] / f
    out["share_basis_factor"] = f
    return out


def _quarter_end(fy_end, k: int):
    """Period end of fiscal quarter k (1–4) for a fiscal year ending `fy_end`."""
    return ((pd.Timestamp(fy_end) - pd.DateOffset(months=3 * (4 - k))) + pd.offsets.MonthEnd(0)).date()


def _split_events() -> dict[str, list[tuple[pd.Timestamp, float]]]:
    """code → [(date, AdjFactor)] for every bar whose AdjFactor != 1 (splits / reverse splits)."""
    out: dict[str, list[tuple[pd.Timestamp, float]]] = {}
    for key, p in _cached("jquants", "v2/equities/bars/daily").items():
        code = key.split("_")[0]
        if code.startswith("date"):
            continue
        for b in _load_cached_json(p).get("data", []):
            try:
                k = float(b.get("AdjFactor") or 1.0)
            except (TypeError, ValueError):
                continue
            if k != 1.0 and k > 0:
                out.setdefault(code, []).append((pd.Timestamp(b["Date"]), k))
    return out


def build_jp() -> None:
    # --- calendar + TOPIX ---------------------------------------------------------------------
    topix_rows = []
    for key, p in _cached("jquants", "v2/indices/bars/daily").items():
        for r in _load_cached_json(p).get("data", []):
            topix_rows.append({"benchmark_id": "TOPIX_PR", "date": r["Date"], "level": r["C"]})
    if not topix_rows:
        print("[build jp] no TOPIX data; run `engine pull jp`")
        return
    topix = pd.DataFrame(topix_rows).drop_duplicates("date")
    bench = read_df("benchmark_daily")
    bench = pd.concat([bench[bench.benchmark_id != "TOPIX_PR"], topix], ignore_index=True)
    write_table("benchmark_daily", bench)
    cal = np.array(sorted(pd.to_datetime(topix["date"]).values.astype("datetime64[D]")))
    tc = read_df("trading_calendar")
    tc = pd.concat([tc[tc.region != "JP"], pd.DataFrame({"region": "JP", "date": pd.to_datetime(cal)})], ignore_index=True)
    write_table("trading_calendar", tc)

    # --- master snapshots → security_master + membership intervals ---------------------------------
    snaps: dict[str, list[dict]] = {}
    for key, p in _cached("jquants", "v2/equities/master").items():
        d = key.split("_")[0]
        rows = _load_cached_json(p).get("data", [])
        if d == "latest":
            d = str(date.today())
        snaps[d] = rows
    if not snaps:
        print("[build jp] no master snapshots")
        return
    dates = sorted(snaps)
    latest = {r["Code"]: r for r in snaps[dates[-1]]}
    seen: dict[str, dict] = {}
    for d in dates:
        for r in snaps[d]:
            seen.setdefault(r["Code"], r)
    master_rows, mem_rows = [], []
    for code, r in seen.items():
        r = latest.get(code, r)
        sid = f"JP:{code}"
        present = [d for d in dates if any(x["Code"] == code for x in snaps[d])]
        master_rows.append({"security_id": sid, "symbol": code[:4] if len(code) == 5 and code.endswith("0") else code, "region": "JP", "name": r.get("CoNameEn") or r.get("CoName"),
                            "exchange": r.get("MktNm"), "currency": "JPY", "cik": None, "sector": r.get("S17Nm"), "industry": r.get("S33Nm"),
                            "ipo_date": min(present), "delisted_date": (None if dates[-1] in present else (pd.Timestamp(max(present)) + timedelta(days=92)).date()),
                            "delist_reason": None, "is_adr": False, "is_fund": False, "source": "jquants"})
        mem_rows.append({"security_id": sid, "region": "JP", "start_date": min(present), "end_date": (None if dates[-1] in present else (pd.Timestamp(max(present)) + timedelta(days=92)).date()),
                         "market_code": r.get("MktNm"), "source": "jq_master", "snapshot_date": date.today()})
    sm = read_df("security_master")
    write_table("security_master", pd.concat([sm[sm.region != "JP"], pd.DataFrame(master_rows)], ignore_index=True))
    um = read_df("universe_membership")
    write_table("universe_membership", pd.concat([um[um.region != "JP"], pd.DataFrame(mem_rows)], ignore_index=True))

    # --- fundamentals from 決算短信 summaries ------------------------------------------------------------
    fund_rows, dps_by_code = [], {}
    splits = _split_events()
    for key, p in _cached("jquants", "v2/fins/summary").items():
        code = key.split("_")[0]
        if code.startswith("date"):
            continue
        rows = _load_cached_json(p).get("data", [])
        sid = f"JP:{code}"
        rows = sorted(rows, key=lambda r: (r.get("CurFYEn") or "", r.get("CurPerEn") or "", r.get("DiscDate") or ""))
        ytd_prev: dict[str, dict[str, float]] = {}
        for r in rows:
            pe, fd = r.get("CurPerEn"), r.get("DiscDate")
            if not pe or not fd:
                continue
            if str(r.get("DocType", "")).find("Forecast") >= 0 or str(r.get("DocType", "")).find("Dividend") >= 0:
                continue
            fy_end, ptype = r.get("CurFYEn"), str(r.get("CurPerType") or "")
            period_type = "FY" if ptype == "FY" else "Q"
            avail = next_trading_day(cal, pd.Timestamp(fd))
            vals = {JQ_FIELDS[k]: _num(r.get(k)) for k in JQ_FIELDS if r.get(k) not in (None, "")}
            if r.get("DEPS") not in (None, ""):
                vals["eps_diluted"] = _num(r.get("DEPS"))
            vals = restate_per_share(vals, splits.get(code, []), pe)
            basis_factor = vals.pop("share_basis_factor", None)
            if vals.get("dps_actual") is not None:
                dps_by_code.setdefault(code, []).append((pe, vals["dps_actual"]))
            # de-cumulate YTD flows into quarters. 短信 report cash-flow lines (and sometimes others) only at 2Q and FY, so
            # each YTD increment is spread evenly over the quarters it covers (allocated=True) — TTM sums stay exact.
            pidx = {"1Q": 1, "2Q": 2, "3Q": 3, "FY": 4}.get(ptype)
            if pidx is None:
                continue
            prev = ytd_prev.setdefault(fy_end, {})
            row_base = {"security_id": sid, "statement": "jq_summary", "period_type": "Q", "fiscal_year": int(str(fy_end)[:4]) if fy_end else None,
                        "fiscal_period": ptype, "period_start": r.get("CurPerSt"), "currency": "JPY", "filing_date": fd, "available_from": avail,
                        "lag_imputed": False, "restatement_rank": 0, "source": "jquants", "source_ref": str(r.get("DiscNo"))}
            for f, v in vals.items():
                if v is None:
                    continue
                if f not in FLOW_JP:
                    fund_rows.append({**row_base, "period_end": pe, "field": f, "value": v})
                    continue
                p_idx, p_val = prev.get(f, (0, 0.0))
                if p_idx >= pidx:   # restated / duplicate disclosure of a period already stored: first-filed wins
                    continue
                n = pidx - p_idx
                for k in range(p_idx + 1, pidx + 1):
                    fund_rows.append({**row_base, "period_end": _quarter_end(fy_end, k), "field": f, "value": (v - p_val) / n,
                                      "lag_imputed": n > 1})
                prev[f] = (pidx, v)
            if basis_factor is not None:
                fund_rows.append({**row_base, "period_end": pe, "field": "share_basis_factor", "value": basis_factor})
            if period_type == "FY":
                for f, v in vals.items():
                    if v is None:
                        continue
                    fund_rows.append({"security_id": sid, "statement": "jq_summary", "period_type": "FY", "fiscal_year": int(str(fy_end)[:4]) if fy_end else None,
                                      "fiscal_period": "FY", "period_start": r.get("CurFYSt"), "period_end": pe, "field": f, "value": v, "currency": "JPY",
                                      "filing_date": fd, "available_from": avail, "lag_imputed": False, "restatement_rank": 0, "source": "jquants", "source_ref": str(r.get("DiscNo"))})
    fl = read_df("fundamentals_long")
    fl = fl[~fl.security_id.str.startswith("JP:")]
    if fund_rows:
        new = pd.DataFrame(fund_rows)
        new = new.sort_values(["security_id", "statement", "period_type", "period_end", "field", "available_from"])
        new["restatement_rank"] = new.groupby(["security_id", "statement", "period_type", "period_end", "field"]).cumcount()
        write_table("fundamentals_long", pd.concat([fl, new], ignore_index=True))

    # --- prices + market cap ---------------------------------------------------------------------------
    price_rows, cap_rows = [], []
    for key, p in _cached("jquants", "v2/equities/bars/daily").items():
        code = key.split("_")[0]
        if code.startswith("date"):
            continue
        sid = f"JP:{code}"
        bars = _load_cached_json(p).get("data", [])
        if not bars:
            continue
        df = pd.DataFrame(bars)
        df["date"] = pd.to_datetime(df["Date"])
        df = df.sort_values("date").drop_duplicates("date")
        adj = df["AdjC"].astype(float)
        # total return approximation: reinvest annual DPS at fiscal period ends (labelled approx_dps)
        tr = adj.copy()
        dps = sorted(dps_by_code.get(code, []))
        if dps:
            factor = pd.Series(1.0, index=df["date"].values)
            for pe, d in dps:
                ts = pd.Timestamp(pe)
                px_at = adj[df["date"] <= ts]
                if len(px_at) and px_at.iloc[-1] > 0 and d and d > 0:
                    factor[factor.index > ts] *= (1 + d / float(px_at.iloc[-1]))
            tr = adj.values * factor.values
        for dt, c_raw, c_adj, c_tr, vol, mc in zip(df["date"], df["C"], adj, tr, df["Vo"], df["MktCap"]):
            price_rows.append({"security_id": sid, "date": dt, "close_raw": c_raw, "close_adj": c_adj, "close_tr": c_tr, "volume": vol, "source": "jquants"})
            if mc not in (None, "", 0):
                cap_rows.append({"security_id": sid, "date": dt, "market_cap": float(mc) * 1e6 if float(mc) < 1e9 else float(mc), "source": "jquants"})
    pr = read_df("prices_daily")
    pr = pr[~pr.security_id.str.startswith("JP:")]
    if price_rows:
        write_table("prices_daily", pd.concat([pr, pd.DataFrame(price_rows)], ignore_index=True))
    mc = read_df("market_cap_daily")
    mc = mc[~mc.security_id.str.startswith("JP:")]
    if cap_rows:
        write_table("market_cap_daily", pd.concat([mc, pd.DataFrame(cap_rows)], ignore_index=True))
    # events: 決算短信 disclosures
    ev_rows = []
    for r in fund_rows:
        if r["field"] == "revenue":
            eid = hashlib.sha1(f"{r['security_id']}|jp_tanshin|{r['filing_date']}".encode()).hexdigest()[:16]
            ev_rows.append({"event_id": eid, "security_id": r["security_id"], "event_date": r["filing_date"], "available_from": r["available_from"], "event_type": "jp_tanshin",
                            "payload": json.dumps({"period_end": str(r["period_end"]), "fiscal_period": r["fiscal_period"], "label": f"決算短信 {r['fiscal_period']} {r['period_end']}"}),
                            "source": "jquants", "source_ref": r["source_ref"]})
    if ev_rows and table_path("events").exists():
        ev = read_df("events")
        ev = ev[ev.event_type != "jp_tanshin"]
        write_table("events", pd.concat([ev, pd.DataFrame(ev_rows).drop_duplicates("event_id")], ignore_index=True))
    print(f"[build jp] master={len(master_rows)} fundamentals_rows={len(fund_rows)} prices={len(price_rows)} caps={len(cap_rows)} tanshin_events={len(ev_rows)}")
    _ = (gzip, RAW_DIR)
