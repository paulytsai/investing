"""The product-company lens, assembled for one name (live layer, like the thesis record): regions and channels from the
10-K XBRL (`segments.py`), the sales-quality read from the PIT fundamentals, the price-realization language of the last
two calls, and a Claude read of the value chain (pressure from suppliers, channel partners and consumers; entrants and
counterfeit; baseline vs reach). Framework math lives in `frameworks/product_lens.py`; this module only fetches and
arranges. Applies to companies that sell a product — never banks, REITs, funds."""
from __future__ import annotations

import json
import re
import pandas as pd
from pydantic import BaseModel, Field

from ..frameworks import product_lens as fw
from .context import SYSTEM, _doc, build_context
from .llm import NarrativeUnavailable, parse_structured
from .schemas import Claim
from .segments import PARENT_MEMBERS, segment_history, segment_members

REVENUE_CONCEPTS = ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax"]
EBIT_CONCEPTS = ["EarningsBeforeInterestAndTaxes", "OperatingIncomeLoss", "SegmentReportingSegmentOperatingIncomeLoss",
                 "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest"]
SEGMENT_AXES = ("SubsegmentsAxis", "StatementBusinessSegmentsAxis", "StatementGeographicalAxis", "SegmentReportingInformationBySegmentAxis")
RECONCILING = re.compile(r"corporate|unallocated|allother|reconcil|elimination|intersegment|globalbrand|other(?:segments?)?member$", re.I)
CHANNEL_MEMBERS = ["SalesChannelDirectlyToConsumer", "SalesChannelThroughIntermediary", "SalesChannelWholesale", "SalesChannelOther"]
PRODUCT_SECTORS = {"consumer cyclical", "consumer defensive", "industrials", "technology", "basic materials", "healthcare", "energy", "communication services"}
NOT_PRODUCT_INDUSTRY = re.compile(r"bank|insurance|reit|asset management|capital markets|software|internet|media|telecom|utilities|financial|biotech|services$", re.I)


def sells_product(c) -> bool:
    """A company that makes and sells a thing — the lens applies. Banks, insurers, REITs, software, media and services do not."""
    at = getattr(c, "asset_type", None) or (c.get("asset_type") if isinstance(c, dict) else None)
    sector = (getattr(c, "sector", None) or (c.get("sector") if isinstance(c, dict) else None) or "").lower()
    industry = getattr(c, "industry", None) or (c.get("industry") if isinstance(c, dict) else None) or ""
    if at in ("bank", "real_estate", "fund_etf"):
        return False
    if NOT_PRODUCT_INDUSTRY.search(industry):
        return False
    return sector in PRODUCT_SECTORS


def _clean(member: str) -> str:
    m = re.sub(r"(Segment)?Member$", "", member)
    return re.sub(r"(?<=[a-z])(?=[A-Z])", " ", m).replace("And", "&").strip()


def discover_regions(symbol: str, years: int = 12) -> tuple[list[str], set[str], dict[str, str]]:
    """(member keywords of the current operating segments, parent members, keyword → label) from the latest 10-K's
    vocabulary: subsegments when the filer uses them (a brand split into regions), else the segment axis; a segment-axis
    member that co-occurs with a subsegment is a parent, not a segment. Reconciling items and bare country codes are dropped."""
    mem = segment_members(symbol, years=years)
    if mem.empty:
        return [], set(), {}
    latest_fy = mem["fiscal_year_end"].max()
    cur = mem[mem.fiscal_year_end == latest_fy]
    subs = sorted(set(cur[cur.axis == "SubsegmentsAxis"]["member"]))
    segs = sorted(set(cur[cur.axis.isin(["StatementBusinessSegmentsAxis", "SegmentReportingInformationBySegmentAxis"])]["member"]))
    parents: set[str] = set()
    if subs:
        # a parent brand carries the subsegments; a segment-axis member that is itself a region/segment stays
        parents = {s for s in segs if s not in subs and "brand" in s.lower()}
        regions = subs + [s for s in segs if s not in parents]
    else:
        regions = segs
    if not regions:
        geo = sorted(set(cur[cur.axis == "StatementGeographicalAxis"]["member"]))
        regions = [g for g in geo if len(g) > 2]
    regions = [r for r in regions if not RECONCILING.search(r) and len(r) > 2]
    keys = [re.sub(r"(Segment)?Member$", "", r) for r in regions]
    return keys, {re.sub(r"(Segment)?Member$", "", p) for p in parents}, {k: _clean(k) for k in keys}


