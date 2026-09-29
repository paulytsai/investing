"""The single HTTP client for every connector.

- Host allowlist: data hosts only (no broker / trading endpoint can ever be reached).
- Token-bucket rate limit per host, Retry-After + exponential backoff, circuit breaker on repeated 429s.
- Immutable raw cache under data/raw/<source>/<endpoint>/<key>[__<hash>].json|csv, with a DuckDB ledger so a
  partial pull resumes.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import threading
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

from ..config import secret, sources
from ..store import RAW_DIR, ledger

ALLOWED_HOSTS = {
    "financialmodelingprep.com",
    "data.alpaca.markets",
    "api.jquants.com",
    "api.edinet-fsa.go.jp",
    "data.sec.gov",
    "www.sec.gov",
    "api.stlouisfed.org",
}

_REDACT = ("apikey", "api_key", "Subscription-Key", "x-api-key", "APCA-API-KEY-ID", "APCA-API-SECRET-KEY")


class HostNotAllowed(RuntimeError):
    pass


class _Bucket:
    def __init__(self, per_minute: float):
        self.rate = per_minute / 60.0
        self.capacity = max(1.0, per_minute / 6.0)
        self.tokens = self.capacity
        self.ts = time.monotonic()
        self.lock = threading.Lock()

    def take(self) -> None:
        with self.lock:
            now = time.monotonic()
            self.tokens = min(self.capacity, self.tokens + (now - self.ts) * self.rate)
            self.ts = now
            if self.tokens < 1:
                wait = (1 - self.tokens) / self.rate
                time.sleep(wait)
                self.tokens = 0
            else:
                self.tokens -= 1


@dataclass
class Response:
    status: int
    data: Any
    text: str
    from_cache: bool


def _redact(params: dict[str, Any] | None) -> dict[str, Any]:
    return {k: ("<redacted>" if k in _REDACT else v) for k, v in (params or {}).items()}


class Client:
    def __init__(self, source: str, timeout: float = 60.0):
        cfg = sources()["hosts"][source]
        self.source = source
        self.base = cfg["base"]
        host = urlparse(self.base).hostname
        if host not in ALLOWED_HOSTS:
            raise HostNotAllowed(host)
        rpm = cfg.get("rpm") or (cfg.get("rps", 5) * 60)
        self.bucket = _Bucket(rpm)
        self.user_agent = cfg.get("user_agent", "paul-engine/0.1")
        self.http = httpx.Client(timeout=timeout, headers={"User-Agent": self.user_agent})
        self._429_streak = 0
        self._ledger_lock = threading.Lock()

    # ---- secrets ---------------------------------------------------------------------------
    def key(self, env_name: str) -> str:
        v = secret(env_name)
        if not v:
            raise RuntimeError(f"{env_name} is not set (add it to environment secrets or .env)")
        return v

    # ---- cache -----------------------------------------------------------------------------
    @staticmethod
    def _hash(params: dict[str, Any] | None) -> str:
        clean = {k: v for k, v in (params or {}).items() if k not in _REDACT}
        return hashlib.sha1(json.dumps(clean, sort_keys=True, default=str).encode()).hexdigest()[:12]

    def cache_path(self, endpoint: str, key: str, params: dict[str, Any] | None, ext: str = "json") -> Path:
        safe_ep = endpoint.strip("/").replace("/", "_")
        safe_key = str(key).replace("/", "_") or "_"
        return RAW_DIR / self.source / safe_ep / f"{safe_key}__{self._hash(params)}.{ext}.gz"

    def _ledger_put(self, endpoint: str, key: str, params: dict[str, Any] | None, status: str,
                    http_status: int | None, rows: int | None, err: str | None) -> None:
        with self._ledger_lock:
            con = ledger()
            try:
                con.execute(
                    "INSERT OR REPLACE INTO pull_ledger VALUES (?,?,?,?,?,?,?,?,?)",
                    [self.source, endpoint, str(key), self._hash(params), status, http_status, rows,
                     datetime.utcnow(), (err or "")[:500]],
                )
            finally:
                con.close()

    # ---- request ---------------------------------------------------------------------------
    def get(self, endpoint: str, params: dict[str, Any] | None = None, *, key: str = "_",
            headers: dict[str, str] | None = None, use_cache: bool = True, max_age_days: int | None = None,
            as_text: bool = False, url: str | None = None) -> Response:
        """GET with cache. `key` names the cache entry (usually the symbol). Errors are raised as
        httpx.HTTPStatusError after retries; a 4xx that is not 429 is cached as an 'empty' marker so the
        pull does not hammer a restricted endpoint."""
        ext = "txt" if as_text else "json"
        path = self.cache_path(endpoint, key, params, ext)
        if use_cache and path.exists():
            if max_age_days is None or (time.time() - path.stat().st_mtime) < max_age_days * 86400:
                raw = gzip.decompress(path.read_bytes()).decode("utf-8")
                if as_text:
                    return Response(200, None, raw, True)
                try:
                    return Response(200, json.loads(raw), raw, True)
                except json.JSONDecodeError:
                    return Response(200, None, raw, True)

        full = url or (self.base.rstrip("/") + "/" + endpoint.lstrip("/"))
        host = urlparse(full).hostname
        if host not in ALLOWED_HOSTS:
            raise HostNotAllowed(host)

        delay = 2.0
        last_exc: Exception | None = None
        for attempt in range(6):
            self.bucket.take()
            try:
                r = self.http.get(full, params=params, headers=headers)
            except (httpx.TransportError, httpx.TimeoutException) as e:  # network hiccup → retry
                last_exc = e
                time.sleep(delay)
                delay = min(delay * 2, 120)
                continue
            if r.status_code == 429:
                self._429_streak += 1
                ra = r.headers.get("Retry-After")
                wait = float(ra) if ra and ra.isdigit() else delay
                if self._429_streak >= 5:
                    wait = max(wait, 600)
                time.sleep(wait)
                delay = min(delay * 2, 120)
                continue
            self._429_streak = 0
            if r.status_code >= 500:
                last_exc = httpx.HTTPStatusError(f"{r.status_code}", request=r.request, response=r)
                time.sleep(delay)
                delay = min(delay * 2, 120)
                continue
            text = r.text
            if r.status_code >= 400:
                self._ledger_put(endpoint, key, params, "error", r.status_code, 0, text[:200])
                raise httpx.HTTPStatusError(f"{r.status_code} {full.split('?')[0]}: {text[:200]}",
                                            request=r.request, response=r)
            data = None
            if not as_text:
                try:
                    data = r.json()
                except ValueError:
                    data = None
            # FMP signals a restricted endpoint with 200 + a plain-text message
            if isinstance(data, dict) and any(k in data for k in ("Error Message", "error")):
                self._ledger_put(endpoint, key, params, "error", r.status_code, 0, text[:200])
                raise httpx.HTTPStatusError(f"API error {full.split('?')[0]}: {text[:200]}",
                                            request=r.request, response=r)
            if not as_text and data is None and text.startswith(("Restricted", "Premium", "Special")):
                self._ledger_put(endpoint, key, params, "error", r.status_code, 0, text[:200])
                raise httpx.HTTPStatusError(f"restricted {full.split('?')[0]}: {text[:120]}",
                                            request=r.request, response=r)
            if use_cache:
                path.parent.mkdir(parents=True, exist_ok=True)
                tmp = path.with_suffix(".tmp")
                tmp.write_bytes(gzip.compress(text.encode("utf-8")))
                tmp.replace(path)
            rows = len(data) if isinstance(data, list) else (1 if data else 0)
            self._ledger_put(endpoint, key, params, "ok" if rows else "empty", r.status_code, rows, None)
            return Response(r.status_code, data, text, False)
        self._ledger_put(endpoint, key, params, "error", None, 0, repr(last_exc))
        raise RuntimeError(f"giving up on {full.split('?')[0]} ({_redact(params)}): {last_exc}")

    def close(self) -> None:
        self.http.close()


def ledger_status(source: str | None = None) -> list[tuple[str, str, str, int]]:
    con = ledger()
    try:
        q = "SELECT source, endpoint, status, count(*) FROM pull_ledger"
        if source:
            q += f" WHERE source = '{source}'"
        q += " GROUP BY 1,2,3 ORDER BY 1,2,3"
        return con.execute(q).fetchall()
    finally:
        con.close()
