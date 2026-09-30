"""Share the point-in-time data between sessions and machines. `pack` writes one tarball of the derived tables (PIT parquet,
candidate cache, LLM cache, text reads) — never raw pulls unless asked, never `.env`; `unpack` restores it; `push`/`pull`
move the tarball to an S3-compatible bucket. The bucket is storage transport, not a data source: credentials come from the
environment only (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, optional `AWS_ENDPOINT_URL`), the bucket from
`ENGINE_DATA_BUCKET`, and boto3 is an optional dependency (`pip install -e ".[sync]"`)."""
from __future__ import annotations

import os
import tarfile
import time
from pathlib import Path

from .config import DATA_DIR

DERIVED = ("pit", "backtest_cache", "llm_cache", "text_reads", "x", "inbox")
RAW = ("raw",)


def pack(out: Path | None = None, include_raw: bool = False) -> Path:
    out = Path(out) if out else DATA_DIR / "snapshots" / f"engine-data-{time.strftime('%Y%m%d-%H%M%S')}.tar.gz"
    out.parent.mkdir(parents=True, exist_ok=True)
    parts = [p for p in DERIVED + (RAW if include_raw else ()) if (DATA_DIR / p).exists()]
    with tarfile.open(out, "w:gz") as tf:
        for p in parts:
            tf.add(DATA_DIR / p, arcname=p, filter=lambda ti: None if ti.name.endswith(".env") or "/_duckdb_tmp" in ti.name else ti)
    print(f"[data] packed {', '.join(parts)} → {out} ({out.stat().st_size / 1e9:.2f} GB)")
    return out


def unpack(archive: Path, overwrite: bool = False) -> None:
    archive = Path(archive)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive, "r:gz") as tf:
        members = tf.getmembers()
        tops = {m.name.split("/")[0] for m in members}
        for t in tops:
            if (DATA_DIR / t).exists() and not overwrite:
                raise SystemExit(f"{DATA_DIR / t} exists; pass --overwrite to replace it")
        tf.extractall(DATA_DIR, filter="data")
    print(f"[data] restored {', '.join(sorted(tops))} into {DATA_DIR}")


def _bucket():
    b = os.environ.get("ENGINE_DATA_BUCKET")
    if not b:
        raise SystemExit("set ENGINE_DATA_BUCKET (and AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY, optional AWS_ENDPOINT_URL) in the environment")
    try:
        import boto3  # noqa: F401
    except ImportError as e:
        raise SystemExit('boto3 not installed: pip install -e ".[sync]"') from e
    import boto3

    return boto3.client("s3", endpoint_url=os.environ.get("AWS_ENDPOINT_URL") or None), b


def push(archive: Path | None = None, key: str = "engine-data-latest.tar.gz", include_raw: bool = False) -> str:
    archive = Path(archive) if archive else pack(include_raw=include_raw)
    s3, bucket = _bucket()
    s3.upload_file(str(archive), bucket, key)
    print(f"[data] pushed {archive.name} → s3://{bucket}/{key}")
    return f"s3://{bucket}/{key}"


def pull(key: str = "engine-data-latest.tar.gz", overwrite: bool = False) -> None:
    s3, bucket = _bucket()
    dest = DATA_DIR / "snapshots" / key
    dest.parent.mkdir(parents=True, exist_ok=True)
    s3.download_file(bucket, key, str(dest))
    print(f"[data] pulled s3://{bucket}/{key} → {dest}")
    unpack(dest, overwrite=overwrite)
