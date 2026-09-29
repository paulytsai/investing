"""JP 決算短信 per-share figures are restated to today's share basis (J-Quants AdjFactor) before YTD de-cumulation."""
import pandas as pd

from engine.pit.jp_fundamentals import restate_per_share, share_basis_factor

SPLIT = [(pd.Timestamp("2022-09-29"), 0.1)]   # Nintendo 10-for-1


def test_factor_applies_only_to_periods_before_the_split():
    assert share_basis_factor(SPLIT, "2022-06-30") == 0.1
    assert share_basis_factor(SPLIT, "2022-09-30") == 1.0
    assert share_basis_factor([], "2022-06-30") == 1.0


def test_restate_per_share_keeps_ytd_decumulation_consistent():
    q1 = restate_per_share({"eps_diluted": 1018.55, "revenue": 3.07e11, "shares_out": 1.2e8}, SPLIT, "2022-06-30")
    q2 = restate_per_share({"eps_diluted": 197.61, "revenue": 6.57e11}, SPLIT, "2022-09-30")
    assert abs(q1["eps_diluted"] - 101.855) < 1e-6 and q1["revenue"] == 3.07e11 and q1["shares_out"] == 1.2e9
    assert q2["eps_diluted"] == 197.61 and "share_basis_factor" not in q2
    assert q2["eps_diluted"] - q1["eps_diluted"] > 0   # Q2 stand-alone EPS is positive once both are on one basis
