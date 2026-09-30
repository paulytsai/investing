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


REQUIRED = ("ENGINE_DATA_BUCKET", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY")


def missing_settings() -> list[str]:
    return [k for k in REQUIRED if not os.environ.get(k)]


def _bucket():
    miss = missing_settings()
    if miss:
        raise SystemExit("missing in the environment (or .env): " + ", ".join(miss) + " — plus AWS_ENDPOINT_URL for Cloudflare R2; see docs/DATA_SHARING.md")
    try:
        import boto3  # noqa: F401
    except ImportError as e:
        raise SystemExit('boto3 not installed: pip install -e ".[sync]"') from e
    import boto3

    endpoint = os.environ.get("AWS_ENDPOINT_URL") or None
    region = os.environ.get("AWS_DEFAULT_REGION") or ("auto" if endpoint and "r2.cloudflarestorage.com" in endpoint else None)   # R2 wants "auto"
    return boto3.client("s3", endpoint_url=endpoint, region_name=region), os.environ["ENGINE_DATA_BUCKET"]


def check() -> dict:
    """Can this machine reach the bucket, and what snapshots are there? Prints a plain report; never prints a key."""
    miss = missing_settings()
    if miss:
        print("[data] not configured — missing: " + ", ".join(miss) + (" (AWS_ENDPOINT_URL is also needed for Cloudflare R2)" if not os.environ.get("AWS_ENDPOINT_URL") else ""))
        print("       see docs/DATA_SHARING.md for the five lines to add")
        return {"ok": False, "missing": miss}
    try:
        s3, bucket = _bucket()
        resp = s3.list_objects_v2(Bucket=bucket, Prefix="engine-data")
    except Exception as e:  # noqa: BLE001
        print(f"[data] cannot reach bucket {os.environ.get('ENGINE_DATA_BUCKET')}: {type(e).__name__}: {str(e)[:200]}")
        return {"ok": False, "error": str(e)[:200]}
    objs = resp.get("Contents") or []
    print(f"[data] bucket {bucket} reachable via {os.environ.get('AWS_ENDPOINT_URL') or 'AWS'}; {len(objs)} snapshot(s):")
    for o in sorted(objs, key=lambda o: o["LastModified"]):
        print(f"       {o['Key']:<40} {o['Size']/1e9:6.2f} GB  {o['LastModified']:%Y-%m-%d %H:%M}")
    if not objs:
        print("       none yet — seed it with `engine data push --raw` from the machine that holds the full data")
    return {"ok": True, "snapshots": [o["Key"] for o in objs]}


def push(archive: Path | None = None, key: str = "engine-data-latest.tar.gz", include_raw: bool = False, dated: bool = False) -> str:
    """Upload a snapshot as KEY; with `dated`, also keep a copy named by today's date so a bad build can be rolled back."""
    s3, bucket = _bucket()                       # fail on configuration before spending minutes packing
    archive = Path(archive) if archive else pack(include_raw=include_raw)
    s3.upload_file(str(archive), bucket, key)
    print(f"[data] pushed {archive.name} → s3://{bucket}/{key}")
    if dated:
        dkey = f"engine-data-{time.strftime('%Y-%m-%d')}{'-raw' if include_raw else ''}.tar.gz"
        s3.copy({"Bucket": bucket, "Key": key}, bucket, dkey)
        print(f"[data] kept a dated copy → s3://{bucket}/{dkey}")
    return f"s3://{bucket}/{key}"


def pull(key: str = "engine-data-latest.tar.gz", overwrite: bool = False) -> None:
    s3, bucket = _bucket()
    dest = DATA_DIR / "snapshots" / key
    dest.parent.mkdir(parents=True, exist_ok=True)
    s3.download_file(bucket, key, str(dest))
    print(f"[data] pulled s3://{bucket}/{key} → {dest}")
    unpack(dest, overwrite=overwrite)
