import numpy as np
import pandas as pd

from engine.drivers.phases import Phase, label_phase, zigzag


def test_zigzag_sawtooth():
    idx = pd.date_range("2020-01-03", periods=120, freq="W-FRI")
    # 40 weeks up 2x, 40 weeks down 50%, 40 weeks up 2x
    seg = np.concatenate([np.linspace(100, 200, 40), np.linspace(200, 100, 40), np.linspace(100, 200, 40)])
    s = pd.Series(seg, index=idx)
    ph = zigzag(s, 20.0, 4)
    assert len(ph) == 3
    assert ph[0][1] == idx[39] and ph[1][1] == idx[79]


def test_labels():
    base = dict(idx=1, start=pd.Timestamp("2020-01-01"), end=pd.Timestamp("2020-06-01"), weeks=20, open=False, p0=100, p1=150, ret_pct=50)
    assert label_phase(Phase(**base, basis="pe", f_eps=0.8, f_mult=0.2), 15) == "earnings_led"
    assert label_phase(Phase(**base, basis="pe", f_eps=0.1, f_mult=0.9), 15) == "multiple_led"
    assert label_phase(Phase(**base, basis="pe", f_eps=0.5, f_mult=0.5, bench_ret_pct=40), 15) == "macro"
    p = Phase(**base, basis="none", events=[{"date": "2020-01-10", "high": True}])
    assert label_phase(p, 15) == "event"
