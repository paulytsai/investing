"""`engine ideas`: universe → PIT snapshots → metrics → scoring → board + idea pages."""
from __future__ import annotations

import json
from datetime import date, datetime

import pandas as pd

from ..config import REPORTS_DIR, Hypotheses
from ..pit.snapshot import snapshot_all
from ..pit.universe import members
from ..reports import render
from ..reports.charts import build_price_chart, to_json
from ..store import has_table, ledger, read_df
from .metrics import void_if_currency_mismatch, Inputs, compute_metrics
from .models import IdeaCandidate
from .rules import ai_layer_for, asset_type_for, role_hint_for, rules
from .scoring import score_universe, select_top


def _jsonable(o):
    import numpy as np

    if isinstance(o, dict):
        return {k: _jsonable(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_jsonable(v) for v in o]
    if isinstance(o, (pd.Timestamp, date)):
        return str(pd.Timestamp(o).date())
    if isinstance(o, (np.floating, float)):
        return None if (np.isnan(o) or np.isinf(o)) else float(o)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, np.bool_):
        return bool(o)
    return o


def rf_on(as_of) -> float:
    """10-yr UST (DGS10) visible at as_of — the hurdle anchor (user-flagged benchmark; spec I-01)."""
    df = read_df("macro_daily", f"series_id = 'DGS10' AND date <= DATE '{pd.Timestamp(as_of).date()}'") if has_table("macro_daily") else pd.DataFrame()
    if df.empty:
        return 4.0
    return float(df.sort_values("date")["value"].iloc[-1])


def run_dcf(m: dict, snap, asset_type: str, rf_pct: float, hyp: Hypotheses) -> dict | None:
    from ..frameworks.dcf import DCFInputs, hurdle_check, scenario_dcf

    price, shares = m.get("price"), (snap.metrics.get("shares_diluted") if snap else None)
    if not price or not shares:
        return None
    params = {k: (hyp.get(f"dcf.{k}") if k != "scenarios" else hyp._data["dcf"]["scenarios"]) for k in
              ("erp_pct", "beta_floor", "beta_cap", "terminal_growth_pct", "horizon_years", "growth_cap_pct", "scenarios")}
    mid = None
    fy = snap.fy_history if snap else None
    if asset_type in ("commodity_cyclical", "miner_resource") and fy is not None and {"fcf", "revenue"} <= set(fy.columns):
        mm = (fy["fcf"] / fy["revenue"]).dropna()
        mid = float(mm.median()) if len(mm) >= 5 else None
    inp = DCFInputs(price=float(price), shares=float(shares), net_debt=float(m.get("net_debt") or 0.0), fcf_ttm=m.get("fcf_ttm") or 0.0,
                    revenue_ttm=m.get("revenue_ttm"), trailing_growth=m.get("rev_cagr_3y"), rf_pct=rf_pct, beta=1.0, asset_type=asset_type, mid_cycle_margin=mid)
    res = hurdle_check(scenario_dcf(inp, params), rf_pct, float(hyp.get("thresholds.hurdle_margin_pct")))
    d = res.__dict__.copy()
    d["summary"] = res.summary()
    d["range_per_share"] = list(res.range_per_share)
    return d


def last_trading_day(as_of=None) -> pd.Timestamp:
    cal = read_df("trading_calendar", "region = 'US'")
    d = pd.Timestamp(as_of) if as_of else pd.Timestamp(date.today())
    c = pd.to_datetime(cal["date"])
    c = c[c <= d]
    return pd.Timestamp(c.max()) if len(c) else d


