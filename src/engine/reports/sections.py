"""The pitch report's sections: one per sector call (its story, the equal-weight index chart with the chosen names, the
every-member chart, the member table), each holding its stocks' sections (pitch, valuation-cycle chart, sparkline, the
back-up numbers). Built once per run and shared by the board, the idea pages and the evaluate page."""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from ..research.industry import build_industry_analysis, sector_share_line, share_line_sentences
from ..research.pitch import sector_pitch, stock_pitch
from ..screen.sector_index import member_table, sector_series
from .charts import build_bubble_chart, build_rebased_chart, build_share_line_chart, build_valuation_chart, to_json

STANCE_ORDER = {"overweight": 0, "neutral": 1, "thin": 2, "underweight": 3, "avoid": 4}
MAX_THIN = 60


def _key(s: str) -> str:
    return s.replace(".", "_").replace(" ", "_")


def stock_section(c, view: dict, *, story=None, sector_call=None, kelly_weight=None, phases=None, use_llm: bool, chart_prefix: str = "val", fy=None,
                  lens: bool = True, members: list | None = None, share_line: dict | None = None, hyp=None) -> dict:
    """Everything the stock's section needs: the product lens (for a company that sells a product), the pitch, the
    valuation chart spec (JSON), the implied-growth record."""
    m = c.metrics
    hist = m.get("pe_history") or m.get("ps_history") or []
    vc = m.get("valuation_cycle") or {}
    vspec = build_valuation_chart(f"{chart_prefix}-{_key(c.symbol)}", c.symbol, hist, vc)
    pl = None
    if lens:
        try:
            from ..research.product_lens import build_product_lens

            pl = build_product_lens(c, fy, m.get("implied_growth"), use_llm=use_llm, phases=phases)
        except Exception as e:  # noqa: BLE001 — the section must still render
            print(f"[product lens] {c.symbol}: {e}")
            pl = None
    if pl:
        pl["chart_id"] = pl["chart"]["id"]
        pl["chart_json"] = to_json(pl["chart"]) if not pl["chart"]["empty"] else None
    ia = None
    if members:
        try:
            frames = (pl or {}).get("frames") or {}
            ratio = float(hyp.get("industry.scale_structural_ratio")) if hyp is not None else 2.0
            ia = build_industry_analysis(c, members, rev=frames.get("rev"), ebit=frames.get("ebit"), share_line=share_line, use_llm=use_llm, phases=phases, structural_ratio=ratio)
            key = _key(c.symbol)
            if ia.get("pools"):
                pts = [{"x": r["margin"] * 100, "y": (r["growth"] or 0) * 100, "size": r["revenue"], "label": r["segment"]} for r in ia["pools"]["rows"]]
                mp = build_bubble_chart(f"map-{key}", f"{c.symbol}: the brand map of its segments", pts, x_title="operating margin %", y_title="revenue growth %",
                                        x_ref=ia["pools"]["avg_margin"] * 100, y_ref=ia["pools"]["avg_growth"] * 100, subtitle=f"segment note, FY{ia['pools']['fiscal_year']}")
                ia["map_chart_id"], ia["map_chart_json"] = mp["id"], (to_json(mp) if not mp["empty"] else None)
            if ia.get("share_line"):
                lp = build_share_line_chart(f"line-{key}", (sector_call.label.split(" — ")[0] if sector_call is not None else "sector"), ia["share_line"], highlight=c.symbol)
                ia["line_chart_id"], ia["line_chart_json"] = lp["id"], (to_json(lp) if not lp["empty"] else None)
        except Exception as e:  # noqa: BLE001
            print(f"[industry] {c.symbol}: {e}")
            ia = None
    extra = list((pl or {}).get("docs") or []) + list((ia or {}).get("docs") or [])
    pitch = stock_pitch(c, story, sector_call, kelly_weight, phases, use_llm=use_llm, extra_docs=extra)
    return {"c": view, "pitch": pitch, "val_chart_id": vspec["id"], "val_chart_json": to_json(vspec) if not vspec["empty"] else None,
            "valuation_cycle": vc, "implied_growth": m.get("implied_growth"), "story": story, "kelly_weight": kelly_weight,
            "product_lens": ({k: v for k, v in pl.items() if k not in ("docs", "chart", "frames")} if pl else None),
            "industry": ({k: v for k, v in ia.items() if k not in ("docs",)} if ia else None)}


