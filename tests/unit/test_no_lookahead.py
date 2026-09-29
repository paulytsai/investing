"""INV: snapshot() never returns facts filed after as_of; first-filed wins; lag shift matters."""
from datetime import date

import pandas as pd
import pytest

from engine import store
from engine.pit import snapshot as snap


@pytest.fixture
def tiny_store(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "PIT_DIR", tmp_path / "pit")
    rows = []
    sid = "US:0000000001"

    def add(pt, pe, field, value, avail, rank=0):
        rows.append({"security_id": sid, "statement": "income", "period_type": pt, "fiscal_year": pe.year, "fiscal_period": "Q",
                     "period_start": None, "period_end": pe, "field": field, "value": value, "currency": "USD",
                     "filing_date": avail, "available_from": avail, "lag_imputed": False, "restatement_rank": rank,
                     "source": "test", "source_ref": ""})

    for i, pe in enumerate([date(2019, 3, 31), date(2019, 6, 30), date(2019, 9, 30), date(2019, 12, 31), date(2020, 3, 31)]):
        add("Q", pe, "revenue", 100 + i, pd.Timestamp(pe) + pd.Timedelta(days=40))
    # restated Q1-2020 revenue filed later must not displace the first-filed value
    add("Q", date(2020, 3, 31), "revenue", 999, pd.Timestamp("2020-08-01"), rank=1)
    # a future fact
    add("Q", date(2020, 6, 30), "revenue", 500, pd.Timestamp("2020-08-10"))
    store.write_table("fundamentals_long", pd.DataFrame(rows))
    return sid


def test_future_facts_excluded(tiny_store):
    s = snap.snapshot(tiny_store, "2020-06-30")
    assert s.period_end == pd.Timestamp("2020-03-31")
    assert s.metrics["revenue"] == 101 + 102 + 103 + 104  # last four visible quarters


def test_first_filed_wins(tiny_store):
    s = snap.snapshot(tiny_store, "2020-09-30")
    # Q2-2020 (500) now visible; Q1-2020 must still be 104, not the restated 999
    assert s.metrics["revenue"] == 102 + 103 + 104 + 500


def test_lag_shift_changes_result(tiny_store):
    before = snap.snapshot(tiny_store, "2020-05-15").metrics["revenue"]
    fl = store.read_df("fundamentals_long")
    fl["available_from"] = pd.to_datetime(fl["available_from"]) + pd.Timedelta(days=90)
    store.write_table("fundamentals_long", fl)
    after = snap.snapshot(tiny_store, "2020-05-15").metrics["revenue"]
    assert before != after
