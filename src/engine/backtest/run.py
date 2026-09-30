"""`engine backtest`: cohorts → holding returns → statistics → attribution → sensitivity → HTML report."""
from __future__ import annotations

import gc
import json
import os
from datetime import datetime

import numpy as np
import pandas as pd

from ..config import REPORTS_DIR, Hypotheses
from ..reports import render
from ..reports.charts import build_price_chart, build_series_chart, to_json
from ..screen.rules import rules
from ..store import has_table, ledger, read_df
from .cohorts import Cohort, candidate_cache_path, candidates_at, form_cohort, formation_dates
from .metrics import cohort_stats, curve_stats, pooled_stats, rank_ic, result_by_formation, sector_attribution
from .portfolio import PriceBook, evaluate_cohort, overlapping_curve


def _warm_one(args) -> str:
    d, region, universe_kind = args
    from ..config import Hypotheses

    candidates_at(pd.Timestamp(d), region, Hypotheses.load(), universe_kind)
    return str(d)


def warm_candidate_cache(dates, region, universe_kind, workers: int | None = None) -> None:
    """Build the point-in-time candidate cache for every formation date in parallel processes (the slow part of a
    full-universe backtest: ~0.1 s per name per date). Cached dates are skipped."""
    from concurrent.futures import ProcessPoolExecutor

    todo = [d for d in dates if not candidate_cache_path(pd.Timestamp(d), region, universe_kind).exists()]
    if not todo:
        return
    workers = workers or max(1, min(4, (os.cpu_count() or 2)))
    print(f"[backtest] building candidate cache for {len(todo)} formation dates with {workers} workers", flush=True)
    with ProcessPoolExecutor(max_workers=workers) as ex:
        for i, d in enumerate(ex.map(_warm_one, [(d, region, universe_kind) for d in todo]), 1):
            print(f"[backtest] candidates cached {d} ({i}/{len(todo)})", flush=True)


def _score_all(dates, region, hyp, top, preset, universe_kind, max_sector, quiet=False) -> dict[pd.Timestamp, Cohort]:
    out = {}
    for i, d in enumerate(dates, 1):
        c = form_cohort(d, region, hyp, top, preset, universe_kind, max_sector)
        out[d] = c
        if not quiet:
            print(f"[backtest] {d.date()}: {len(c.scored)} scored, {c.n_eligible} eligible, {len(c.picks)} picked ({i}/{len(dates)})")
    return out


