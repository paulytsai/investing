import numpy as np
import pandas as pd

from engine.screen import commodity as cm


def _frame(margins, capex_ocf):
    idx = pd.date_range("2010-03-31", periods=len(margins), freq="QE")
    return pd.DataFrame({"margin": margins, "capex_ocf": capex_ocf, "capex_rev": capex_ocf, "revenue_ttm": 1.0}, index=idx)


def test_disciplined_trough_lifts_and_undisciplined_peak_lowers(monkeypatch):
    t = np.arange(60)
    wave = 0.15 + 0.10 * np.sin(2 * np.pi * t / 16)          # a 4-year cycle
    # trough today with capex well below the norm
    monkeypatch.setattr(cm, "_series", lambda g, a: _frame(np.append(wave[:-1], 0.04), np.append(np.full(59, 0.8), 0.3)))
    r = cm.cycle_read("oil_gas", "2026-09-25")
    assert r["phase"].startswith("trough") and r["disciplined"] and r["score_adjust"] > 0 and 3.5 <= r["cycle_years"] <= 4.5
    assert "capex discipline high" in r["verdict"]
    # peak today with capex above the norm
    monkeypatch.setattr(cm, "_series", lambda g, a: _frame(np.append(wave[:-1], 0.28), np.append(np.full(59, 0.5), 0.9)))
    r2 = cm.cycle_read("oil_gas", "2026-09-25")
    assert r2["phase"].startswith("peak") and not r2["disciplined"] and r2["score_adjust"] < 0


def test_dampened_cycle_is_detected(monkeypatch):
    t = np.arange(60)
    prior = 0.15 + 0.12 * np.sin(2 * np.pi * t[:40] / 16)
    recent = 0.15 + 0.03 * np.sin(2 * np.pi * t[40:] / 16)
    monkeypatch.setattr(cm, "_series", lambda g, a: _frame(np.concatenate([prior, recent]), np.full(60, 0.5)))
    r = cm.cycle_read("oil_gas", "2026-09-25")
    assert r["dampened"] and r["amplitude_ratio"] < 0.5 and "dampened" in r["verdict"]


def test_group_for_uses_symbol_then_industry():
    assert cm.group_for("Computer Hardware", "SNDK") == "memory" and cm.group_for("Steel", "NUE") == "steel" and cm.group_for("Software", "X") is None
