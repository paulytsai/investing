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
from .cycle import exit_targets, theme_breadth
from .metrics import cohort_stats, curve_stats, pooled_stats, rank_ic, result_by_formation, sector_attribution
from .portfolio import PriceBook, evaluate_cohort, overlapping_curve
from .sizing import kelly_weights


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


class ExitPlan:
    """Cycle-rule machinery for a run: sector stances at every quarterly evaluation (including quarters after the last
    formation date, so late cohorts can be judged), theme breadth, and per-formation exit targets by theme sector."""

    def __init__(self, rule: str, hold_months: int, hyp, eval_dates, stances, themes):
        self.rule, self.hold_months, self.hyp = rule, hold_months, hyp
        self.eval_dates, self.stances, self.themes = eval_dates, stances, themes
        self.breadth = theme_breadth() if rule == "cycle" else {}
        self.min_m = int(hyp.get("backtest.min_hold_months"))
        self.max_m = int(hyp.get("backtest.max_hold_months"))
        self.k = int(hyp.get("backtest.cycle_over_consecutive"))
        self.drop = float(hyp.get("backtest.theme_breadth_drop_pct"))

    def exits(self, formation) -> dict | None:
        if self.rule != "cycle":
            return None
        return exit_targets(formation, self.eval_dates, self.stances, self.themes, self.breadth, self.min_m, self.max_m, self.k, self.drop)

    @property
    def label(self) -> str:
        return (f"cycle exit (min {self.min_m}m, max {self.max_m}m)" if self.rule == "cycle" else f"{self.hold_months}-month hold")

    @property
    def horizon_years(self) -> float:
        return (self.min_m + self.max_m) / 24.0 if self.rule == "cycle" else self.hold_months / 12.0


def _stance_history(cohorts: dict) -> tuple[dict, dict]:
    stances, themes = {}, {}
    for d, co in cohorts.items():
        stances[d] = {k: v.stance for k, v in (co.sector_calls or {}).items()}
        for k, v in (co.sector_calls or {}).items():
            themes[k] = v.theme
    return stances, themes


def _size_and_evaluate(cohorts, dates, book, plan: ExitPlan, hyp, region) -> tuple[dict, dict, dict]:
    """Per formation: cycle exits, Kelly weights (PIT), holding returns for picks and for every eligible name."""
    from ..screen.run import rf_on

    results, all_results, sizing = {}, {}, {}
    for d in dates:
        co = cohorts[d]
        ex = plan.exits(d)
        rf = rf_on(d) if region == "US" else 1.0
        kw = kelly_weights(co.picks, d, book, hyp, plan.horizon_years, rf)
        sizing[d] = kw
        results[d] = evaluate_cohort(co.picks, d, plan.hold_months, book, ex, kw["weights"])
        all_results[d] = evaluate_cohort([c for c in co.scored if c.eligible], d, plan.hold_months, book, ex)
    return results, all_results, sizing


