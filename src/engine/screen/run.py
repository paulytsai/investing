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
from .metrics import Inputs, compute_metrics
from .models import IdeaCandidate
from .rules import ai_layer_for, asset_type_for, role_hint_for, rules
from .scoring import score_universe, select_top


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
    minfo = master.set_index("security_id")
    cands: list[IdeaCandidate] = []
    for _, u in uni.iterrows():
        sid, sym = u["security_id"], u["symbol"]
        info = minfo.loc[sid] if sid in minfo.index else None
        industry = (info["industry"] if info is not None else u.get("industry"))
        sector = (info["sector"] if info is not None else u.get("sector"))
        at = asset_type_for(sym, industry, sector)
        layer = ai_layer_for(sym, industry, sector)
        px = prices[prices.security_id == sid]
        cap_rows = caps[caps.security_id == sid].sort_values("date")
        mcap = float(cap_rows["market_cap"].iloc[-1]) if not cap_rows.empty else (float(u["market_cap"]) if u.get("market_cap") else None)
        ev = events[events.security_id == sid] if not events.empty else pd.DataFrame()
        snap = snaps[sid]
        m = compute_metrics(Inputs(snap, px, mcap, ev, layer, at), as_of, thr)
        ipo = info["ipo_date"] if info is not None else None
        m["listing_days"] = (as_of - pd.Timestamp(ipo)).days if ipo is not None and pd.notna(ipo) else None
        cands.append(IdeaCandidate(
            security_id=sid, symbol=sym, name=(info["name"] if info is not None else None), region=region, as_of=as_of.date(),
            sector=sector, industry=industry, asset_type=at, ai_layer=layer, role_hint=role_hint_for(sym, at), market_cap=m.get("market_cap"),
            price=m.get("price"), currency=(info["currency"] if info is not None and info["currency"] else "USD"), metrics=m,
            stale=bool(m.get("stale")), basis=m.get("basis", "TTM"), period_end=(m["period_end"].date() if m.get("period_end") is not None else None)))
    return cands


def run_ideas(as_of=None, top: int = 20, regions: list[str] | None = None, preset: str | None = None, narrate: bool = False,
              symbols: list[str] | None = None, out_dir=None, quiet: bool = False) -> dict:
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
    chosen = select_top(all_cands, top, int(max_sector) if max_sector else None)
    run_id = f"{as_of.date()}_{datetime.now().strftime('%H%M%S')}"
    out = out_dir or (REPORTS_DIR / "ideas" / run_id)
    out.mkdir(parents=True, exist_ok=True)
    _render(all_cands, chosen, as_of, out, hyp, preset or hyp.get("screen.preset"), regions, top, narrate)
    (out / "run.json").write_text(json.dumps({"as_of": str(as_of.date()), "title": f"Top {top} ideas ({', '.join(regions)})", "entry": "board.html",
                                              "n_scored": len(all_cands), "preset": preset or hyp.get("screen.preset")}, indent=1))
    (out / "candidates.json").write_text(json.dumps([c.model_dump(mode="json") for c in all_cands], default=str))
    con = ledger()
    con.execute("INSERT OR REPLACE INTO runs VALUES (?,?,?,?,?,?)", [run_id, "ideas", as_of.date(), datetime.now(), json.dumps({"top": top, "regions": regions}), str(out)])
    con.close()
    render.update_index()
    if not quiet:
        print(f"[ideas] {len(all_cands)} scored, {len(chosen)} chosen → {out / 'board.html'}")
        for c in chosen:
            print(f"  #{c.rank:<3} {c.symbol:<6} strength {c.idea_strength:5.1f}  {c.action:<14} {c.action_reason[:70]}")
    return {"run_id": run_id, "path": out, "chosen": chosen, "all": all_cands}


def _view(c: IdeaCandidate) -> dict:
    d = c.model_dump()
    d["angle_map"] = {a.key: a.score for a in c.angles}
    d["mcap_fmt"] = render.fmt_cap(c.market_cap)
    d["price_fmt"] = f"{c.price:,.2f} {c.currency}" if c.price else "–"
    for r in d["reasons"]:
        r["value_fmt"] = render.fmt_value(r["value"], r["unit"])
    for p in d["penalties"]:
        p["value_fmt"] = render.fmt_value(p["value"], p["unit"])
    scored = [r for r in d["reasons"] if r["kind"] == "factor" and r["contribution"] is not None]
    d["top_reasons"] = sorted(scored, key=lambda r: -abs(r["contribution"]))[:3]
    d["chart_id"] = f"spark-{c.symbol.replace('.', '_')}"
    return d


def _render(all_cands, chosen, as_of, out, hyp, preset, regions, top, narrate) -> None:
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
    for c in ranked:
        px = prices[prices.security_id == c.security_id]
        v = _view(c)
        spec = build_price_chart(c.security_id, c.symbol, px, start=as_of - pd.Timedelta(days=3 * 365), end=as_of, overlays={"price"}, compact=True)
        spec["id"] = v["chart_id"]
        v["chart_json"] = to_json(spec)
        if c.eligible:
            board_rows.append(v)
        else:
            excluded.append(v)
    tpl = render.env().get_template("board.html.j2")
    html = tpl.render(title=f"Ideas {as_of.date()}", as_of=as_of.date(), ideas=board_rows[: max(top, len(board_rows))], excluded=excluded, n_scored=len(all_cands),
                      regions=regions, preset=preset, top=top, macro=macro, angle_keys=angle_keys, angle_labels=angle_labels, angle_short=angle_short,
                      sectors=sorted({c.sector for c in all_cands if c.sector}), asset_types=sorted({c.asset_type for c in all_cands}),
                      universe_note=f"{hyp.get('universe.kind')} (cap floor ${hyp.get('universe.cap_floor_usd')/1e9:.0f}B, hypothesis D-53)",
                      winsor=hyp.get("screen.winsor_pct"), cov_min=hyp.get("screen.coverage_min"), generated=render.now(), assets="../../assets/")
    render.write(out / "board.html", html)
    itpl = render.env().get_template("idea.html.j2")
    from ..pit.snapshot import snapshot

    for c in ranked:
        px = prices[prices.security_id == c.security_id]
        ev = events[events.security_id == c.security_id] if not events.empty else pd.DataFrame()
        snap = snapshot(c.security_id, as_of)
        spec = build_price_chart(c.security_id, c.symbol, px, start=as_of - pd.Timedelta(days=10 * 365), end=as_of,
                                 overlays={"price", "price_tr", "pe_band", "eps", "drawdown", "events"}, eps_series=snap.eps_ttm_series(), events=ev,
                                 subtitle="10 years · price, TTM P/E band, TTM EPS, events")
        v = _view(c)
        html = itpl.render(title=f"{c.symbol} — idea", c=v, m=c.metrics, chart_id=spec["id"], chart_json=to_json(spec), macro=macro,
                           n_scored=len(all_cands), phases=None, narrative=None, dcf=None, generated=render.now(), assets="../../../assets/")
        render.write(out / "ideas" / f"{c.symbol}.html", html)
