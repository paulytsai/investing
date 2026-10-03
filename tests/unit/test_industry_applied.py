"""The framework applied to engine data: the sector share line, segment profit pools, the peer gap bridge, the trend sentence."""
import math
import random

import pandas as pd

from engine.research.industry import peer_gap, sector_share_line, segment_profit_pools, share_line_sentences
from engine.research.story import trend_sentence


def _members():
    rng = random.Random(1)
    out = []
    for i, rev in enumerate([40e9, 20e9, 10e9, 5e9, 2e9, 1e9, 0.5e9]):
        out.append({"symbol": f"P{i}", "name": f"Peer {i}", "metrics": {"revenue_ttm": rev, "operating_margin": 0.05 + 0.04 * math.log(rev / 1e9) + rng.uniform(-0.02, 0.02),
                                                                         "rev_growth_ttm": rng.uniform(-0.05, 0.15), "gross_margin": 0.45, "rd_pct": 0.0}})
    return out


def test_sector_share_line_and_environments():
    sl = sector_share_line(_members())
    assert sl["n"] == 7 and sl["leader"] == "P0" and 0.02 < sl["ros_gain_per_doubling"] < 0.035     # 4% per ln-unit ≈ 2.8 pts per doubling
    rows = {r["symbol"]: r for r in sl["rows"]}
    assert rows["P0"]["share_index"] == 2.0 and rows["P0"]["environment"] == "DOMINANT"            # leader vs the second player
    assert rows["P3"]["environment"] == "SUB_SCALE" and rows["P1"]["environment"] == "CRITICAL_MASS"
    assert abs(sum(r["residual"] for r in sl["rows"])) < 1e-9
    s = share_line_sentences(sl, "P2")
    assert "P2 runs at 0.25×" in s[-1] and "sub-scale" in s[-1]
    assert sector_share_line(_members()[:3]) is None
    from engine.reports.charts import build_share_line_chart, to_json

    spec = build_share_line_chart("t", "Test", sl, highlight="P2")
    assert not spec["empty"] and len(spec["traces"]) == 2 and to_json(spec)


def test_segment_profit_pools_and_imperatives():
    rev = pd.DataFrame({"A": [10, 11], "B": [5, 4.5], "C": [2, 1.5], "total": [17, 17]}, index=[2025, 2026])
    ebit = pd.DataFrame({"A": [2, 2.6], "B": [1, 0.9], "C": [0.1, -0.1]}, index=[2025, 2026])
    pp = segment_profit_pools(rev, ebit)
    imp = {r["segment"]: r["imperative"] for r in pp["rows"]}
    assert imp == {"A": "drive profitable growth", "B": "stop the decline", "C": "find a radical solution or exit"}
    assert pp["whale"]["unprofitable_loss"] == -0.1 and pp["rows"][0]["segment"] == "A"
    assert segment_profit_pools(None, None) is None


def test_peer_gap_bridge_tags_scale():
    m = _members()
    g = peer_gap(m[3], m)
    assert g["best"] == "P0" and g["kind"] == "structural" and g["scale_ratio"] == 8.0
    assert abs(g["bridge"]["end"] - g["peer_margin_pct"]) < 1e-9
    assert abs(sum(g["derivative_spine"].values()) - 1.0) < 1e-9
    g2 = peer_gap(m[1], m)
    assert g2["kind"] == "structural" or g2["scale_ratio"] < 2.0


def test_trend_sentence_splits_at_an_inflection():
    fy = pd.DataFrame({"revenue": [100 * 1.2 ** t for t in range(6)] + [100 * 1.2 ** 5 * 1.12 ** t for t in range(1, 5)]}, index=pd.to_datetime([f"{2016 + t}-05-31" for t in range(10)]))
    s = trend_sentence(fy)
    assert "20% a year from FY2018 to FY2021, then 12% a year to FY2025" in s
    assert "on a fitted trend" in trend_sentence(fy.tail(5))
    assert trend_sentence(fy.assign(revenue=[-1] * 10)) is None
