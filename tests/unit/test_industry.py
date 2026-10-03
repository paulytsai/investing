"""The 13 test cases of docs/frameworks/INDUSTRY_COMPANY_ANALYSIS.md §11.5, plus the engine's adaptations."""
import math
import random

from engine.frameworks import industry as fw


def test_slope_examples():
    assert abs(fw.cost_curve(80, 10, 20, 0.75) - 60) < 1e-9                          # SRC p.70
    assert abs(fw.cost_curve(100, 1, 4, 0.95) - 90.25) < 1e-9                        # SRC p.66
    assert abs(fw.cost_curve(2500, 50_000, 35_000, 0.60) - 3252) < 1                 # SRC p.74
    assert abs(fw.cost_curve(2500, 50_000, 75_000, 0.60) - 1854) < 1


def test_multi_activity_position_and_derivative_spine():
    acts = {"purchased": {"client_cost": 500, "client_driver": 100, "slope": 0.90}, "transformation": {"client_cost": 250, "client_driver": 50, "slope": 0.60},
            "overhead": {"client_cost": 250, "client_driver": 100, "slope": 0.80}, "freight": {"client_cost": 40}}
    r = fw.competitor_cost_position(acts, {"purchased": 200, "transformation": 75, "overhead": 200})
    g = r["gap_by_activity"]
    assert abs(g["purchased"] - 50.0) < 0.05 and abs(g["transformation"] - 64.6) < 0.1 and abs(g["overhead"] - 50.0) < 0.05 and g["freight"] == 0
    assert abs(r["total_gap"] - 164.6) < 0.1 and r["flags"] == ["freight: assumed parity (no driver or slope)"]
    ds = fw.derivative_spine({"materials": 100, "transformation": 100, "overhead": 100})
    assert all(abs(v - 1 / 3) < 1e-9 for v in ds.values())                           # SRC p.77


def test_gap_bridge_p88():
    items = [("export support", -11.0, "non_economic"), ("cost allocation", -1.5, "non_economic"), ("royalties", 0.6, "non_economic"), ("scale", 20.3, "structural"),
             ("packaging", 4.0, "closable"), ("utilisation", 6.0, "closable"), ("operating performance", 8.9, "closable"), ("sourcing", 4.6, "closable"),
             ("recipes", 0.2, "closable"), ("organisation", -10.0, "closable"), ("other and mix", 5.6, "closable")]
    b = fw.gap_bridge(-13.9, items)
    assert abs(b["economic_start"] + 25.8) < 1e-9 and abs(b["economic_gap"] - 39.6) < 1e-9
    assert abs(b["structural_share"] - 0.5126) < 1e-3 and abs(b["end"] - 13.8) < 1e-9


def test_whale_curve():
    w = fw.whale_curve([("A", 200, 25), ("B", 198, 5), ("C", 100, -2), ("D", 51, -8)])
    assert w["peak_cumulative_profit"] == 30 and w["total_profit"] == 20
    assert abs(w["unprofitable_revenue_share"] - 0.275) < 1e-3 and w["unprofitable_loss"] == -10


def test_price_band():
    r = fw.cost_histogram_price_band([("A", 40, 60), ("B", 30, 70), ("C", 15, 82), ("D", 10, 95), ("E", 12, 110)], 90)
    assert r["last_entrant"][0] == "D" and r["first_loser"][0] == "E" and r["price_floor"] == 95 and r["price_ceiling"] == 110 and abs(r["spare_capacity"] - 5) < 1e-9


def test_share_line():
    ratios = [0.1, 0.2, 0.5, 1, 2, 5]
    ros = [0.12 + 0.05 * math.log(r) for r in ratios]
    s = fw.share_profit_line(ratios, ros)
    assert abs(s["a_ros_at_parity"] - 0.12) < 1e-9 and abs(s["b_per_log_ratio"] - 0.05) < 1e-9 and abs(s["ros_gain_per_doubling"] - 0.03466) < 1e-4


