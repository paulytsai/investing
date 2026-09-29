"""The full-universe US build streams fundamentals to parquet parts; DuckDB combines them: dedupe, first-filed rank, JP kept."""
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from engine.pit import build as B
from engine.store import TABLES


def _part(path, rows):
    df = pd.DataFrame(rows, columns=["security_id", "statement", "period_type", "fiscal_year", "fiscal_period", "period_start", "period_end", "field", "value",
                                     "currency", "filing_date", "available_from", "lag_imputed", "restatement_rank", "source", "source_ref"])
    for c in ("period_start", "period_end", "filing_date", "available_from"):
        df[c] = pd.to_datetime(df[c])
    df["fiscal_year"] = df["fiscal_year"].astype("Int32")
    df.to_parquet(path, index=False)


def test_combine_parts_dedupes_ranks_and_keeps_other_regions(tmp_path, monkeypatch):
    out = tmp_path / "fundamentals_long.parquet"
    monkeypatch.setattr(B, "table_path", lambda name: out)
    # existing table with one JP row (must survive) and one stale US row (must be replaced)
    existing = pd.DataFrame([{"security_id": "JP:79740", "statement": "jq_summary", "period_type": "Q", "fiscal_year": 2024, "fiscal_period": "1Q", "period_start": None,
                              "period_end": pd.Timestamp("2024-06-30").date(), "field": "revenue", "value": 1.0, "currency": "JPY", "filing_date": pd.Timestamp("2024-08-01").date(),
                              "available_from": pd.Timestamp("2024-08-02").date(), "lag_imputed": False, "restatement_rank": 0, "source": "jquants", "source_ref": ""},
                             {"security_id": "US:OLD", "statement": "income", "period_type": "Q", "fiscal_year": 2020, "fiscal_period": "Q1", "period_start": None,
                              "period_end": pd.Timestamp("2020-03-31").date(), "field": "revenue", "value": 9.0, "currency": "USD", "filing_date": pd.Timestamp("2020-05-01").date(),
                              "available_from": pd.Timestamp("2020-05-04").date(), "lag_imputed": False, "restatement_rank": 0, "source": "fmp", "source_ref": ""}])
    pq.write_table(pa.Table.from_pandas(existing, schema=TABLES["fundamentals_long"], preserve_index=False), out)
    parts = tmp_path / "parts"
    parts.mkdir()
    base = ["US:1", "income", "Q", 2020, "Q1", None, "2020-03-31", "revenue"]
    _part(parts / "a.parquet", [base + [100.0, "USD", "2020-05-01", "2020-05-04", False, 0, "fmp", "x"],
                                base + [100.0, "USD", "2020-05-01", "2020-05-04", False, 0, "fmp_bulk", "y"]])   # duplicate (same value, same date)
    _part(parts / "b.parquet", [base + [105.0, "USD", "2021-05-01", "2021-05-04", False, 0, "fmp", "z"]])       # restatement a year later
    n = B._combine_fundamentals_parts(parts)
    df = pd.read_parquet(out)
    assert n == 2 and len(df) == 3
    us = df[df.security_id == "US:1"].sort_values("available_from")
    assert us["restatement_rank"].tolist() == [0, 1] and us["value"].tolist() == [100.0, 105.0]
    assert (df.security_id == "JP:79740").sum() == 1 and (df.security_id == "US:OLD").sum() == 0
    assert str(df["available_from"].dtype).startswith("object") or "date" in str(df["available_from"].dtype).lower() or "datetime" in str(df["available_from"].dtype)
    assert set(df.columns) == {f.name for f in TABLES["fundamentals_long"]}