def build_candidates(as_of: pd.Timestamp, region: str, hyp: Hypotheses, symbols: list[str] | None = None) -> list[IdeaCandidate]:
    master = read_df("security_master", f"region = '{region}'")
    if symbols:
        uni = master[master.symbol.isin(symbols)][["security_id", "symbol", "sector", "industry"]].copy()
        uni["market_cap"] = None
    else:
        uni = members(as_of, region, hyp)
    if uni.empty:
        return []
    ids = uni["security_id"].tolist()
    snaps = snapshot_all(as_of, ids)
    id_list = ",".join("'" + i + "'" for i in ids)
    prices = read_df("prices_daily", f"security_id IN ({id_list}) AND date <= DATE '{as_of.date()}'")
    prices["date"] = pd.to_datetime(prices["date"])
    caps = read_df("market_cap_daily", f"security_id IN ({id_list}) AND date <= DATE '{as_of.date()}' AND date >= DATE '{(as_of - pd.Timedelta(days=45)).date()}'")
    events = read_df("events", f"security_id IN ({id_list}) AND available_from <= DATE '{as_of.date()}' AND event_date >= DATE '{(as_of - pd.Timedelta(days=400)).date()}'") if has_table("events") else pd.DataFrame()
    thr = {k: v["value"] if isinstance(v, dict) else v for k, v in hyp._data.get("thresholds", {}).items()}
    for k in list(thr):
        hyp.get(f"thresholds.{k}")
    for k in ("cycle_trough_pctile", "cycle_peak_pctile"):
        thr[k] = hyp.get(f"valuation.{k}")
    ig_params = {"hurdle_margin_pct": float(hyp.get("thresholds.hurdle_margin_pct")), "years": int(hyp.get("valuation.implied_growth_years")),
                 "exit_pe_fallback": float(hyp.get("valuation.exit_pe_fallback")), "mature_margin_pct": float(hyp.get("valuation.mature_margin_pct")),
                 "hypergrowth_min_rev_growth_pct": float(hyp.get("valuation.hypergrowth_min_rev_growth_pct"))}
    rf_pct = rf_on(as_of)
    from ..frameworks.implied_growth import implied_growth
    # text layer: lexical signals (point-in-time, backtestable) and Claude reads (live-only)
    from ..text.build import signals_for, text_factors
    from ..text.read import reads_for

    tsig = signals_for(as_of, ids)
    tsig_by = {k: g for k, g in tsig.groupby("security_id")} if not tsig.empty else {}
    treads = reads_for(as_of, ids)
    treads_by = treads.set_index("security_id") if not treads.empty else None
    from ..text.themes import theme_factors_for

    theme_by = theme_factors_for(as_of, ids)
    minfo = master.set_index("security_id")
    # one pass of grouping instead of a full-frame boolean filter per name (matters at 2,500+ names per date)
    px_by = {k: g for k, g in prices.groupby("security_id", sort=False)} if not prices.empty else {}
    caps_by = {k: g.sort_values("date") for k, g in caps.groupby("security_id", sort=False)} if not caps.empty else {}
    ev_by = {k: g for k, g in events.groupby("security_id", sort=False)} if not events.empty else {}
    empty_px, empty_ev = prices.iloc[0:0], (events.iloc[0:0] if not events.empty else pd.DataFrame())
    cands: list[IdeaCandidate] = []
    for _, u in uni.iterrows():
        sid, sym = u["security_id"], u["symbol"]
        info = minfo.loc[sid] if sid in minfo.index else None
        industry = (info["industry"] if info is not None else u.get("industry"))
        sector = (info["sector"] if info is not None else u.get("sector"))
        at = asset_type_for(sym, industry, sector)
        layer = ai_layer_for(sym, industry, sector)
        px = px_by.get(sid, empty_px)
        cap_rows = caps_by.get(sid)
        mcap = float(cap_rows["market_cap"].iloc[-1]) if cap_rows is not None and not cap_rows.empty else (float(u["market_cap"]) if u.get("market_cap") else None)
        ev = ev_by.get(sid, empty_ev)
        snap = snaps[sid]
        m = compute_metrics(Inputs(snap, px, mcap, ev, layer, at), as_of, thr)
        m = void_if_currency_mismatch(m, snap, (info["currency"] if info is not None and info["currency"] else "USD"))
        ipo = info["ipo_date"] if info is not None else None
        m["listing_days"] = (as_of - pd.Timestamp(ipo)).days if ipo is not None and pd.notna(ipo) else None
        m.update(text_factors(tsig_by.get(sid)))
        m.update(theme_by.get(sid, {}))
        if treads_by is not None and sid in treads_by.index:
            tr = treads_by.loc[sid]
            m.update({"llm_demand": float(tr["demand"]), "llm_pricing": float(tr["pricing_power"]), "llm_position": float(tr["competitive_position"]),
                      "llm_guidance": float(tr["guidance"]), "llm_tone": float(tr["tone"]), "llm_red_flags": float(tr["red_flags_n"]),
                      "llm_is_number_one": bool(tr["is_number_one"]), "llm_one_line": str(tr["payload"])[:0] or None})
            try:
                m["llm_one_line"] = json.loads(tr["payload"]).get("one_line")
            except Exception:  # noqa: BLE001
                pass
        m["dcf"] = None if m.get("currency_mismatch") else run_dcf(m, snap, at, rf_pct, hyp)
        if m["dcf"] and m["dcf"].get("implied_growth_gap_pp") is not None:
            m["implied_growth_gap"] = m["dcf"]["implied_growth_gap_pp"]
        # what the price assumes (F-16 / F-91): earnings growth solved backwards from today's multiple — in every thesis
        m["implied_growth"] = None if m.get("currency_mismatch") else implied_growth(m, rf_pct=rf_pct, **ig_params)
        period_end = m["period_end"].date() if m.get("period_end") is not None else None
        cands.append(IdeaCandidate(
            security_id=sid, symbol=sym, name=(info["name"] if info is not None else None), region=region, as_of=as_of.date(),
            sector=sector, industry=industry, country=(str(info["country"]) if info is not None and "country" in info.index and pd.notna(info["country"]) else None),
            asset_type=at, ai_layer=layer, role_hint=role_hint_for(sym, at), market_cap=m.get("market_cap"),
            price=m.get("price"), currency=(info["currency"] if info is not None and info["currency"] else "USD"), metrics=_jsonable(m),
            stale=bool(m.get("stale")), basis=m.get("basis", "TTM"), period_end=period_end))
    return cands


