import numpy as np
import pandas as pd

from engine.frameworks.implied_growth import implied_eps_growth, implied_growth, implied_revenue_growth, plain_sentence, verdict_for
from engine.frameworks.valuation_cycle import monthly, phase_for, valuation_cycle


def test_implied_eps_growth_identity():
    # paying the exit multiple today: growth must equal the required return
    assert abs(implied_eps_growth(16, 16, 9, 5) - 9.0) < 1e-9
    # P/E 30 exiting at 16 over 5 years at 9%: ((30/16)·1.09^5)^(1/5) − 1 ≈ 23%
    g = implied_eps_growth(30, 16, 9, 5)
    assert 22.5 < g < 24.0
    assert implied_eps_growth(None, 16, 9) is None
    assert implied_eps_growth(30, 0, 9) is None


def test_implied_revenue_growth():
    # P/S 10, mature margin 15%, exit P/E 16 → price/earnings-at-maturity = 10/(0.15·16) = 4.17x → ≈ 44%/yr at 9%
    g = implied_revenue_growth(10, 15, 16, 9, 5)
    assert 42 < g < 46
    assert implied_revenue_growth(10, None, 16, 9) is None


def test_implied_growth_record_eps_and_verdict():
    m = {"pe_ttm": 30.0, "eps_ttm": 2.0, "pe_band_median": 20.0, "pe_band_n": 2000, "eps_cagr_3y": 0.30}
    ig = implied_growth(m, rf_pct=4.0, hurdle_margin_pct=3.0, years=5, exit_pe_fallback=16, mature_margin_pct=15, hypergrowth_min_rev_growth_pct=30)
    assert ig["basis"] == "eps" and ig["pe_exit"] == 16.0 and ig["pe_norm"] == 20.0      # headline exit = the lower of own norm and market
    assert 20 < ig["implied_pct"] < 22          # ((30/16)·1.07^5)^(0.2) − 1 ≈ 21%
    assert 14 < ig["implied_pct_norm"] < 17     # ((1.5)·1.07^5)^(0.2) − 1 ≈ 15.9% if it keeps its usual 20x
    assert "usual 20x" in plain_sentence(ig)
    cheap = {**m, "pe_band_median": 12.0}
    ig3 = implied_growth(cheap, rf_pct=4.0, hurdle_margin_pct=3.0, years=5, exit_pe_fallback=16, mature_margin_pct=15, hypergrowth_min_rev_growth_pct=30)
    assert ig3["pe_exit"] == 12.0 and "own 10-year" in ig3["pe_exit_source"]
    assert ig["gap_pp"] > 3 and ig["verdict"] == "priced for less than it has delivered"
    assert "earnings grow" in plain_sentence(ig)
    # short band → fallback exit multiple
    m2 = {**m, "pe_band_n": 100}
    ig2 = implied_growth(m2, rf_pct=4.0, hurdle_margin_pct=3.0, years=5, exit_pe_fallback=16, mature_margin_pct=15, hypergrowth_min_rev_growth_pct=30)
    assert ig2["pe_exit"] == 16


def test_implied_growth_no_earnings_hypergrowth_rule():
    m = {"pe_ttm": None, "eps_ttm": -0.5, "ps_ttm": 12.0, "pe_band_n": 0, "rev_cagr_3y": 0.45, "rev_growth_ttm": 0.40, "gm_trend_3y": 0.01}
    ig = implied_growth(m, rf_pct=4.0, hurdle_margin_pct=3.0, years=5, exit_pe_fallback=16, mature_margin_pct=15, hypergrowth_min_rev_growth_pct=30)
    assert ig["basis"] == "revenue" and ig["hypergrowth_ok"] is True and ig["implied_pct"] is not None
    assert "it is." in ig["note"]
    slow = {**m, "rev_growth_ttm": 0.10, "rev_cagr_3y": 0.12}
    ig2 = implied_growth(slow, rf_pct=4.0, hurdle_margin_pct=3.0, years=5, exit_pe_fallback=16, mature_margin_pct=15, hypergrowth_min_rev_growth_pct=30)
    assert ig2["hypergrowth_ok"] is False and "not rapid enough" in plain_sentence(ig2)
    assert verdict_for(0.0) == "priced for about what it has delivered" and verdict_for(None) is None


def test_valuation_cycle_phases_and_percentile():
    idx = pd.bdate_range("2016-01-01", "2026-01-01")
    rng = np.random.default_rng(0)
    hist = pd.Series(20 + 10 * np.sin(np.arange(len(idx)) / 200) + rng.normal(0, 0.5, len(idx)), index=idx)
    low = valuation_cycle(hist, 11.0, trough_pctile=20, peak_pctile=80)
    assert low["phase"] == "trough" and low["percentile"] < 20 and "near the bottom" in low["sentence"]
    high = valuation_cycle(hist, 29.5)
    assert high["phase"] == "peak" and "near the top" in high["sentence"]
    mid = valuation_cycle(hist, float(hist.median()))
    assert mid["phase"] == "normal"
    assert phase_for(None) is None and phase_for(35) == "below norm"
    short = valuation_cycle(hist.iloc[-300:], 20.0)
    assert short["phase"] is None and "too short" in short["sentence"]
    pts = monthly(hist, years=10)
    assert 115 <= len(pts) <= 122 and len(pts[0]) == 2
