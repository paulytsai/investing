import numpy as np

from engine.frameworks.kelly import growth, kelly_scenarios, portfolio_kelly


def test_scenario_kelly_matches_the_worked_example():
    k = kelly_scenarios([0.25, 0.50, 0.25], [0.80, 0.25, -0.40], fraction=0.5, cap=0.15)
    assert abs(k["expected_return"] - 0.225) < 1e-9 and k["worst"] == -0.40
    assert 1.1 < k["full_unconstrained"] < 1.3 and k["full"] == 1.0   # G'(1) > 0 for these odds: long-only clips at 100%
    assert abs(k["half"] - 0.5 * k["full"]) < 1e-9 and k["practical"] == 0.15 and "capped" in k["note"]
    assert growth(k["full"], [0.25, 0.5, 0.25], [0.8, 0.25, -0.4]) >= growth(0.2, [0.25, 0.5, 0.25], [0.8, 0.25, -0.4])


def test_negative_expectation_gives_zero_allocation():
    k = kelly_scenarios([0.9, 0.1], [0.10, -0.95])       # E[R] = −0.5%: G'(0) < 0 → f* ≤ 0 → 0%
    assert k["expected_return"] < 0 and k["full"] == 0.0 and k["practical"] == 0.0
    k2 = kelly_scenarios([0.5, 0.5], [0.30, -0.20], fraction=0.5, cap=0.15)   # modest edge: full Kelly = E/… ≈ 0.83
    assert 0.0 < k2["full"] < 1.0 and abs(k2["practical"] - min(0.5 * k2["full"], 0.15)) < 1e-12


def test_portfolio_kelly_shrinks_correlated_names():
    mu = np.array([0.15, 0.15])
    rf = 0.04
    indep = portfolio_kelly(mu, np.array([[0.09, 0.0], [0.0, 0.09]]), rf, fraction=1.0, cap=1.0, gross_max=10)
    corr = portfolio_kelly(mu, np.array([[0.09, 0.081], [0.081, 0.09]]), rf, fraction=1.0, cap=1.0, gross_max=10, shrink=0.0)
    assert corr.sum() < indep.sum() and (corr >= 0).all()
    capped = portfolio_kelly(mu, np.array([[0.09, 0.0], [0.0, 0.09]]), rf, fraction=0.5, cap=0.15)
    assert (capped <= 0.15 + 1e-12).all() and capped.sum() <= 1.0
