"""Storage: Parquet tables under data/pit/ read through DuckDB, plus a small DuckDB file for mutable
state (pull ledger, run registry). Every writer validates against TABLES (spec §8.4 rendered as data).
"""
from __future__ import annotations

from pathlib import Path

import duckdb
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from .config import DATA_DIR

PIT_DIR = DATA_DIR / "pit"
RAW_DIR = DATA_DIR / "raw"
LEDGER_DB = DATA_DIR / "ledger.duckdb"

TABLES: dict[str, pa.Schema] = {
    "security_master": pa.schema(
        [
            ("security_id", pa.string()),
            ("symbol", pa.string()),
            ("region", pa.string()),
            ("name", pa.string()),
            ("exchange", pa.string()),
            ("currency", pa.string()),
            ("country", pa.string()),      # ISO-2 domicile from the profile (ADRs: home country) — X-27 geopolitical penalty key
            ("cik", pa.string()),
            ("sector", pa.string()),
            ("industry", pa.string()),
            ("ipo_date", pa.date32()),
            ("delisted_date", pa.date32()),
            ("delist_reason", pa.string()),
            ("is_adr", pa.bool_()),
            ("is_fund", pa.bool_()),
            ("source", pa.string()),
        ]
    ),
    "universe_membership": pa.schema(
        [
            ("security_id", pa.string()),
            ("region", pa.string()),
            ("start_date", pa.date32()),
            ("end_date", pa.date32()),
            ("market_code", pa.string()),
            ("source", pa.string()),
            ("snapshot_date", pa.date32()),
        ]
    ),
    "fundamentals_long": pa.schema(
        [
            ("security_id", pa.string()),
            ("statement", pa.string()),
            ("period_type", pa.string()),
            ("fiscal_year", pa.int32()),
            ("fiscal_period", pa.string()),
            ("period_start", pa.date32()),
            ("period_end", pa.date32()),
            ("field", pa.string()),
            ("value", pa.float64()),
            ("currency", pa.string()),
            ("filing_date", pa.date32()),
            ("available_from", pa.date32()),
            ("lag_imputed", pa.bool_()),
            ("restatement_rank", pa.int16()),
            ("source", pa.string()),
            ("source_ref", pa.string()),
        ]
    ),
    "prices_daily": pa.schema(
        [
            ("security_id", pa.string()),
            ("date", pa.date32()),
            ("close_raw", pa.float64()),
            ("close_adj", pa.float64()),
            ("close_tr", pa.float64()),
            ("volume", pa.float64()),
            ("source", pa.string()),
        ]
    ),
    "market_cap_daily": pa.schema(
        [("security_id", pa.string()), ("date", pa.date32()), ("market_cap", pa.float64()), ("source", pa.string())]
    ),
    "events": pa.schema(
        [
            ("event_id", pa.string()),
            ("security_id", pa.string()),
            ("event_date", pa.date32()),
            ("available_from", pa.date32()),
            ("event_type", pa.string()),
            ("payload", pa.string()),
            ("source", pa.string()),
            ("source_ref", pa.string()),
        ]
    ),
    "fx_daily": pa.schema([("pair", pa.string()), ("date", pa.date32()), ("rate", pa.float64())]),
    "benchmark_daily": pa.schema([("benchmark_id", pa.string()), ("date", pa.date32()), ("level", pa.float64())]),
    "trading_calendar": pa.schema([("region", pa.string()), ("date", pa.date32())]),
    "macro_daily": pa.schema([("series_id", pa.string()), ("date", pa.date32()), ("value", pa.float64())]),
    "transcripts": pa.schema(
        [
            ("security_id", pa.string()),
            ("symbol", pa.string()),
            ("fiscal_year", pa.int32()),
            ("quarter", pa.int16()),
            ("call_date", pa.date32()),
            ("available_from", pa.date32()),
            ("content", pa.string()),
            ("source", pa.string()),
        ]
    ),
    "filings_text": pa.schema(          # 10-K Items 1/1A/7, 10-Q Item 2 (MD&A), 20-F Items 4/5 — dated, first-filed
        [
            ("security_id", pa.string()), ("symbol", pa.string()), ("form", pa.string()), ("accession", pa.string()),
            ("filed", pa.date32()), ("report_date", pa.date32()), ("available_from", pa.date32()), ("item", pa.string()),
            ("text", pa.string()), ("words", pa.int32()), ("source", pa.string()),
        ]
    ),
    "text_signals": pa.schema(          # lexical tier: one row per (document, category)
        [
            ("security_id", pa.string()), ("doc_type", pa.string()), ("doc_ref", pa.string()), ("doc_date", pa.date32()),
            ("available_from", pa.date32()), ("category", pa.string()), ("rule_id", pa.string()), ("direction", pa.int8()),
            ("count", pa.int16()), ("words", pa.int32()), ("quote", pa.string()), ("source", pa.string()),
        ]
    ),
    "text_reads": pa.schema(            # Claude tier: structured TextRead per name (live), cached by request hash
        [
            ("security_id", pa.string()), ("symbol", pa.string()), ("read_date", pa.date32()), ("available_from", pa.date32()),
            ("docs", pa.string()), ("model", pa.string()), ("demand", pa.int8()), ("pricing_power", pa.int8()), ("competitive_position", pa.int8()),
            ("is_number_one", pa.bool_()), ("guidance", pa.int8()), ("ai_receipts", pa.int8()), ("ai_utilization", pa.int8()), ("ai_pricing", pa.int8()),
            ("red_flags_n", pa.int16()), ("tone", pa.int8()), ("payload", pa.string()), ("source", pa.string()),
        ]
    ),
    "theme_mentions": pa.schema([("security_id", pa.string()), ("theme", pa.string()), ("quarter", pa.string()), ("call_date", pa.date32()),
                                 ("available_from", pa.date32()), ("count", pa.int32()), ("words", pa.int32()), ("quote", pa.string()), ("doc_ref", pa.string())]),
    "theme_quarterly": pa.schema([("theme", pa.string()), ("quarter", pa.string()), ("n_docs", pa.int32()), ("n_docs_all", pa.int32()), ("breadth_pct", pa.float64()),
                                  ("n_sectors", pa.int32()), ("n_new_entrants", pa.int32()), ("top_sectors", pa.string()), ("new_entrants", pa.string()), ("mentions_per_doc", pa.float64())]),
    "theme_emerging": pa.schema([("quarter", pa.string()), ("term", pa.string()), ("n_docs", pa.int32()), ("ratio_vs_prior_year", pa.float64()), ("n_docs_all", pa.int32())]),
    "x_theme_weekly": pa.schema([("week", pa.date32()), ("bucket", pa.string()), ("n_threads", pa.int32()), ("sample_summary", pa.string())]),
    "x_posts": pa.schema(
        [
            ("post_id", pa.string()), ("user_id", pa.string()), ("created_at", pa.timestamp("us")), ("available_from", pa.date32()),
            ("conversation_id", pa.string()), ("in_reply_to_user_id", pa.string()), ("is_self_thread_reply", pa.bool_()), ("text", pa.string()),
            ("like_count", pa.int32()), ("reply_count", pa.int32()), ("retweet_count", pa.int32()), ("quote_count", pa.int32()),
            ("media_keys", pa.string()), ("media_urls", pa.string()), ("source", pa.string()),
        ]
    ),
    "x_threads": pa.schema(
        [
            ("conversation_id", pa.string()), ("user_id", pa.string()), ("first_post_id", pa.string()), ("first_at", pa.timestamp("us")),
            ("last_at", pa.timestamp("us")), ("available_from", pa.date32()), ("n_posts", pa.int32()), ("post_ids", pa.string()), ("full_text", pa.string()),
            ("media_urls", pa.string()), ("n_media", pa.int32()), ("like_count", pa.int32()), ("market_relevant", pa.bool_()), ("asset_classes", pa.string()),
            ("sectors", pa.string()), ("themes", pa.string()), ("tickers", pa.string()), ("summary", pa.string()), ("chart_descriptions", pa.string()),
            ("analysis_status", pa.string()), ("source", pa.string()),
        ]
    ),
    "thirteenf": pa.schema(
        [
            ("investor_cik", pa.string()),
            ("investor_name", pa.string()),
            ("period_end", pa.date32()),
            ("filing_date", pa.date32()),
            ("available_from", pa.date32()),
            ("symbol", pa.string()),
            ("cusip", pa.string()),
            ("shares", pa.float64()),
            ("value_usd", pa.float64()),
            ("change_shares", pa.float64()),
        ]
    ),
}