def test_market_environment():
    cases = [((0.3, 0.05), "SUB_SCALE"), ((1.0, 0.04), "CRITICAL_MASS"), ((3.0, 0.03), "DOMINANT"), ((1.0, 0.20), "HIGH_GROWTH_OPEN"), ((0.2, 0.20), "HIGH_GROWTH_SUBSCALE_UNCLASSIFIED")]
    for (si, g), want in cases:
        assert fw.market_environment(si, g) == want


def test_price_zones_p129():
    prices = [1.49, 1.99, 2.49, 2.99, 3.49, 3.99]
    vols = [1.39, 1.30, 1.06, 1.06, 1.00, 0.81]
    z = [r["zone"] for r in fw.price_response_zones(prices, vols)]
    assert z == ["VOLUME_INELASTIC", "REVENUE_PLATEAU", "VOLUME_INELASTIC", "MODERATE", "ELASTIC"]


def test_demand_levers():
    rng = random.Random(7)
    inv = [rng.uniform(0, 10) for _ in range(200)]
    price = [rng.uniform(0, 10) for _ in range(200)]
    media = [rng.uniform(0, 10) for _ in range(200)]
    demand = [2 + 1.3 * i - 0.6 * p + 0.2 * m + rng.gauss(0, 0.3) for i, p, m in zip(inv, price, media)]
    r = fw.demand_lever_ranking({"inventory": inv, "price": price, "media": media}, demand)
    assert [x["lever"] for x in r] == ["inventory", "price", "media"]
    raw = {x["lever"]: x["raw_coef"] for x in r}
    assert abs(raw["inventory"] - 1.3) < 0.1 and abs(raw["price"] + 0.6) < 0.1 and abs(raw["media"] - 0.2) < 0.1


def test_volume_gap():
    r = fw.volume_gap([("X", 100, 0.56), ("Y", 52, 0.11), ("Z", 78, 0.10)], 0.43)
    assert [n for n, _ in r] == ["Z", "Y", "X"] and abs(r[0][1] - 25.74) < 0.01 and abs(r[1][1] - 16.64) < 0.01 and r[2][1] == 0


def test_trend_split():
    vals = [100 * 1.2 ** t for t in range(10)]
    vals += [vals[-1] * 1.12 ** t for t in range(1, 10)]
    blended = fw.log_trend_cagr(vals)
    assert 0.155 < blended < 0.165
    s = fw.split_trend(vals)
    assert s["break_index"] == 9 and abs(s["cagr_before"] - 0.20) < 1e-6 and abs(s["cagr_after"] - 0.12) < 1e-6
    assert fw.log_trend_cagr([1, 0]) is None


def test_engine_adaptations():
    assert fw.brand_map_imperative(-0.05, 0.1) == "find a radical solution or exit"
    assert fw.brand_map_imperative(0.01, 0.1) == "maintain or make profitable"
    assert fw.brand_map_imperative(0.22, -0.11, avg_growth=0.0) == "stop the decline"
    assert fw.brand_map_imperative(0.26, 0.05) == "drive profitable growth"
    b = fw.spine_gap_bridge({"gross_margin": 0.43, "operating_margin": 0.08, "rd_pct": 0.0}, {"gross_margin": 0.50, "operating_margin": 0.20, "rd_pct": 0.0}, scale_ratio=1.2)
    assert abs(b["bridge"]["end"] - 20.0) < 1e-9 and b["kind"] == "closable" and abs(b["items"][0]["gap_pp"] - 7.0) < 1e-9
    assert abs(sum(b["derivative_spine"].values()) - 1.0) < 1e-9
    d = fw.performance_gap_diagnosis(growth=0.0, sector_growth=0.06, margin=0.08, predicted_margin=0.15, asset_turns=1.0, sector_asset_turns=1.8, share_index=0.9)
    assert [x["gap"] for x in d] == ["slow volume growth", "weak operating margin", "poor asset utilisation"] and d[1]["type"] == "operational"
