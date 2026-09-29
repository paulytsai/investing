import math

import pandas as pd

from engine.frameworks import core as fw


def test_returns_pair_matches_spec_example():
    # spec §5.4: +188% cumulative over ~2.44 years → simple ≈77%/yr, CAGR ≈54%
    r = fw.returns_pair(1.88, 2.44)
    assert abs(r["simple"] - 0.770) < 0.01
    assert abs(r["cagr"] - 0.542) < 0.01


def test_move_decomposition_multiple_only():
    d = fw.move_decomposition(100, 60, 5, 5)
    assert d["basis"] == "pe" and abs(d["dln_eps"]) < 1e-9 and abs(d["f_mult"] - 1.0) < 1e-9


def test_move_decomposition_shares_sum_to_one():
    d = fw.move_decomposition(100, 150, 4, 5)
    assert abs(d["f_eps"] + d["f_mult"] - 1.0) < 1e-9


def test_band_percentile():
    idx = pd.date_range("2015-01-01", periods=2600, freq="B")
    s = pd.Series(range(10, 2610), index=idx, dtype=float)
    b = fw.band_percentile(s, current=10.5, lookback_years=10)
    assert b["percentile"] is not None and b["percentile"] < 1.0


def test_peg_and_hurdle():
    assert abs(fw.peg(37, 33) - 1.121) < 0.01
    assert fw.peg(160, 20) > 5
    assert fw.hurdle_test(12.0, 4.96, 3.0)["passes"] is True
    assert fw.hurdle_test(6.0, 4.96, 3.0)["passes"] is False


def test_operating_leverage():
    ol = fw.operating_leverage(oi_now=120, oi_prev=100, rev_now=1100, rev_prev=1000)
    assert abs(ol["incremental_margin"] - 0.2) < 1e-9
    assert math.isclose(ol["eps_impact_per_1pct_rev"], 0.2 * 0.01 * 1100 / 120 * 100)
