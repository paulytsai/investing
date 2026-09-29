from engine.frameworks.dcf import DCFInputs, hurdle_check, scenario_dcf

HYP = {"erp_pct": 5.0, "beta_floor": 0.8, "beta_cap": 1.6, "terminal_growth_pct": 2.5, "horizon_years": 10, "growth_cap_pct": 25,
       "scenarios": {"bear": {"growth_mult": 0.5, "margin_delta_pct": -3.0, "prob": 0.25}, "base": {"growth_mult": 1.0, "margin_delta_pct": 0.0, "prob": 0.5},
                     "bull": {"growth_mult": 1.3, "margin_delta_pct": 2.0, "prob": 0.25}}}


def test_reverse_dcf_recovers_growth():
    # a company priced exactly at its base-case value should imply ≈ the base growth
    inp = DCFInputs(price=100.0, shares=1e9, net_debt=0.0, fcf_ttm=4e9, revenue_ttm=20e9, trailing_growth=0.10, rf_pct=4.0, beta=1.0)
    r = scenario_dcf(inp, HYP)
    base_ps = r.scenarios["base"]["per_share"]
    inp2 = DCFInputs(price=base_ps, shares=1e9, net_debt=0.0, fcf_ttm=4e9, revenue_ttm=20e9, trailing_growth=0.10, rf_pct=4.0, beta=1.0)
    r2 = scenario_dcf(inp2, HYP)
    # constant-growth implied vs tapering base path: same order of magnitude, gap small
    assert abs(r2.implied_growth_gap_pp) < 6


def test_scenarios_ordered_and_hurdle():
    inp = DCFInputs(price=50.0, shares=1e9, net_debt=-5e9, fcf_ttm=3e9, revenue_ttm=15e9, trailing_growth=0.12, rf_pct=5.0, beta=1.2)
    r = hurdle_check(scenario_dcf(inp, HYP), 5.0, 3.0)
    assert r.scenarios["bear"]["per_share"] < r.scenarios["base"]["per_share"] < r.scenarios["bull"]["per_share"]
    assert r.range_per_share[0] == r.scenarios["bear"]["per_share"]
    assert r.hurdle["hurdle_pct"] == 8.0 and r.hurdle["passes"] is not None
    assert abs(r.discount_rate_pct - 11.0) < 1e-9


def test_negative_fcf_falls_back_to_revenue_reverse_dcf():
    inp = DCFInputs(price=20.0, shares=1e9, net_debt=0.0, fcf_ttm=-1e9, revenue_ttm=5e9, trailing_growth=0.40, rf_pct=4.5)
    r = scenario_dcf(inp, HYP)
    assert r.ev_weighted_per_share is None and r.implied_growth_pct is not None