def run_ideas(as_of=None, top: int = 20, regions: list[str] | None = None, preset: str | None = None, narrate: bool = False,
              symbols: list[str] | None = None, out_dir=None, quiet: bool = False, narrate_symbols: list[str] | None = None, pitch: bool = True) -> dict:
    hyp = Hypotheses.load()
    as_of = last_trading_day(as_of)
    regions = [r.upper() for r in (regions or ["US"])]
    all_cands: list[IdeaCandidate] = []
    for region in regions:
        cands = build_candidates(as_of, region, hyp, symbols)
        if cands:
            score_universe(cands, hyp, preset)
            all_cands.extend(cands)
    if not all_cands:
        print("no candidates (run `engine pull` and `engine build pit` first)")
        return {}
    max_sector = hyp.get("screen.max_per_sector")
    from .sectors import evaluate_sectors

    sector_calls = evaluate_sectors(all_cands, as_of, hyp)          # stage 1: the sector call, before any stock is chosen
    chosen = select_top(all_cands, top, int(max_sector) if max_sector else None, sector_calls)
    sizing = size_positions(chosen, as_of, hyp)                     # Kelly: per-name scenario Kelly + portfolio Kelly weights
    from .sectors import sector_bets

    sector_bets(sector_calls, all_cands, as_of, sizing)             # the recommended sector bet, written onto each call
    run_id = f"{as_of.date()}_{datetime.now().strftime('%H%M%S')}"
    out = out_dir or (REPORTS_DIR / "ideas" / run_id)
    out.mkdir(parents=True, exist_ok=True)
    (out / "sectors.json").write_text(json.dumps({k: v.model_dump(mode="json") for k, v in sector_calls.items()}, indent=1, default=str))
    (out / "sizing.json").write_text(json.dumps({"weights": sizing.get("weights"), "cash": sizing.get("cash"), "rf": sizing.get("rf"), "params": sizing.get("params"),
                                                 "blocks": {k: v for k, v in (sizing.get("blocks") or {}).items()}}, indent=1, default=str))
    (out / "run.json").write_text(json.dumps({"as_of": str(as_of.date()), "title": f"Top {top} ideas ({', '.join(regions)})", "entry": "board.html",
                                              "n_scored": len(all_cands), "preset": preset or hyp.get("screen.preset")}, indent=1))
    (out / "candidates.json").write_text(json.dumps([c.model_dump(mode="json") for c in all_cands], default=str))
    changes = None
    if not symbols and not narrate_symbols:          # a full screen: what changed since the previous full screen
        from .diff import diff_runs, full_runs

        prev = [r for r in full_runs(regions[0]) if r.resolve() != out.resolve()]
        if prev:
            try:
                changes = diff_runs(prev[-1], out)
            except Exception as e:  # noqa: BLE001
                print(f"[ideas] diff vs previous run failed: {e}")
    _render(all_cands, chosen, as_of, out, hyp, preset or hyp.get("screen.preset"), regions, top, narrate, narrate_symbols, sector_calls, sizing, changes, pitch=pitch)
    con = ledger()
    con.execute("INSERT OR REPLACE INTO runs VALUES (?,?,?,?,?,?)", [run_id, "ideas", as_of.date(), datetime.now(), json.dumps({"top": top, "regions": regions}), str(out)])
    con.close()
    render.update_index()
    if not quiet:
        print(f"[ideas] {len(all_cands)} scored, {len(chosen)} chosen → {out / 'board.html'}")
        for sc in sorted(sector_calls.values(), key=lambda x: -(x.score or 0)):
            print(f"  [sector] {sc.stance:<12} {sc.label[:44]:<44} score {sc.score if sc.score is not None else float('nan'):5.1f} members {sc.n_members:4d} slots {sc.slots}")
            if sc.bet:
                print(f"           bet: {sc.bet['summary']}")
                print(f"           why: {'; '.join(sc.rationale[1:4])}")
        for c in chosen:
            w = (sizing.get("weights") or {}).get(c.security_id)
            print(f"  #{c.rank:<3} {c.symbol:<6} strength {c.idea_strength:5.1f}  {c.action:<14} {c.theme_sector:<18} kelly {(w or 0)*100:4.1f}%  {c.action_reason[:60]}")
        print(f"  [kelly] gross {(1 - sizing.get('cash', 1.0))*100:.0f}% invested, cash {sizing.get('cash', 1.0)*100:.0f}% (half Kelly, 15% cap, r_f {sizing.get('rf', 0)*100:.1f}%)")
    return {"run_id": run_id, "path": out, "chosen": chosen, "all": all_cands, "sizing": sizing}


