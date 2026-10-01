"""The product-company lens (Mars & Co growth bridge, BCG sales quality) and the XBRL segment parser — pure, no network."""
import pandas as pd

from engine.frameworks import product_lens as fw
from engine.research.segments import classify_context, instance_doc, parse_contexts, parse_facts

XML = """<xbrl><context id="FY"><entity><identifier scheme="x">1</identifier></entity><period><startDate>2025-06-01</startDate><endDate>2026-05-31</endDate></period></context>
<context id="FY_GC"><entity><identifier scheme="x">1</identifier><segment>
<xbrldi:explicitMember dimension="srt:ConsolidationItemsAxis">us-gaap:OperatingSegmentsMember</xbrldi:explicitMember>
<xbrldi:explicitMember dimension="us-gaap:StatementBusinessSegmentsAxis">nke:NIKEBrandMember</xbrldi:explicitMember>
<xbrldi:explicitMember dimension="us-gaap:SubsegmentsAxis">nke:GreaterChinaSegmentMember</xbrldi:explicitMember></segment></entity>
<period><startDate>2025-06-01</startDate><endDate>2026-05-31</endDate></period></context>
<context id="FY_GC_FW"><entity><identifier scheme="x">1</identifier><segment>
<xbrldi:explicitMember dimension="srt:ProductOrServiceAxis">nke:FootwearMember</xbrldi:explicitMember>
<xbrldi:explicitMember dimension="us-gaap:SubsegmentsAxis">nke:GreaterChinaSegmentMember</xbrldi:explicitMember></segment></entity>
<period><startDate>2025-06-01</startDate><endDate>2026-05-31</endDate></period></context>
<us-gaap:Revenues contextRef="FY" unitRef="usd" decimals="-6">46398000000</us-gaap:Revenues>
<us-gaap:Revenues contextRef="FY_GC" unitRef="usd" decimals="-6">5847000000</us-gaap:Revenues>
<us-gaap:Revenues contextRef="FY_GC_FW" unitRef="usd" decimals="-6">4000000000</us-gaap:Revenues>
<nke:EarningsBeforeInterestAndTaxes contextRef="FY_GC" unitRef="usd" decimals="-6">1278000000</nke:EarningsBeforeInterestAndTaxes></xbrl>"""

IX = """<html><ix:nonFraction name="us-gaap:Revenues" contextRef="FY" unitRef="usd" scale="6" decimals="-6">46,398</ix:nonFraction>
<ix:nonFraction name="us-gaap:Revenues" contextRef="FY_GC" unitRef="usd" scale="6" sign="-" decimals="-6">5,847</ix:nonFraction></html>"""


def test_parse_contexts_and_facts_plain_and_inline():
    ctx = parse_contexts(XML)
    assert ctx["FY"]["members"] == {} and ctx["FY_GC"]["members"]["SubsegmentsAxis"] == "GreaterChinaSegmentMember"
    facts = parse_facts(XML, {"Revenues", "EarningsBeforeInterestAndTaxes"})
    assert {(f["concept"], f["context"], f["value"]) for f in facts} == {("Revenues", "FY", 46398000000.0), ("Revenues", "FY_GC", 5847000000.0),
                                                                          ("Revenues", "FY_GC_FW", 4000000000.0), ("EarningsBeforeInterestAndTaxes", "FY_GC", 1278000000.0)}
    ix = parse_facts(IX, {"Revenues"})
    assert ix[0]["value"] == 46398e6 and ix[1]["value"] == -5847e6       # scale and sign attributes applied