def run_backtest(start="2016-03-31", end="2024-09-30", hold_months=24, top=20, region="us", preset=None, sensitivity=False,
                 universe_kind=None, out_dir=None, exit_rule=None) -> dict:
    hyp = Hypotheses.load()
    region = region.upper()
    bench_label = "SPY total return" if region == "US" else "TOPIX price return (JP total return approximated, labelled)"
    dates = formation_dates(start, end, hyp.get("backtest.cadence"))
    max_sector = int(hyp.get("screen.max_per_sector") or 0) or None
    preset = preset or hyp.get("screen.preset")
    exit_rule = exit_rule or hyp.get("backtest.exit_rule")
    # the cycle rule needs sector calls at every quarter after the last formation date too (up to the last complete quarter)
    last_qe = (pd.Timestamp.today().normalize() - pd.offsets.QuarterEnd(1))
    eval_dates = formation_dates(start, str(min(last_qe, pd.Timestamp(end) + pd.DateOffset(months=int(hyp.get("backtest.max_hold_months")))).date()), hyp.get("backtest.cadence")) if exit_rule == "cycle" else dates
    warm_candidate_cache(eval_dates, region, universe_kind)
    cohorts = _score_all(dates, region, hyp, top, preset, universe_kind, max_sector)
    extra = [d for d in eval_dates if d not in cohorts]
    stances, themes = _stance_history(cohorts)
    if extra:
        later = _score_all(extra, region, hyp, top, preset, universe_kind, max_sector, quiet=True)
        s2, t2 = _stance_history(later)
        stances.update(s2)
        themes.update({k: v for k, v in t2.items() if v})
        del later
        gc.collect()
    plan = ExitPlan(exit_rule, hold_months, hyp, eval_dates, stances, themes)
    all_ids = sorted({c.security_id for co in cohorts.values() for c in co.scored})
    if not all_ids:
        print("no candidates; pull and build data first")
        return {}
    book = PriceBook(all_ids, region)
    results, all_results, sizing = _size_and_evaluate(cohorts, dates, book, plan, hyp, region)
    rows = []
    for d in dates:
        st = cohort_stats(results[d], hold_months, rf=sizing[d]["rf"])
        st["exits"] = {k: {"target": str(v["target"].date()), "reason": v["reason"]} for k, v in (plan.exits(d) or {}).items()
                       if k in {r.theme_sector for r in results[d]}}
        st["kelly_cash"] = sizing[d]["cash"]
        st.update({k: v for k, v in sector_attribution(results[d], all_results[d]).items() if k != "sectors"})
        st["sector_detail"] = sector_attribution(results[d], all_results[d]).get("sectors", {})
        st["sector_calls"] = {k: {"stance": v.stance, "score": v.score, "slots": v.slots} for k, v in (cohorts[d].sector_calls or {}).items()}
        st["formation"] = d.date()
        st["n_scored"], st["n_eligible"] = len(cohorts[d].scored), cohorts[d].n_eligible
        st["picks"] = [r.symbol for r in results[d]]
        st["macro"] = render.macro_strip(d)
        rows.append(st)
    pooled = pooled_stats(rows)
    pooled_open = pooled_stats(rows, include_open=True)
    n_sleeves = max(1, (plan.min_m if exit_rule == "cycle" else hold_months) // 3)
    curve = overlapping_curve(results, book, hold_months)
    curve_k = overlapping_curve(results, book, hold_months, weighted=True)
    cstats = curve_stats(curve, n_sleeves)
    cstats_k = curve_stats(curve_k, n_sleeves) if not curve_k.empty else {}
    angle_keys = list(rules()["angles"].keys())
    ic = rank_ic({d: co.scored for d, co in cohorts.items()}, result_by_formation(all_results), angle_keys)
    sens = run_sensitivity(dates, region, hyp, top, universe_kind, max_sector, book, hold_months, plan, preset, base_cohorts=cohorts) if sensitivity else []
    run_id = f"{start}_{end}_{datetime.now().strftime('%H%M%S')}"
    out = out_dir or (REPORTS_DIR / "backtest" / run_id)
    out.mkdir(parents=True, exist_ok=True)
    params = dict(start=start, end=end, hold_months=hold_months, top=top, region=region, preset=preset, universe_kind=universe_kind or hyp.get("universe.kind"),
                  bench_label=bench_label, bench_short=("SPY" if region == "US" else "TOPIX"), exit_rule=exit_rule, hold_label=plan.label,
                  min_hold=plan.min_m, max_hold=plan.max_m, cycle_k=plan.k, breadth_drop=plan.drop, n_sleeves=n_sleeves,
                  kelly=dict(fraction=float(hyp.get("sizing.kelly.fraction")), cap_pct=float(hyp.get("sizing.kelly.cap_pct")), lookback=int(hyp.get("sizing.kelly.lookback_days")),
                             shrink=float(hyp.get("sizing.kelly.shrink")), horizon_years=plan.horizon_years))
    _render(out, rows, pooled, cstats, curve, ic, sens, results, cohorts, book, hyp, params, pooled_open=pooled_open, cstats_k=cstats_k, curve_k=curve_k, sizing=sizing)
    (out / "run.json").write_text(json.dumps({"as_of": end, "title": f"Backtest {region} {start}→{end}, top {top}, {plan.label}", "entry": "index.html"}))
    (out / "results.json").write_text(json.dumps({"cohorts": rows, "pooled": pooled, "pooled_incl_open": pooled_open, "curve": cstats, "curve_kelly": cstats_k, "rank_ic": ic, "sensitivity": sens,
                                                  "params": params}, default=str, indent=1))
    con = ledger()
    con.execute("INSERT OR REPLACE INTO runs VALUES (?,?,?,?,?,?)", [run_id, "backtest", pd.Timestamp(end).date(), datetime.now(), json.dumps({"top": top, "hold": hold_months}), str(out)])
    con.close()
    render.update_index()
    done = [r for r in rows if r.get("n") and not r.get("in_flight")]
    print(f"[backtest] {len(done)} complete cohorts ({plan.label}); pooled mean cohort return {pooled.get('mean_cohort_ret', 0)*100:.1f}% (Kelly "
          f"{(pooled.get('mean_cohort_ret_kelly') or 0)*100:.1f}%) vs excess {((pooled.get('mean_excess') or 0)*100):+.1f}%; "
          f"batting (beat benchmark) {pooled.get('mean_batting_beat', 0)*100:.0f}% → {out / 'index.html'}")
    return {"path": out, "rows": rows, "pooled": pooled, "curve": cstats, "rank_ic": ic}


def run_sensitivity(dates, region, hyp, top, universe_kind, max_sector, book, hold_months, plan: ExitPlan, preset, base_cohorts=None) -> list[dict]:
    """Variants: exit rules (fixed 24m, fixed 36m, cycle) on the default preset, then presets, name counts and sector cap
    under the run's exit rule. Every row reports the equal-weight and the Kelly-weight cohort return."""
    variants = [{"label": "exit: fixed 24m", "preset": preset, "top": top, "sector_cap": max_sector, "rule": "fixed", "hold": 24},
                {"label": "exit: fixed 36m", "preset": preset, "top": top, "sector_cap": max_sector, "rule": "fixed", "hold": 36},
                {"label": f"exit: cycle (min {plan.min_m}m, max {plan.max_m}m)", "preset": preset, "top": top, "sector_cap": max_sector, "rule": "cycle", "hold": hold_months}]
    for p in hyp._data["screen"]["presets"].keys():
        if p != preset:
            variants.append({"label": f"preset {p}", "preset": p, "top": top, "sector_cap": max_sector, "rule": plan.rule, "hold": hold_months})
    for tn in (10, 30):
        variants.append({"label": f"top {tn}", "preset": preset, "top": tn, "sector_cap": max_sector, "rule": plan.rule, "hold": hold_months})
    variants.append({"label": "no sector cap", "preset": preset, "top": top, "sector_cap": None, "rule": plan.rule, "hold": hold_months})
    out = []
    for v in variants:
        same = base_cohorts is not None and (v["preset"], v["top"], v["sector_cap"]) == (preset, top, max_sector)
        cohorts = base_cohorts if same else _score_all(dates, region, hyp, v["top"], v["preset"], universe_kind, v["sector_cap"], quiet=True)
        gc.collect()
        vplan = ExitPlan(v["rule"], v["hold"], hyp, plan.eval_dates, plan.stances, plan.themes) if (v["rule"], v["hold"]) != (plan.rule, plan.hold_months) else plan
        results, _, sizing = _size_and_evaluate(cohorts, dates, book, vplan, hyp, region)
        rows = [cohort_stats(results[d], v["hold"], rf=sizing[d]["rf"]) for d in dates]
        p = pooled_stats(rows)
        out.append({**{k: v[k] for k in ("label", "preset", "top", "sector_cap")}, "exit": vplan.label,
                    **{k: p.get(k) for k in ("cohorts", "mean_cohort_ret", "mean_excess", "share_cohorts_beating", "mean_batting_beat", "mean_cohort_ret_kelly", "mean_excess_kelly", "mean_hold_years")}})
        del results
        if not same:
            del cohorts
        gc.collect()
    return out


def _render(out, rows, pooled, cstats, curve, ic, sens, results, cohorts, book, hyp, params, pooled_open=None, cstats_k=None, curve_k=None, sizing=None) -> None:
    bench_label = params["bench_label"]
    sizing = sizing or {}
    # equity curve chart
    series = {}
    if not curve.empty:
        c = curve.copy()
        base = c.index[0]
        series["Engine (overlapping cohorts, equal weight)"] = c["portfolio"] / c["portfolio"].iloc[0] * 100
        if curve_k is not None and not curve_k.empty:
            ck = curve_k["portfolio"].reindex(c.index).ffill().dropna()
            series["Engine (Kelly weights, cash remainder)"] = ck / ck.iloc[0] * 100
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
        title="Backtest", params=params, rows=rows, pooled=pooled, pooled_open=pooled_open or {}, cstats=cstats, cstats_k=cstats_k or {}, ic=ic, sens=sens, angle_labels=angle_labels,
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
            kb = (sizing.get(d) or {}).get("blocks", {}).get(c.security_id)
            picks.append({"c": c, "r": r, "chart_id": spec["id"], "chart_json": to_json(spec),
                          "reasons": [{"rule_id": x.rule_id, "label": x.label, "value": render.fmt_value(x.value, x.unit), "contribution": x.contribution} for x in scored],
                          "angles": {a.key: a.score for a in c.angles}, "kelly": kb, "weight": (sizing.get(d) or {}).get("weights", {}).get(c.security_id)})
        st = next(x for x in rows if x["formation"] == d.date())
        html = tpl.render(title=f"Cohort {d.date()}", formation=d.date(), st=st, picks=picks, params=params, angle_labels=angle_labels,
                          sizing=sizing.get(d) or {}, generated=render.now(), assets="../../../assets/")
        render.write(out / "cohorts" / f"{d.date()}.html", html)
    _ = np, has_table