def region_frames(symbol: str, years: int = 12) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, str], pd.DataFrame | None]:
    """(revenue fy×region, ebit fy×region, labels, channel revenue fy×channel|None) in reported currency units."""
    keys, parents, labels = discover_regions(symbol, years)
    if not keys:
        return pd.DataFrame(), pd.DataFrame(), {}, None
    df = segment_history(symbol, keys + CHANNEL_MEMBERS, {"revenue": REVENUE_CONCEPTS, "ebit": EBIT_CONCEPTS}, years=years, parents=parents | PARENT_MEMBERS)
    if df.empty:
        return pd.DataFrame(), pd.DataFrame(), labels, None
    df["fy"] = pd.to_datetime(df.fiscal_year_end).dt.year
    def pv(line, segs):
        sub = df[(df.line == line) & (df.segment.isin(segs + ["total"]))]
        p = sub.pivot_table(index="fy", columns="segment", values="value") if not sub.empty else pd.DataFrame()
        return p.rename(columns={k: labels.get(k, k) for k in keys})
    rev, ebit = pv("revenue", keys), pv("ebit", keys)
    chan = pv("revenue", CHANNEL_MEMBERS)
    chan = chan[[c for c in chan.columns if c in CHANNEL_MEMBERS or c == "total"]] if not chan.empty else None
    if chan is not None and not chan.empty:
        chan = chan.rename(columns={"SalesChannelDirectlyToConsumer": "Direct", "SalesChannelThroughIntermediary": "Wholesale", "SalesChannelWholesale": "Wholesale", "SalesChannelOther": "Other channels"})
        chan = chan if {"Direct", "Wholesale"} <= set(chan.columns) else None
    return rev, ebit, labels, chan


def price_language(symbol: str, n_calls: int = 2) -> dict:
    """Full-price vs promotional language in the latest calls (BCG: the fictitious price gap, forward buying), live from
    the cached transcripts; counts per 10k words and the quotes."""
    from ..connectors.fmp import FMP
    from ..text.lexical import counts, extract

    out = {"full_price": 0.0, "promo_push": 0.0, "net": None, "quotes": [], "calls": []}
    try:
        fmp = FMP()
        dates = sorted(fmp.transcript_dates(symbol), key=lambda d: d.get("date", ""), reverse=True)[:n_calls]
    except Exception:  # noqa: BLE001
        return out
    tot_w = 0
    for d0 in dates:
        try:
            tr = fmp.transcript(symbol, int(d0["fiscalYear"]), int(d0["quarter"]))
        except Exception:  # noqa: BLE001
            continue
        if not tr or not tr.get("content"):
            continue
        text = tr["content"]
        hits = extract(text)
        c = counts(hits)
        w = len(text.split())
        tot_w += w
        out["full_price"] += c.get("full_price", 0) + c.get("pricing_up", 0)
        out["promo_push"] += c.get("promo_push", 0) + c.get("pricing_down", 0)
        out["calls"].append(f"Q{d0['quarter']} FY{d0['fiscalYear']} ({tr.get('date')})")
        for h in hits:
            if h.category in ("full_price", "promo_push", "pricing_up", "pricing_down") and len(out["quotes"]) < 6:
                out["quotes"].append({"category": h.category, "quote": h.quote[:260], "call": f"Q{d0['quarter']} FY{d0['fiscalYear']}"})
    if tot_w:
        k = 10_000 / tot_w
        out["net"] = (out["full_price"] - out["promo_push"]) * k
    return out