def build_sections(all_cands, chosen, sector_calls: dict, sizing: dict, as_of: pd.Timestamp, out: Path, *, view_fn, story_fn, phases_fn,
                   use_llm: bool, years: int = 3, region: str = "US", extra_symbols: set[str] | None = None, spark_fn=None, fy_fn=None, hyp=None) -> tuple[list[dict], list[dict]]:
    """Returns (sections, other_sectors). Sections are the sector calls holding at least one chosen name (or an extra
    symbol, for the evaluate page), ordered by stance then score; other_sectors is a compact table of the rest."""
    chosen_ids = {c.security_id for c in chosen}
    weights = sizing.get("weights") or {}
    by_sector: dict[str, list] = {}
    for c in all_cands:
        by_sector.setdefault(c.theme_sector, []).append(c)
    extra = {x.upper() for x in (extra_symbols or set())}
    (out / "charts").mkdir(parents=True, exist_ok=True)
    window_text = f"the last {years} years"
    sections, others = [], []
    calls = sorted(sector_calls.values(), key=lambda s: (STANCE_ORDER.get(s.stance, 9), -(s.score or 0)))
    for sc in calls:
        members = by_sector.get(sc.sector, [])
        picks = [c for c in members if c.security_id in chosen_ids or c.symbol.upper() in extra]
        if not picks:
            others.append({"call": sc.model_dump(), "n": len(members), "line": (sc.rationale[0] if sc.rationale else "")})
            continue
        try:
            ss = sector_series(members, as_of, years, region)
        except Exception as e:  # noqa: BLE001
            print(f"[sections] {sc.sector}: prices unavailable ({e})")
            ss = {"index": pd.Series(dtype=float), "benchmark": pd.Series(dtype=float), "lines": {}, "benchmark_label": "S&P 500 (total return)"}
        label = sc.label.split(" — ")[0]
        idx_name = f"{label} (equal weight, {len(members)} names)"
        series_a = {idx_name: ss["index"], ss["benchmark_label"]: ss["benchmark"]}
        for c in sorted(picks, key=lambda c: -(c.idea_strength or 0)):
            if c.symbol in ss["lines"]:
                series_a[c.symbol] = ss["lines"][c.symbol]
        spec_a = build_rebased_chart(f"sec-{sc.sector}-call", f"{label}: the sector against the market, and the names the engine chose",
                                     series_a, bold={idx_name, *[c.symbol for c in picks]}, dashed={ss["benchmark_label"]},
                                     subtitle=f"{window_text}, total return, rebased to 100 — the bold line is every {label} name at equal weight")
        # chart B: every member (thin), the index bold; above MAX_THIN the largest by market cap are drawn, the rest tabled
        rows = member_table(members, ss["lines"], weights)
        big = sorted(members, key=lambda c: -(c.market_cap or 0))[:MAX_THIN]
        series_b = {idx_name: ss["index"]}
        for c in big:
            if c.symbol in ss["lines"]:
                series_b[c.symbol] = ss["lines"][c.symbol]
        spec_b = build_rebased_chart(f"sec-{sc.sector}-all", f"Every {label} name the engine scored" + (f" (the {MAX_THIN} largest drawn; all {len(members)} in the table)" if len(members) > MAX_THIN else ""),
                                     series_b, bold={idx_name}, subtitle=f"{window_text}, rebased to 100 — hover a line for its name; click a legend entry to isolate it")
        for spec in (spec_a, spec_b):
            (out / "charts" / f"{spec['id']}.json").write_text(to_json(spec))
        chosen_syms = [c.symbol for c in picks]
        # the share line of the sector (framework §6.3): margin against relative share across every scored member
        try:
            sl = sector_share_line(members)
        except Exception as e:  # noqa: BLE001
            print(f"[industry] share line {sc.sector}: {e}")
            sl = None
        sl_spec = build_share_line_chart(f"sec-{sc.sector}-line", label, sl) if sl else None
        pitch = sector_pitch(sc, rows, chosen_syms, as_of.date(), window_text=window_text,
                             barbell="Paul's barbell holds oil at one end and AI/tech at the other; oil's capex discipline has made it less cyclical.", use_llm=use_llm)
        stocks = []
        for c in sorted(picks, key=lambda c: -(c.idea_strength or 0)):
            v = view_fn(c)
            v["kelly_weight"] = weights.get(c.security_id)
            if spark_fn is not None:
                v["chart_json"] = spark_fn(c)
            stocks.append(stock_section(c, v, story=story_fn(c), sector_call=sc, kelly_weight=weights.get(c.security_id), phases=phases_fn(c), use_llm=use_llm,
                                        fy=(fy_fn(c) if fy_fn else None), members=members, share_line=sl, hyp=hyp))
        sections.append({"call": sc.model_dump(), "label": label, "pitch": pitch, "chart_a_id": spec_a["id"], "chart_a_json": to_json(spec_a) if not spec_a["empty"] else None,
                         "chart_b_id": spec_b["id"], "chart_b_json": to_json(spec_b) if not spec_b["empty"] else None, "rows": rows, "n_members": len(members),
                         "n_drawn": min(len(members), MAX_THIN), "stocks": stocks, "window": window_text,
                         "share_line": sl, "share_line_sentences": share_line_sentences(sl) if sl else [],
                         "line_chart_id": sl_spec["id"] if sl_spec else None, "line_chart_json": (to_json(sl_spec) if sl_spec and not sl_spec["empty"] else None)})
    (out / "sections.json").write_text(json.dumps([{"sector": s["call"]["sector"], "pitch": s["pitch"], "stocks": [{"symbol": x["c"]["symbol"], "pitch": x["pitch"],
                                                     "implied_growth": x["implied_growth"], "valuation_cycle": x["valuation_cycle"],
                                                     "product_lens": ({k: v for k, v in x["product_lens"].items() if k not in ("chart_json",)} if x.get("product_lens") else None),
                                                     "industry": ({k: v for k, v in x["industry"].items() if k not in ("map_chart_json", "line_chart_json")} if x.get("industry") else None)} for x in s["stocks"]]} for s in sections],
                                                   indent=1, default=str))
    return sections, others