def table_path(name: str) -> Path:
    return PIT_DIR / f"{name}.parquet"


def write_table(name: str, df: pd.DataFrame) -> Path:
    """Validate against TABLES and write (overwrite) the parquet file."""
    schema = TABLES[name]
    missing = [f.name for f in schema if f.name not in df.columns]
    if missing:
        raise ValueError(f"{name}: missing columns {missing}")
    df = df[[f.name for f in schema]].copy()
    for f in schema:
        col = f.name
        if pa.types.is_date32(f.type):
            df[col] = pd.to_datetime(df[col], errors="coerce").dt.date
        elif pa.types.is_floating(f.type):
            df[col] = pd.to_numeric(df[col], errors="coerce").astype("float64")
        elif pa.types.is_integer(f.type):
            df[col] = pd.to_numeric(df[col], errors="coerce").astype("Int64")
        elif pa.types.is_boolean(f.type):
            df[col] = df[col].astype("boolean")
        elif pa.types.is_timestamp(f.type):
            df[col] = pd.to_datetime(df[col], errors="coerce")
        elif pa.types.is_string(f.type):
            df[col] = df[col].astype("string")
    table = pa.Table.from_pandas(df, schema=schema, preserve_index=False)
    PIT_DIR.mkdir(parents=True, exist_ok=True)
    path = table_path(name)
    tmp = path.with_suffix(".parquet.tmp")
    pq.write_table(table, tmp, compression="zstd")
    tmp.replace(path)
    return path