class ValueChainRead(BaseModel):
    """Mars & Co's map of pressure up and down the value chain, read from the filings and the call."""
    upstream: str                 # suppliers, inputs, tariffs, factories — who has the power
    channel: str                  # retailers / wholesalers / dealers — concentration, their health, push vs pull, direct share
    consumer: str                 # price realization, promotions, brand heat, substitutes
    entrants_and_counterfeit: str
    baseline_drivers: str         # what carries growth on current trends and commitments (installed base, cadence, price)
    reach_opportunities: str      # growth that needs investment: new channels, segments, regions — and at what margin
    defence_offence: str          # what the company must defend, where it is attacking
    verdict: str                  # one paragraph: is the value chain working for or against this company now
    pressure_score: int = Field(ge=0, le=100, description="0 = the chain works for the company, 100 = squeezed from every side")
    numbers_used: list[Claim] = Field(default_factory=list)
    unverified_count: int = 0


def value_chain_read(c, docs: list[str], phases=None) -> dict | None:
    try:
        msgs = build_context(c, phases, want_transcript=True)
        msgs[0]["content"][0]["text"] += "\n\n" + "\n\n".join(docs)
        msgs[0]["content"].append({"type": "text", "text": (
            f"Using only the documents above, for {c.symbol} as of {c.as_of}: produce the ValueChainRead — the Mars & Co map of pressure up and down "
            "the value chain (suppliers, channel partners, consumers; entrants and counterfeit), what carries the baseline growth on current trends, "
            "what 'reach' growth would need investment and at what margin, what must be defended and where the company is attacking, and a verdict. "
            "Write as a presenter: plain English, full sentences, no rule ids, no parenthetical citations inside the prose, at most 90 words per field. "
            "Every number must come from the documents and be listed in numbers_used with its period and source (a <doc id> or FinancialRead.<key>). "
            "Be specific about regions and channels.")})
        r = parse_structured(SYSTEM, msgs, ValueChainRead, cache_key=f"valuechain:{c.symbol}:{c.as_of}", max_tokens=8000)
        from .context import financial_read
        from .pitch import _check_prose

        _check_prose(r, ["upstream", "channel", "consumer", "entrants_and_counterfeit", "baseline_drivers", "reach_opportunities", "defence_offence", "verdict"], msgs, financial_read(c))
        d = r.model_dump(mode="json")
        d["source"] = "claude"
        return d
    except NarrativeUnavailable as e:
        return {"source": "engine", "note": str(e)}
    except Exception as e:  # noqa: BLE001
        return {"source": "engine", "note": f"value-chain read failed: {str(e)[:120]}"}


def build_segment_chart(chart_id: str, symbol: str, rev: pd.DataFrame, ebit: pd.DataFrame, currency: str = "USD") -> dict:
    """Two panels: revenue by region stacked (bars) and EBIT margin by region (lines), from the segment history."""
    if rev is None or rev.empty:
        return {"id": chart_id, "empty": True, "title": "", "subtitle": "", "panels": [], "traces": [], "shapes": [], "annotations": [], "compact": False, "height": 300, "x_range": None, "meta": {}}
    segs = [c for c in rev.columns if c != "total"]
    slots = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"]
    unit = 1e9 if float(rev[segs].max().max()) >= 1e9 else 1e6
    ulab = "bn" if unit == 1e9 else "m"
    xs = [f"FY{int(i)}" for i in rev.index]
    traces = []
    for i, s in enumerate(segs):
        traces.append({"panel": "rev", "overlay": "segments", "type": "bar", "name": s, "x": xs, "y": [round(float(v) / unit, 3) if pd.notna(v) else None for v in rev[s]],
                       "marker": {"color": f"var(--{slots[i % 8]})"}, "hovertemplate": "%{x}<br>%{y:.2f}" + ulab + "<extra>" + s + "</extra>"})
    if ebit is not None and not ebit.empty:
        for i, s in enumerate(segs):
            if s in ebit.columns:
                m = (ebit[s] / rev[s] * 100)
                traces.append({"panel": "margin", "overlay": "margin", "type": "scatter", "mode": "lines+markers", "name": s + " margin", "x": xs,
                               "y": [round(float(v), 1) if pd.notna(v) else None for v in m], "line": {"width": 2, "color": f"var(--{slots[i % 8]})"}, "marker": {"size": 5},
                               "showlegend": False, "hovertemplate": "%{x}<br>%{y:.1f}%<extra>" + s + " EBIT margin</extra>"})
    return {"id": chart_id, "empty": not traces, "title": f"{symbol} by region", "subtitle": f"revenue by segment ({currency} {ulab}, stacked) and segment EBIT margin (%)",
            "panels": [{"id": "rev", "height": 0.6, "title": f"revenue, {ulab}", "log": False}, {"id": "margin", "height": 0.4, "title": "EBIT margin %", "log": False}],
            "traces": traces, "shapes": [], "annotations": [], "compact": False, "height": 420, "x_range": None, "barmode": "stack",
            "meta": {"sources": ["edgar xbrl"], "note": "latest filing wins for each fiscal year"}}


