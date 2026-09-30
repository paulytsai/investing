import numpy as np
import pandas as pd

from engine.backtest.cycle import breadth_over, exit_targets
from engine.backtest.portfolio import PickResult, overlapping_curve
from engine.backtest.metrics import cohort_stats


def _q(s):
    return pd.Timestamp(s)


def test_cycle_exit_needs_two_consecutive_underweights_and_respects_min_hold():
    f = _q("2020-03-31")
    evals = [f + pd.offsets.QuarterEnd(i) for i in range(1, 21)]
    st = {d: {"ai_chips": "overweight", "energy": "underweight"} for d in evals + [f]}
    st[evals[0]]["ai_chips"] = "underweight"           # one quarter only → not over
    st[evals[1]]["ai_chips"] = "underweight"           # second in a row at 2020-09-30 → call reversed, but min hold 12m binds
    st[evals[0]]["energy"] = st[evals[1]]["energy"] = "underweight"   # formed underweight: staying underweight is not a reversal
    ex = exit_targets(f, evals, st, {"ai_chips": None, "energy": None}, {}, 12, 60, 2, 25)
    assert ex["ai_chips"]["target"] == f + pd.DateOffset(months=12) and "cycle over at 2020-09-30" in ex["ai_chips"]["reason"]
    assert ex["energy"]["target"] == f + pd.DateOffset(months=60)
    st2 = {d: {"ai_chips": "overweight"} for d in evals + [f]}
    ex2 = exit_targets(f, evals, st2, {"ai_chips": None}, {}, 12, 60, 2, 25)
    assert ex2["ai_chips"]["target"] == f + pd.DateOffset(months=60) and "max hold" in ex2["ai_chips"]["reason"]
    st3 = {d: {"ai_chips": "neutral"} for d in evals + [f]}
    st3[evals[2]]["ai_chips"] = st3[evals[3]]["ai_chips"] = "avoid"
    assert "avoid" in exit_targets(f, evals, st3, {"ai_chips": None}, {}, 12, 60, 2, 25)["ai_chips"]["reason"]


def test_breadth_signal_uses_only_completed_quarters():
    idx = pd.to_datetime(["2023-03-31", "2023-06-30", "2023-09-30", "2023-12-31", "2024-03-31", "2024-06-30"])
    b = {"ai_compute": pd.Series([10, 20, 30, 40, 25, 60], index=idx), "glp1": pd.Series([1, 2, 3, 4, 2.5, 6], index=idx)}
    assert breadth_over("ai_compute", _q("2024-06-30"), b, 25)       # last completed quarter (2024-03-31) 25 vs peak 40 → −37%
    assert not breadth_over("ai_compute", _q("2024-09-30"), b, 25)   # 2024-06-30 = 60 is the new peak
    assert not breadth_over(None, _q("2024-06-30"), b, 25)
    assert not breadth_over("glp1", _q("2024-06-30"), b, 25)     # never reached 10% breadth: not a cycle


class _Book:
    def __init__(self):
        self.cal = pd.bdate_range("2020-01-01", "2020-03-31")
        self.bench = pd.Series(np.linspace(100, 110, len(self.cal)), index=self.cal)
        self.bench2 = None
        self.tr = pd.DataFrame({"A": np.linspace(10, 20, len(self.cal)), "B": np.linspace(10, 5, len(self.cal))}, index=self.cal)

    def path(self, sid, entry, exit_):
        s = self.tr[sid]
        s = s[(s.index >= entry) & (s.index <= exit_)]
        return s / s.iloc[0]


def test_kelly_weighted_cohort_and_curve_freeze_exited_picks():
    book = _Book()
    cal = book.cal
    a = PickResult("A", "A", cal[0], cal[1], cal[-1], 10, 20, 1.0, 0.1, "ok", weight=0.75, hold_years=0.25)
    b = PickResult("B", "B", cal[0], cal[1], cal[30], 10, 6, -0.4, 0.05, "ok", weight=0.25, hold_years=0.12, exit_reason="cycle over")
    st = cohort_stats([a, b], 24, rf=0.0)
    assert abs(st["ret_kelly"] - (0.75 * 1.0 + 0.25 * -0.4)) < 1e-9 and abs(st["kelly_gross"] - 1.0) < 1e-9
    assert abs(st["ret_kelly_cash"] - (0.75 * 1.0 + 0.25 * -0.4)) < 1e-9 and st["kelly_top"][0] == "A"
    curve = overlapping_curve({cal[0]: [a, b]}, book, 24, weighted=True)
    ew = overlapping_curve({cal[0]: [a, b]}, book, 24, weighted=False)
    assert curve["portfolio"].iloc[-1] > ew["portfolio"].iloc[-1]            # Kelly puts more on the winner
    # after B's exit its proceeds track the benchmark (rising here), so the basket keeps rising with A and the index
    after = curve["portfolio"].loc[cal[31]:]
    assert (after.diff().dropna() > 0).all()


def test_shares_are_not_summed_over_four_quarters():
    from engine.pit.fields import FLOW_FIELDS
    from engine.pit.snapshot import _ttm_from_quarters
    q = pd.DataFrame([{"period_end": pd.Timestamp(d), "field": f, "value": v} for d in ("2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31")
                      for f, v in (("revenue", 10.0), ("shares_diluted", 24.0))])
    ttm, _, _ = _ttm_from_quarters(q, pd.Timestamp("2026-01-31"))
    assert ttm["revenue"] == 40.0 and ttm["shares_diluted"] == 24.0 and "shares_diluted" not in FLOW_FIELDS


def test_currency_mismatch_voids_valuation_only():
    from engine.screen.metrics import void_if_currency_mismatch

    class S:
        currency = "ARS"
    out = void_if_currency_mismatch({"pe_ttm": 0.007, "rev_growth_ttm": 0.4, "p_ocf": 0.004}, S(), "USD")
    assert out["pe_ttm"] is None and out["p_ocf"] is None and out["rev_growth_ttm"] == 0.4 and "ARS" in out["currency_mismatch"]
    assert "currency_mismatch" not in void_if_currency_mismatch({"pe_ttm": 20.0}, S(), "ARS")


def test_band_scenarios_reward_a_name_below_its_band():
    from engine.backtest.sizing import scenario_block

    class C:
        coverage = 0.95
        metrics = {"rev_cagr_3y": 0.30, "pe_ttm": 28.0, "pe_band_low": 32.0, "pe_band_median": 54.0, "pe_band_high": 91.0, "pe_band_n": 2400}
    b = scenario_block(C(), 0.45, 3.0, 0.5, 0.15)
    assert b["expected_return"] > 0.5 and b["worst"] <= -0.45 * np.sqrt(3.0) + 1e-9 and b["confidence_label"] == "high"
    assert b["practical"] == 0.15 and any("R-24" in a for a in b["assumptions"])
    C.metrics = {"rev_cagr_3y": -0.05}      # shrinking, no band: expectation negative-ish → little or no allocation
    b2 = scenario_block(C(), 0.30, 3.0, 0.5, 0.15)
    assert b2["practical"] < 0.05
