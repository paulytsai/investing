"""Industry and company analysis applied to a public company (docs/frameworks/INDUSTRY_COMPANY_ANALYSIS.md §10), live layer
like the product lens: segment profit pools and the brand map (§3.6) from the 10-K segment note, the share/profit line and
market environment inside the theme sector (§6.3–6.4), the margin gap to the best-margin peer bridged by spine stage (§5.3–5.4),
the performance-gap diagnosis (§5.5), and a Claude read of the battlefields with insights in the §10.3 template. Framework math
lives in `frameworks/industry.py`; this module arranges the engine's data and writes the docs for the pitch."""
from __future__ import annotations

import json
import math

import pandas as pd
from pydantic import BaseModel, Field

from ..frameworks import industry as fw
from .context import SYSTEM, _doc, build_context, financial_read
from .llm import NarrativeUnavailable, parse_structured
from .schemas import Claim

MIN_PEERS = 6


def _m(c, k):
    m = c.metrics if not isinstance(c, dict) else c.get("metrics", {})
    return m.get(k)


def _sym(c):
    return c.symbol if not isinstance(c, dict) else c.get("symbol")


# ---------------------------------------------------------------- sector-level: the share line (§6.3) and environments (§6.4)
def sector_share_line(members: list, cfg: dict | None = None) -> dict | None:
    """Across a theme sector's scored members: relative share = TTM revenue ÷ the largest member's revenue; ROS = operating margin.
    Fit ROS = a + b·ln(relative share); residual per member; the market environment from the share index and the sector's median
    revenue growth. Returns None with fewer than MIN_PEERS usable members."""
    cfg = cfg or fw.DEFAULTS
    rows = []
    for c in members:
        rev, om, g = _m(c, "revenue_ttm"), _m(c, "operating_margin"), _m(c, "rev_growth_ttm")
        if rev and rev > 0 and om is not None and -1 < om < 1:
            rows.append({"symbol": _sym(c), "revenue": float(rev), "ros": float(om), "growth": g})
    if len(rows) < MIN_PEERS:
        return None
    biggest = max(r["revenue"] for r in rows)
    for r in rows:
        r["share_index"] = r["revenue"] / biggest
    # the leader's index vs the second player (the source's "main competitor" ratio)
    srt = sorted(rows, key=lambda r: -r["revenue"])
    second = srt[1]["revenue"] if len(srt) > 1 else biggest
    srt[0]["share_index"] = biggest / second if second else 1.0
    line = fw.share_profit_line([r["share_index"] for r in rows], [r["ros"] for r in rows])
    growths = sorted(r["growth"] for r in rows if r["growth"] is not None)
    med_growth = growths[len(growths) // 2] if growths else 0.0
    for r, res in zip(rows, line["residuals"]):
        r["residual"] = res
        r["predicted_ros"] = r["ros"] - res
        r["environment"] = fw.market_environment(r["share_index"], med_growth, cfg)
    env_mix = {}
    for r in rows:
        env_mix[r["environment"]] = env_mix.get(r["environment"], 0) + 1
    return {"n": len(rows), "a_ros_at_parity": line["a_ros_at_parity"], "ros_gain_per_doubling": line["ros_gain_per_doubling"], "sector_growth": med_growth,
            "rows": sorted(rows, key=lambda r: -r["revenue"]), "environment_mix": env_mix, "leader": srt[0]["symbol"],
            "over_earners": [r["symbol"] for r in sorted(rows, key=lambda r: -r["residual"])[:max(3, len(rows) // 5)] if r["residual"] > 0],
            "under_earners": [r["symbol"] for r in sorted(rows, key=lambda r: r["residual"])[:max(3, len(rows) // 5)] if r["residual"] < 0]}


def share_line_sentences(sl: dict, symbol: str | None = None) -> list[str]:
    if not sl:
        return []
    out = [f"Across the {sl['n']} names the engine scored in this sector, operating margin rises {sl['ros_gain_per_doubling']*100:.1f} points for every doubling of relative "
           f"share (the share line; {sl['a_ros_at_parity']*100:.0f}% at parity with the main competitor). {sl['leader']} is the leader."]
    out.append("Earning more than their share predicts: " + ", ".join(sl["over_earners"][:4]) + "; less: " + ", ".join(sl["under_earners"][:4]) + ".")
    if symbol:
        r = next((x for x in sl["rows"] if x["symbol"] == symbol), None)
        if r:
            out.append(f"{symbol} runs at {r['share_index']:.2f}× the {'second player' if r['symbol'] == sl['leader'] else 'leader'}'s revenue — {fw.ENVIRONMENT_WORDS.get(r['environment'], r['environment'])} — "
                       f"and earns {abs(r['residual'])*100:.1f} points {'more' if r['residual'] >= 0 else 'less'} than its share predicts ({r['ros']*100:.0f}% against {r['predicted_ros']*100:.0f}%).")
    return out


# ---------------------------------------------------------------- company-level
def segment_profit_pools(rev: pd.DataFrame | None, ebit: pd.DataFrame | None) -> dict | None:
    """Whale curve and brand-map imperatives for the reported segments (§3.6), from the latest fiscal year of the segment note."""
    if rev is None or rev.empty or ebit is None or ebit.empty or len(rev) < 2:
        return None
    segs = [c for c in rev.columns if c != "total" and c in ebit.columns]
    last, prev = rev.iloc[-1], rev.iloc[-2]
    units = [(s, float(last[s]), float(ebit[s].iloc[-1])) for s in segs if pd.notna(last[s]) and pd.notna(ebit[s].iloc[-1]) and last[s] > 0]
    if len(units) < 2:
        return None
    w = fw.whale_curve(units)
    tot_rev = sum(u[1] for u in units)
    tot_prof = sum(u[2] for u in units)
    avg_margin = tot_prof / tot_rev if tot_rev else 0.0
    growths = {s: (float(last[s]) / float(prev[s]) - 1) if pd.notna(prev[s]) and prev[s] > 0 else None for s in segs}
    gl = [g for g in growths.values() if g is not None]
    avg_growth = sum(gl) / len(gl) if gl else 0.0
    rows = []
    for name, rv, pf in sorted(units, key=lambda u: -(u[2] / u[1])):
        rows.append({"segment": name, "revenue": rv, "profit": pf, "margin": pf / rv, "growth": growths.get(name),
                     "imperative": fw.brand_map_imperative(pf / rv, growths.get(name), avg_margin, avg_growth)})
    top = rows[0]
    conc = sum(r["profit"] for r in rows[:2]) / tot_prof if tot_prof > 0 else None
    return {"rows": rows, "whale": {k: w[k] for k in ("peak_cumulative_profit", "total_profit", "unprofitable_count_share", "unprofitable_revenue_share", "unprofitable_loss")},
            "avg_margin": avg_margin, "avg_growth": avg_growth, "top_two_profit_share": conc, "fiscal_year": str(rev.index[-1]),
            "sentence": (f"The profit pools: {top['segment']} earns the best margin ({top['margin']*100:.0f}%); the two most profitable segments make "
                         + (f"{conc*100:.0f}% of segment profit" if conc is not None else "the profit") + "; "
                         + (f"{w['unprofitable_count_share']*100:.0f}% of segments lose money ({w['unprofitable_revenue_share']*100:.0f}% of revenue)." if w["unprofitable_loss"] < 0 else "no segment loses money.")
                         + " Imperatives: " + "; ".join(f"{r['segment']} — {r['imperative']}" for r in rows) + ".")}


def peer_gap(c, members: list, structural_ratio: float = 2.0) -> dict | None:
    """The operating-margin gap to the sector's best-margin peer of comparable size (revenue ≥ a quarter of the company's), bridged
    by spine stage (§5.3–5.4) and tagged structural / closable by scale (§4.1)."""
    rev = _m(c, "revenue_ttm")
    if not rev:
        return None
    me = {"gross_margin": _m(c, "gross_margin"), "operating_margin": _m(c, "operating_margin"), "rd_pct": _m(c, "rd_pct") or 0.0}
    if me["gross_margin"] is None or me["operating_margin"] is None:
        return None
    peers = [p for p in members if _sym(p) != _sym(c) and (_m(p, "revenue_ttm") or 0) >= rev / 4 and _m(p, "operating_margin") is not None and _m(p, "gross_margin") is not None
             and -1 < _m(p, "operating_margin") < 1 and _m(p, "operating_margin") > me["operating_margin"]]
    if not peers:
        return {"note": "no larger-margin peer of comparable size in the sector", "best": None}
    best = max(peers, key=lambda p: _m(p, "operating_margin"))
    pd_ = {"gross_margin": _m(best, "gross_margin"), "operating_margin": _m(best, "operating_margin"), "rd_pct": _m(best, "rd_pct") or 0.0}
    br = fw.spine_gap_bridge(me, pd_, scale_ratio=(_m(best, "revenue_ttm") or 0) / rev, structural_ratio=structural_ratio)
    br["best"] = _sym(best)
    br["best_name"] = best.name if not isinstance(best, dict) else best.get("name")
    biggest = max((x for x in br["items"]), key=lambda x: x["gap_pp"]) if br["items"] else None
    br["sentence"] = (f"Against {br['best']}, the best-margin peer of comparable size ({br['peer_margin_pct']:.0f}% operating margin vs {br['client_margin_pct']:.0f}%), the gap sits mostly in "
                      f"{biggest['stage']} ({biggest['gap_pp']:+.0f} points)" + (f"; {br['best']} is {br['scale_ratio']:.1f}× the size, so the framework tags the gap structural (scale related)." if br["kind"] == "structural" else "; the two are of similar scale, so the framework treats the gap as closable.")) if biggest else ""
    return br


def diagnosis(c, sl: dict | None, members: list) -> list[dict]:
    g = _m(c, "rev_growth_ttm")
    sg = sl["sector_growth"] if sl else None
    row = next((r for r in (sl["rows"] if sl else []) if r["symbol"] == _sym(c)), None)
    ta = _m(c, "asset_turns")
    sector_ta = None
    turns = [_m(p, "asset_turns") for p in members if _m(p, "asset_turns")]
    if turns:
        turns.sort()
        sector_ta = turns[len(turns) // 2]
    return fw.performance_gap_diagnosis(g, sg, _m(c, "operating_margin"), row["predicted_ros"] if row else None, ta, sector_ta, row["share_index"] if row else None)


class Insight(BaseModel):
    observation: str
    evidence: str
    driver: str
    type: str          # structural | operational
    event_link: str    # the business event behind it, or "unexplained"
    implication: str   # the resource realignment: scope, efficiency, offence or defence, target
    confidence: str    # high | medium | low, with the reason
    caveats: str


class Battlefield(BaseModel):
    name: str
    competitors_met: list[str] = Field(default_factory=list)
    key_purchase_criteria: str
    position: str          # where the company stands on those criteria
    route_to_customer: str


class IndustryRead(BaseModel):
    """The §2 segmentation into battlefields and the §10.3 insights, read from the filings and the call."""
    battlefields: list[Battlefield] = Field(min_length=1, max_length=6)
    profit_sanctuaries: str      # where the company (and its main competitors, if visible) make their money; loss leaders
    structural_vs_operational: str   # the computed gaps classified, with reasons
    insights: list[Insight] = Field(min_length=3, max_length=6)
    numbers_used: list[Claim] = Field(default_factory=list)
    unverified_count: int = 0


def industry_read(c, docs: list[str], phases=None) -> dict:
    try:
        msgs = build_context(c, phases, want_transcript=True)
        msgs[0]["content"][0]["text"] += "\n\n" + "\n\n".join(docs)
        msgs[0]["content"].append({"type": "text", "text": (
            f"Using only the documents above, for {c.symbol} as of {c.as_of}: produce the IndustryRead of the Mars & Co framework. battlefields: the handful of "
            "strategic segments the company fights on (group product families that meet the same competitors, use the same technology and serve the same "
            "customers), with the competitors met, the key purchase criteria and the company's position on them, and the route to customer. profit_sanctuaries: "
            "where the profit is made (use ProfitPools), loss leaders, and what is visible of competitors' sanctuaries. structural_vs_operational: classify the "
            "gaps in PeerGap, ShareLine and Diagnosis as structural (outside management control: scale, location, technology, factor costs) or operational "
            "(closable), with reasons. insights: 3 to 6, each in the template — observation (one sentence with the number and period), evidence, driver, "
            "type, event_link (the business event behind it, or 'unexplained'), implication (a resource realignment: scope, efficiency, offence or defence, "
            "target), confidence with reason, caveats (disclosure limits). Plain English, no rule ids, no parenthetical citations in prose; every number "
            "from the documents, listed in numbers_used with period and source. Diagnostic only: no trade instruction.")})
        r = parse_structured(SYSTEM, msgs, IndustryRead, cache_key=f"industry:{c.symbol}:{c.as_of}", max_tokens=9000)
        from .pitch import _check_prose

        from types import SimpleNamespace

        probe = SimpleNamespace(numbers_used=r.numbers_used, texts=[r.profit_sanctuaries, r.structural_vs_operational] + [i.observation + " " + i.evidence + " " + i.implication for i in r.insights]
                                + [b.position + " " + b.key_purchase_criteria for b in r.battlefields], unverified_count=0)
        _check_prose(probe, ["texts"], msgs, financial_read(c))
        d = r.model_dump(mode="json")
        d["unverified_count"] = probe.unverified_count
        d["source"] = "claude"
        return d
    except NarrativeUnavailable as e:
        return {"source": "engine", "note": str(e)}
    except Exception as e:  # noqa: BLE001
        return {"source": "engine", "note": f"industry read failed: {str(e)[:140]}"}


def build_industry_analysis(c, members: list, *, rev: pd.DataFrame | None = None, ebit: pd.DataFrame | None = None, share_line: dict | None = None,
                            use_llm: bool = True, phases=None, cfg: dict | None = None, structural_ratio: float = 2.0) -> dict:
    """The whole read for one name. `members` = the scored candidates of its theme sector (dicts or objects); `rev`/`ebit` = the
    segment frames from the product lens when available; `share_line` = the sector's line if already computed."""
    sl = share_line if share_line is not None else sector_share_line(members, cfg)
    pools = segment_profit_pools(rev, ebit)
    gap = peer_gap(c, members, structural_ratio)
    diag = diagnosis(c, sl, members)
    sentences = []
    if pools:
        sentences.append(pools["sentence"])
    sentences += share_line_sentences(sl, _sym(c))
    if gap and gap.get("sentence"):
        sentences.append(gap["sentence"])
    for d in diag:
        sentences.append(f"{d['gap'].capitalize()}: {d['type']} — {d['driver']}; the framework's answer is to {d['solution']}.")
    docs = [_doc(f"ShareLine {c.symbol}", str(c.as_of), "engine (sector members, TTM)", json.dumps({k: v for k, v in (sl or {}).items() if k != "rows"} | {"company": next((r for r in (sl or {}).get("rows", []) if r["symbol"] == c.symbol), None)}, default=str), 2500)]
    if pools:
        docs.append(_doc(f"ProfitPools {c.symbol}", str(c.as_of), "engine (10-K segment note)", json.dumps(pools, default=str), 3000))
    if gap:
        docs.append(_doc(f"PeerGap {c.symbol}", str(c.as_of), "engine (sector members, TTM)", json.dumps(gap, default=str), 2500))
    docs.append(_doc(f"Diagnosis {c.symbol}", str(c.as_of), "engine (framework §5.5)", json.dumps(diag, default=str), 2000))
    read = industry_read(c, docs, phases) if use_llm else {"source": "engine", "note": "narrative layer off"}
    return {"share_line": sl, "pools": pools, "gap": gap, "diagnosis": diag, "sentences": sentences, "read": read, "docs": docs,
            "company_row": next((r for r in (sl or {}).get("rows", []) if r["symbol"] == c.symbol), None)}


def nan_free(x):
    if isinstance(x, float) and (math.isnan(x) or math.isinf(x)):
        return None
    return x