def build_product_lens(c, fy: pd.DataFrame | None, implied_growth: dict | None, *, use_llm: bool = True, phases=None, years: int = 12) -> dict | None:
    """The whole lens for one name, or None when the company does not sell a product."""
    if not sells_product(c):
        return None
    try:
        rev, ebit, labels, chan = region_frames(c.symbol, years)
    except Exception as e:  # noqa: BLE001
        print(f"[product lens] {c.symbol}: segments unavailable ({e})")
        rev, ebit, labels, chan = pd.DataFrame(), pd.DataFrame(), {}, None
    bridge = fw.region_bridge(rev, ebit) if not rev.empty else {"rows": [], "baseline_growth_pct": None, "last_year_growth_pct": None, "concentration_pct": None, "largest": None, "bridge": []}
    mix = fw.channel_mix(chan) if chan is not None else None
    quality = fw.sales_quality(fy)
    lang = price_language(c.symbol)
    reach = fw.baseline_vs_required(bridge.get("baseline_growth_pct"), (implied_growth or {}).get("implied_pct"))
    score = fw.lens_score(bridge, quality, mix, reach)
    cur = getattr(c, "currency", "USD") or "USD"
    sentences = fw.region_sentences(bridge, cur)
    if mix:
        sentences.append(f"Direct-to-consumer is {mix['direct_share_pct']:.0f}% of revenue, {mix['direct_share_change_pp']:+.0f} points over {mix['years']} years — "
                         + ("the shift from push to pull is under way." if mix["direct_share_change_pp"] > 2 else ("the channel mix is going back toward wholesale." if mix["direct_share_change_pp"] < -2 else "the channel mix is stable.")))
    if lang.get("net") is not None:
        sentences.append(("Management's language on price is " + ("full-price and clean-inventory" if lang["net"] > 0 else ("promotional and inventory-heavy" if lang["net"] < 0 else "neutral"))
                          + f" ({lang['full_price']:.0f} full-price against {lang['promo_push']:.0f} promotional mentions in the last {len(lang['calls'])} calls)."))
    docs = [_doc(f"Regions {c.symbol}", str(c.as_of), "engine (10-K XBRL segment note)", json.dumps({"bridge": bridge, "sentences": sentences}, default=str), 6000),
            _doc(f"SalesQuality {c.symbol}", str(c.as_of), "engine (point-in-time fundamentals)", json.dumps(quality, default=str), 2000),
            _doc(f"PriceLanguage {c.symbol}", str(c.as_of), "engine (transcripts, lexical)", json.dumps(lang, default=str), 3000),
            _doc(f"BaselineVsRequired {c.symbol}", str(c.as_of), "engine (F-16 vs regions)", json.dumps(reach, default=str), 1000)]
    if mix:
        docs.append(_doc(f"ChannelMix {c.symbol}", str(c.as_of), "engine (10-K XBRL)", json.dumps(mix, default=str), 1500))
    chain = value_chain_read(c, docs, phases) if use_llm else {"source": "engine", "note": "narrative layer off"}
    chart = build_segment_chart(f"seg-{c.symbol.replace('.', '_')}", c.symbol, rev, ebit, cur)
    return {"applies": True, "bridge": bridge, "mix": mix, "quality": quality, "language": lang, "reach": reach, "score": score, "sentences": sentences,
            "value_chain": chain, "chart": chart, "docs": docs, "labels": labels,
            "history": {"revenue": {str(k): {kk: (None if pd.isna(vv) else float(vv)) for kk, vv in v.items()} for k, v in rev.iterrows()} if not rev.empty else {},
                        "ebit": {str(k): {kk: (None if pd.isna(vv) else float(vv)) for kk, vv in v.items()} for k, v in ebit.iterrows()} if not ebit.empty else {}}}