def run_backtest(start="2016-03-31", end="2024-09-30", hold_months=24, top=20, region="us", preset=None, sensitivity=False,
                 universe_kind=None, out_dir=None) -> dict:
    hyp = Hypotheses.load()
    region = region.upper()
    bench_label = "SPY total return" if region == "US" else "TOPIX price return (JP total return approximated, labelled)"
    dates = formation_dates(start, end, hyp.get("backtest.cadence"))
    max_sector = int(hyp.get("screen.max_per_sector") or 0) or None
    preset = preset or hyp.get("screen.preset")
    warm_candidate_cache(dates, region, universe_kind)
    cohorts = _score_all(dates, region, hyp, top, preset, universe_kind, max_sector)
    all_ids = sorted({c.security_id for co in cohorts.values() for c in co.scored})
    if not all_ids:
        print("no candidates; pull and build data first")
        return {}
    book = PriceBook(all_ids, region)
    results = {d: evaluate_cohort(co.picks, d, hold_months, book) for d, co in cohorts.items()}
    # returns for every eligible name (for rank-IC), not only the picks
    all_results = {d: evaluate_cohort([c for c in co.scored if c.eligible], d, hold_months, book) for d, co in cohorts.items()}
    rows = []
    for d in dates:
        st = cohort_stats(results[d], hold_months)
        st.update({k: v for k, v in sector_attribution(results[d], all_results[d]).items() if k != "sectors"})
        st["sector_detail"] = sector_attribution(results[d], all_results[d]).get("sectors", {})
        st["sector_calls"] = {k: {"stance": v.stance, "score": v.score, "slots": v.slots} for k, v in (cohorts[d].sector_calls or {}).items()}
        st["formation"] = d.date()
        st["n_scored"], st["n_eligible"] = len(cohorts[d].scored), cohorts[d].n_eligible
        st["picks"] = [r.symbol for r in results[d]]
        st["macro"] = render.macro_strip(d)
        rows.append(st)
    pooled = pooled_stats(rows)
    n_sleeves = max(1, hold_months // 3)
    curve = overlapping_curve(results, book, hold_months)
    cstats = curve_stats(curve, n_sleeves)
    angle_keys = list(rules()["angles"].keys())
    ic = rank_ic({d: co.scored for d, co in cohorts.items()}, result_by_formation(all_results), angle_keys)
    sens = run_sensitivity(dates, region, hyp, top, universe_kind, max_sector, book, hold_months) if sensitivity else []
    run_id = f"{start}_{end}_{datetime.now().strftime('%H%M%S')}"
    out = out_dir or (REPORTS_DIR / "backtest" / run_id)
    out.mkdir(parents=True, exist_ok=True)
    _render(out, rows, pooled, cstats, curve, ic, sens, results, cohorts, book, hyp, dict(start=start, end=end, hold_months=hold_months, top=top,
                                                                                                region=region, preset=preset, universe_kind=universe_kind or hyp.get("universe.kind"), bench_label=bench_label, bench_short=("SPY" if region == "US" else "TOPIX")))
    (out / "run.json").write_text(json.dumps({"as_of": end, "title": f"Backtest {region} {start}→{end}, top {top}, {hold_months}m hold", "entry": "index.html"}))
    (out / "results.json").write_text(json.dumps({"cohorts": rows, "pooled": pooled, "curve": cstats, "rank_ic": ic, "sensitivity": sens}, default=str, indent=1))
    con = ledger()
    con.execute("INSERT OR REPLACE INTO runs VALUES (?,?,?,?,?,?)", [run_id, "backtest", pd.Timestamp(end).date(), datetime.now(), json.dumps({"top": top, "hold": hold_months}), str(out)])
    con.close()
    render.update_index()
    done = [r for r in rows if r.get("n") and not r.get("in_flight")]
    print(f"[backtest] {len(done)} complete cohorts; pooled mean cohort return {pooled.get('mean_cohort_ret', 0)*100:.1f}% vs excess {((pooled.get('mean_excess') or 0)*100):+.1f}%; "
          f"batting (beat benchmark) {pooled.get('mean_batting_beat', 0)*100:.0f}% → {out / 'index.html'}")
    return {"path": out, "rows": rows, "pooled": pooled, "curve": cstats, "rank_ic": ic}


def run_sensitivity(dates, region, hyp, top, universe_kind, max_sector, book, hold_months) -> list[dict]:
    variants = []
    for preset in hyp._data["screen"]["presets"].keys():
        variants.append({"label": f"preset {preset}", "preset": preset, "top": top, "sector_cap": max_sector})
    for tn in (10, 30):
        variants.append({"label": f"top {tn}", "preset": hyp.get("screen.preset"), "top": tn, "sector_cap": max_sector})
    variants.append({"label": "no sector cap", "preset": hyp.get("screen.preset"), "top": top, "sector_cap": None})
    out = []
    for v in variants:
        cohorts = _score_all(dates, region, hyp, v["top"], v["preset"], universe_kind, v["sector_cap"], quiet=True)
        gc.collect()
        results = {d: evaluate_cohort(co.picks, d, hold_months, book) for d, co in cohorts.items()}
        rows = [cohort_stats(results[d], hold_months) for d in dates]
        p = pooled_stats(rows)
        out.append({**v, **{k: p.get(k) for k in ("cohorts", "mean_cohort_ret", "mean_excess", "share_cohorts_beating", "mean_batting_beat")}})
    return out


def _render(out, rows, pooled, cstats, curve, ic, sens, results, cohorts, book, hyp, params) -> None:
    bench_label = params["bench_label"]
    # equity curve chart
    series = {}
    if not curve.empty:
        c = curve.copy()
        base = c.index[0]
        series["Engine (8 overlapping cohorts, equal weight)"] = c["portfolio"] / c["portfolio"].iloc[0] * 100
        series[bench_label] = c["benchmark"] / c["benchmark"].iloc[0] * 100
        if book.bench2 is not None:
            b2 = book.bench2.reindex(c.index).ffill().dropna()
            if len(b2):
                series["RSP total return (equal-weight S&P 500)"] = b2 / b2.iloc[0] * 100
        _ = base
    curve_spec = build_series_chart("curve", f"Overlapping-cohort portfolio vs {bench_label} (rebased to 100)", series, ytitle="index") if series else None
    # cohort return bars as a series chart (cohort mean vs bench)
    done = [r for r in rows if r.get("n")]
    cser = {"Cohort mean return": pd.Series([r["ret_mean"] * 100 for r in done], index=pd.to_datetime([r["formation"] for r in done])),
            f"{bench_label.split(' (')[0]} same window": pd.Series([(r["bench_ret"] or 0) * 100 for r in done], index=pd.to_datetime([r["formation"] for r in done]))}
    cohort_spec = build_series_chart("cohorts", "Return per cohort over the hold (%)", cser, lines=[0.0], ytitle="%") if done else None
    angle_labels = {k: v["label"] for k, v in rules()["angles"].items()}
    html = render.env().get_template("backtest.html.j2").render(
        title="Backtest", params=params, rows=rows, pooled=pooled, cstats=cstats, ic=ic, sens=sens, angle_labels=angle_labels,
        curve_json=to_json(curve_spec) if curve_spec else None, cohort_json=to_json(cohort_spec) if cohort_spec else None,
        decisions=hyp.decisions_touched(), generated=render.now(), assets="../../assets/")
    render.write(out / "index.html", html)
    # per-cohort pages with each pick's chart and frozen reasons
    tpl = render.env().get_template("cohort.html.j2")
    prices_cache = {}
    for d, co in cohorts.items():
        res = {r.security_id: r for r in results[d]}
        picks = []
        for c in co.picks:
            r = res.get(c.security_id)
            if c.security_id not in prices_cache:
                p = read_df("prices_daily", f"security_id = '{c.security_id}'")
                p["date"] = pd.to_datetime(p["date"])
                prices_cache[c.security_id] = p
            px = prices_cache[c.security_id]
            bench = book.bench.reset_index().rename(columns={"level": "level", "date": "date"})
            spec = build_price_chart(c.security_id, c.symbol, px, start=d - pd.Timedelta(days=365), end=(r.exit_date if r and r.exit_date is not None else d) + pd.Timedelta(days=90),
                                     overlays={"price", "benchmark", "window"}, window=(r.entry_date, r.exit_date) if r and r.entry_date is not None else None,
                                     benchmark=bench, compact=True, currency=c.currency)
            spec["id"] = f"pick-{d.date()}-{c.symbol.replace('.', '_')}"
            spec["height"] = 120
            scored = sorted([x for x in c.reasons if x.kind == "factor" and x.contribution is not None], key=lambda x: -abs(x.contribution))[:5]
            picks.append({"c": c, "r": r, "chart_id": spec["id"], "chart_json": to_json(spec),
                          "reasons": [{"rule_id": x.rule_id, "label": x.label, "value": render.fmt_value(x.value, x.unit), "contribution": x.contribution} for x in scored],
                          "angles": {a.key: a.score for a in c.angles}})
        st = next(x for x in rows if x["formation"] == d.date())
        html = tpl.render(title=f"Cohort {d.date()}", formation=d.date(), st=st, picks=picks, params=params, angle_labels=angle_labels,
                          generated=render.now(), assets="../../../assets/")
        render.write(out / "cohorts" / f"{d.date()}.html", html)
    _ = np, has_table