def size_positions(chosen: list[IdeaCandidate], as_of: pd.Timestamp, hyp: Hypotheses, overrides: dict | None = None) -> dict:
    """Kelly sizing for the chosen names (D-01 hypothesis): scenario Kelly per name from its DCF, portfolio Kelly across
    the book from the trailing covariance. Horizon = the cycle rule's expected hold."""
    if not chosen:
        return {"weights": {}, "cash": 1.0, "blocks": {}, "rf": 0.0}
    from ..backtest.portfolio import PriceBook
    from ..backtest.sizing import kelly_weights

    region = chosen[0].security_id.split(":")[0]
    try:
        book = PriceBook([c.security_id for c in chosen], region)
    except Exception as e:  # noqa: BLE001 — sizing is advisory; the board must still render
        print(f"[kelly] prices unavailable ({e}); no sizing")
        return {"weights": {}, "cash": 1.0, "blocks": {}, "rf": 0.0}
    horizon = (int(hyp.get("backtest.min_hold_months")) + int(hyp.get("backtest.max_hold_months"))) / 24.0
    return kelly_weights(chosen, as_of, book, hyp, horizon, rf_on(as_of) if region == "US" else 1.0, overrides)


def _view(c: IdeaCandidate) -> dict:
    d = c.model_dump()
    d["angle_map"] = {a.key: a.score for a in c.angles}
    d["mcap_fmt"] = render.fmt_cap(c.market_cap, c.currency)
    d["price_fmt"] = f"{c.price:,.2f} {c.currency}" if c.price else "–"
    for r in d["reasons"]:
        r["value_fmt"] = render.fmt_value(r["value"], r["unit"])
    for p in d["penalties"]:
        p["value_fmt"] = render.fmt_value(p["value"], p["unit"])
    scored = [r for r in d["reasons"] if r["kind"] == "factor" and r["contribution"] is not None]
    d["top_reasons"] = sorted(scored, key=lambda r: -abs(r["contribution"]))[:3]
    d["chart_id"] = f"spark-{c.symbol.replace('.', '_')}"
    return d


def _spark(c, px, as_of, chart_id: str) -> str | None:
    spec = build_price_chart(c.security_id, c.symbol, px, start=as_of - pd.Timedelta(days=3 * 365), end=as_of, overlays={"price"}, compact=True, currency=c.currency)
    spec["id"] = chart_id
    return None if spec["empty"] else to_json(spec)