def write_region(name: str, df: pd.DataFrame, region: str) -> Path:
    """Write one region's rows of a table, keeping every other region's rows already stored (US and JP builds
    are independent). Region is recognised by a `region` column, a `security_id` prefix `<REGION>:` or, for
    benchmark_daily, the benchmark ids of that region."""
    bench_ids = {"US": {"SPY_TR", "SPY_PR", "RSP_TR", "RSP_PR", "QQQ_TR", "QQQ_PR", "XLE_TR", "XLE_PR", "VNQ_TR", "VNQ_PR", "URA_TR", "URA_PR",
                        "XLRE_TR", "XLRE_PR"}, "JP": {"TOPIX_PR"}}
    if has_table(name):
        cols = {f.name for f in TABLES[name]}
        # read only the rows to keep (the full-universe prices table is ~37M rows; never load it twice)
        if name == "benchmark_daily":
            others = set().union(*(v for k, v in bench_ids.items() if k != region))
            keep = read_df(name, "benchmark_id IN (" + ",".join("'" + b + "'" for b in sorted(others)) + ")") if others else read_df(name, "1 = 0")
        elif "region" in cols:
            keep = read_df(name, f"region <> '{region}'")
        elif "security_id" in cols:
            keep = read_df(name, f"security_id NOT LIKE '{region}:%'")
        else:
            keep = read_df(name, "1 = 0")
        if not keep.empty:
            df = pd.concat([keep, df], ignore_index=True)
            if "event_id" in df.columns:  # MACRO events are region-less and may be carried by either build
                df = df.drop_duplicates("event_id")
    return write_table(name, df)

def append_table(name: str, df: pd.DataFrame) -> Path:
    """Append rows (dedupe is the caller's job)."""
    if table_path(name).exists():
        old = read_df(name)
        df = pd.concat([old, df], ignore_index=True)
    return write_table(name, df)


def has_table(name: str) -> bool:
    return table_path(name).exists()


def connect() -> duckdb.DuckDBPyConnection:
    """In-memory DuckDB with a view per existing parquet table."""
    con = duckdb.connect()
    for name in TABLES:
        p = table_path(name)
        if p.exists():
            con.execute(f"CREATE VIEW {name} AS SELECT * FROM read_parquet('{p.as_posix()}')")
    return con


def read_df(name: str, where: str | None = None) -> pd.DataFrame:
    p = table_path(name)
    if not p.exists():
        return pd.DataFrame({f.name: pd.Series(dtype="object") for f in TABLES[name]})
    con = duckdb.connect()
    q = f"SELECT * FROM read_parquet('{p.as_posix()}')"
    if where:
        q += f" WHERE {where}"
    return con.execute(q).df()


def ledger() -> duckdb.DuckDBPyConnection:
    """Mutable ledger. If another process holds the file lock, callers get an in-memory connection (their rows are
    lost from the ledger but never block the work); connectors also append to data/ledger_fallback.jsonl."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    try:
        con = duckdb.connect(str(LEDGER_DB))
    except duckdb.IOException:
        con = duckdb.connect()
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS pull_ledger (
            source VARCHAR, endpoint VARCHAR, key VARCHAR, params_hash VARCHAR,
            status VARCHAR, http_status INTEGER, rows INTEGER, fetched_at TIMESTAMP, error_msg VARCHAR,
            PRIMARY KEY (source, endpoint, key, params_hash)
        )
        """
    )
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS runs (
            run_id VARCHAR PRIMARY KEY, kind VARCHAR, as_of DATE, created_at TIMESTAMP, params VARCHAR, path VARCHAR
        )
        """
    )
    return con