def test_classify_context_segment_vs_slice():
    assert classify_context({}, "GreaterChina") == "total"
    assert classify_context({"ConsolidationItemsAxis": "OperatingSegmentsMember", "StatementBusinessSegmentsAxis": "NIKEBrandMember", "SubsegmentsAxis": "GreaterChinaSegmentMember"}, "GreaterChina", {"NIKEBrand"}) == "segment"
    assert classify_context({"ProductOrServiceAxis": "FootwearMember", "SubsegmentsAxis": "GreaterChinaSegmentMember"}, "GreaterChina", {"NIKEBrand"}) is None   # a product slice, not the segment
    assert classify_context({"StatementGeographicalAxis": "GreaterChinaMember", "StatementBusinessSegmentsAxis": "NIKEBrandMember"}, "GreaterChina", {"NIKEBrand"}) == "segment"   # 2012 style
    assert classify_context({"ConsolidationItemsAxis": "MaterialReconcilingItemsMember", "SubsegmentsAxis": "GreaterChinaSegmentMember"}, "GreaterChina") is None
    assert instance_doc(["a.htm", "nke-20260531_htm.xml", "nke-20260531.xsd"], "a.htm") == "nke-20260531_htm.xml"
    assert instance_doc(["nke-20180531.xml", "nke-20180531_cal.xml"], "nke.htm") == "nke-20180531.xml"


def _frames():
    idx = [2023, 2024, 2025, 2026]
    rev = pd.DataFrame({"North America": [21.6, 21.4, 19.6, 20.5], "Greater China": [7.25, 7.54, 6.59, 5.85], "Converse": [2.43, 2.08, 1.69, 1.17], "total": [51.2, 51.4, 46.3, 46.4]}, index=idx) * 1e9
    ebit = pd.DataFrame({"North America": [5.45, 5.82, 4.74, 5.38], "Greater China": [2.28, 2.31, 1.60, 1.28], "Converse": [0.68, 0.47, 0.24, 0.02]}, index=idx) * 1e9
    return rev, ebit


def test_region_bridge_labels_and_baseline():
    rev, ebit = _frames()
    b = fw.region_bridge(rev, ebit, years=3)
    rows = {r["segment"]: r for r in b["rows"]}
    assert b["largest"] == "North America" and 40 < rows["North America"]["share_pct"] < 46
    assert rows["Greater China"]["label"] == "shrinking" and rows["Converse"]["label"] == "shrinking"
    assert rows["North America"]["label"] == "stalled"
    assert rows["Greater China"]["margin_change_pp"] < -5
    assert b["baseline_growth_pct"] < 0 and abs(b["last_year_growth_pct"]) < 1
    assert abs(sum(r["contribution_pp"] for r in b["rows"]) - (sum(rev.iloc[-1][:-1]) - sum(rev.iloc[-2][:-1])) / rev["total"].iloc[-2] * 100) < 1e-6
    sents = fw.region_sentences(b)
    assert sents[0].startswith("North America is the largest region") and any("Holding the company back" in s for s in sents)


def test_sales_quality_flags_pushed_sales():
    fy = pd.DataFrame({"revenue": [100, 102, 104, 105], "cost_of_revenue": [55, 56, 58, 60], "inventory": [20, 21, 21, 21], "receivables": [10, 10, 10, 13]},
                      index=pd.to_datetime(["2023-05-31", "2024-05-31", "2025-05-31", "2026-05-31"]))
    q = fw.sales_quality(fy)
    assert q["receivables_vs_revenue_pp"] > 25 and any("receivables grew" in f for f in q["flags"])
    assert q["gross_margin_change_pp"] < -2 and "pushed" in q["verdict"]
    clean = fw.sales_quality(fy.assign(receivables=[10, 10.2, 10.4, 10.5], cost_of_revenue=[55, 55, 55, 55]))
    assert "earned" in clean["verdict"]
    assert fw.sales_quality(None)["verdict"].startswith("Not enough")


def test_channel_mix_and_reach():
    ch = pd.DataFrame({"Direct": [43.7, 43.6, 42.0, 39.2], "Wholesale": [56.3, 56.4, 58.0, 60.8]}, index=[2023, 2024, 2025, 2026])
    m = fw.channel_mix(ch, years=3)
    assert abs(m["direct_share_pct"] - 39.2) < 0.01 and m["direct_share_change_pp"] < 0
    r = fw.baseline_vs_required(-3.0, 10.0)
    assert r["reach_gap_pp"] == 13.0 and "reach" in r["verdict"]
    assert "already cover" in fw.baseline_vs_required(12.0, 10.0)["verdict"]
    assert fw.baseline_vs_required(None, 10.0)["verdict"] is None