def _render(all_cands, chosen, as_of, out, hyp, preset, regions, top, narrate, narrate_symbols=None, sector_calls=None, sizing=None, changes=None,
            pitch: bool = True, extra_symbols: set[str] | None = None) -> dict:
    """Write board.html and ideas/*.html. Returns {"sections": [...], "others": [...]} — the sector-grouped pitch sections,
    reused by the evaluate page. `pitch` = write the stories with Claude for the chosen names (cached by request hash;
    deterministic prose otherwise)."""
    sizing = sizing or {}
    r = rules()
    angle_keys = list(r["angles"].keys())
    angle_labels = {k: v["label"] for k, v in r["angles"].items()}
    angle_short = {"story_growth": "Story", "moat": "Moat", "quality": "Quality", "on_sale": "On sale", "asymmetry": "Asym", "alignment": "Align",
                   "fundamental_momentum": "Momentum", "portfolio_fit": "Fit"}
    macro = render.macro_strip(as_of)
    ids = ",".join("'" + c.security_id + "'" for c in all_cands)
    prices = read_df("prices_daily", f"security_id IN ({ids}) AND date <= DATE '{as_of.date()}'")
    events = read_df("events", f"security_id IN ({ids}) AND event_date <= DATE '{as_of.date()}'") if has_table("events") else pd.DataFrame()
    ranked = sorted([c for c in all_cands if c.idea_strength is not None], key=lambda c: -(c.idea_strength or 0))
    board_rows, excluded = [], []
    px_by = {k: g for k, g in prices.groupby("security_id", sort=False)} if not prices.empty else {}
    spark_rows = max(top * 10, 200)          # sparklines only for the top rows: a 2,000-name board with charts is 20+ MB
    for i, c in enumerate(ranked):
        v = _view(c)
        v["kelly_weight"] = (sizing.get("weights") or {}).get(c.security_id)
        v["chart_json"] = _spark(c, px_by.get(c.security_id, prices.iloc[0:0]), as_of, v["chart_id"]) if i < spark_rows else None
        if c.eligible:
            board_rows.append(v)
        else:
            excluded.append(v)
    scalls = sorted((sector_calls or {}).values(), key=lambda c: -(c.score or 0))
    from ..frameworks.danoff import danoff_sector
    from ..screen.commodity import group_for

    dgroups: dict[str, dict] = {}
    for g, lab in (("oil_gas", "Oil & gas"), ("memory", "Memory & storage")):
        reads = [(c.metrics.get("danoff"), c.symbol) for c in all_cands if c.eligible and group_for(c.industry, c.symbol) == g and c.metrics.get("danoff")]
        if reads:
            dgroups[lab] = danoff_sector([r for r, _ in reads], [sy for _, sy in reads])
    # per-name page data (prices, events, snapshot, phases, story) computed once and shared by the sections and the pages
    from ..drivers.phases import build_phases, phases_to_dicts
    from ..pit.snapshot import snapshot
    from ..research.story import build_story

    bench = read_df("benchmark_daily", "benchmark_id = 'SPY_TR'")
    bench["date"] = pd.to_datetime(bench["date"])
    bench_s = bench.set_index("date")["level"].sort_index()
    page_cache: dict[str, dict] = {}

    def page_data(c) -> dict:
        if c.security_id in page_cache:
            return page_cache[c.security_id]
        px = prices[prices.security_id == c.security_id]
        ev = events[events.security_id == c.security_id] if not events.empty else pd.DataFrame()
        snap = snapshot(c.security_id, as_of)
        eps = snap.eps_ttm_series()
        try:
            phases = phases_to_dicts(build_phases(px[px.date >= as_of - pd.Timedelta(days=10 * 365)], eps, bench_s, ev,
                                                  float(hyp.get("drivers.zigzag_threshold_pct")), int(hyp.get("drivers.min_phase_weeks")), float(hyp.get("drivers.macro_bench_move_pct"))))
        except Exception:  # noqa: BLE001
            phases = []
        try:
            story = build_story(c, snap.fy_history, (sector_calls or {}).get(c.theme_sector))
        except Exception as e:  # noqa: BLE001
            print(f"[story] {c.symbol}: {e}")
            story = None
        page_cache[c.security_id] = {"px": px, "ev": ev, "snap": snap, "eps": eps, "phases": phases, "story": story}
        return page_cache[c.security_id]

    # the pitch report: one section per sector call that holds a chosen name, each with its stories and charts
    from ..reports.sections import build_sections, stock_section

    region = (regions or ["US"])[0].upper()
    sections, others = build_sections(all_cands, chosen, sector_calls or {}, sizing, as_of, out, view_fn=_view, story_fn=lambda c: page_data(c)["story"],
                                      phases_fn=lambda c: page_data(c)["phases"], use_llm=pitch, region=region, extra_symbols=extra_symbols,
                                      spark_fn=lambda c: _spark(c, px_by.get(c.security_id, prices.iloc[0:0]), as_of, _view(c)["chart_id"]),
                                      fy_fn=lambda c: page_data(c)["snap"].fy_history, hyp=hyp)
    section_of = {x["c"]["symbol"]: (sec, x) for sec in sections for x in sec["stocks"]}
    tpl = render.env().get_template("board.html.j2")
    html = tpl.render(title=f"Ideas {as_of.date()}", as_of=as_of.date(), ideas=board_rows[: max(top, len(board_rows))], excluded=excluded, n_scored=len(all_cands),
                      sector_calls=scalls, sector_map={k: v.model_dump() for k, v in (sector_calls or {}).items()}, changes=changes, danoff_groups=dgroups,
                      sections=sections, other_sectors=others,
                      regions=regions, preset=preset, top=top, macro=macro, angle_keys=angle_keys, angle_labels=angle_labels, angle_short=angle_short,
                      sectors=sorted({c.sector for c in all_cands if c.sector}), asset_types=sorted({c.asset_type for c in all_cands}),
                      universe_note=f"{hyp.get('universe.kind')} (cap floor ${hyp.get('universe.cap_floor_usd')/1e9:.0f}B, hypothesis D-53)",
                      winsor=hyp.get("screen.winsor_pct"), cov_min=hyp.get("screen.coverage_min"), generated=render.now(), assets="../../assets/")
    render.write(out / "board.html", html)
    itpl = render.env().get_template("idea.html.j2")
    # pages: the chosen names always (they are the sector-selected book, not necessarily the top-N by rank), then the
    # ranked tail; with --narrate only the chosen names get pages (each narrative is three Claude calls)
    chosen_ids = {c.security_id for c in chosen}
    pages = list(chosen) if narrate else (list(chosen) + [c for c in ranked[: max(top * 5, 100)] if c.security_id not in chosen_ids])
    if narrate_symbols:   # `engine research SYM`: scored against the whole region, page + narrative for these only
        want = {x.upper() for x in narrate_symbols}
        pages = [c for c in all_cands if c.symbol.upper() in want]
    for c in pages:
        pdata = page_data(c)
        px, ev, eps, phases, story = pdata["px"], pdata["ev"], pdata["eps"], pdata["phases"], pdata["story"]
        spec = build_price_chart(c.security_id, c.symbol, px, start=as_of - pd.Timedelta(days=10 * 365), end=as_of,
                                 overlays={"price", "price_tr", "pe_band", "eps", "drawdown", "events", "phases"}, eps_series=eps, events=ev, phases=phases,
                                 subtitle="10 years · price, TTM P/E band, TTM EPS, events, phases", currency=c.currency)
        v = _view(c)
        narrative = None
        if narrate and (c in chosen or (narrate_symbols and c.symbol.upper() in {x.upper() for x in narrate_symbols})):
            from ..research.stages import narrative_html

            narrative = narrative_html(c, pdata["snap"], phases)
        sec_pair = section_of.get(c.symbol)
        if sec_pair:
            section, stock = sec_pair
        else:   # a page outside the book: the same section, deterministic prose (no model call for the ranked tail)
            section, stock = None, stock_section(c, v, story=story, sector_call=(sector_calls or {}).get(c.theme_sector),
                                                 kelly_weight=(sizing.get("weights") or {}).get(c.security_id), phases=phases, use_llm=False, lens=False)
        html = itpl.render(title=f"{c.symbol} — idea", c=v, m=c.metrics, chart_id=spec["id"], chart_json=to_json(spec), macro=macro,
                           n_scored=len(all_cands), phases=phases, narrative=narrative, dcf=c.metrics.get("dcf"), generated=render.now(), assets="../../../assets/",
                           kelly=(sizing.get("blocks") or {}).get(c.security_id), kelly_weight=(sizing.get("weights") or {}).get(c.security_id), n_top=len(chosen),
                           sector_call=(sector_calls or {}).get(c.theme_sector), story=story, stock=stock, section=section)
        render.write(out / "ideas" / f"{c.symbol}.html", html)
    return {"sections": sections, "others": others}
