"""Thin client for the J-Quants (JPX) API v2.

Example::

    from investing.jquants import master, daily_bars
    master("7203")[0]["CoNameEn"]          # -> "TOYOTA MOTOR CORPORATION"
    daily_bars("7203", "20260901")

Or from the shell::

    python -m investing.jquants 7203
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from investing.config import settings

BASE_URL = "https://api.jquants.com/v2"


class JQuantsError(RuntimeError):
    pass


def get(endpoint: str, **params: Any) -> list[dict[str, Any]]:
    """GET ``/v2/<endpoint>``, following ``pagination_key`` until exhausted.
    Returns the concatenated ``data`` rows."""
    headers = {"User-Agent": "investing/0.1"}
    # If JQUANTS_API_KEY is unset the request goes out without a key. That
    # works where an outbound proxy injects the credential; elsewhere the API
    # answers 401/403 and the error below says to set the key.
    api_key = settings.get("JQUANTS_API_KEY")
    if api_key:
        headers["x-api-key"] = api_key

    rows: list[dict[str, Any]] = []
    query = {k: v for k, v in params.items() if v is not None}
    while True:
        url = f"{BASE_URL}/{endpoint.lstrip('/')}?{urllib.parse.urlencode(query)}"
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                payload = json.loads(resp.read())
        except urllib.error.HTTPError as e:
            detail = e.read()[:300].decode("utf-8", "replace")
            hint = " (set JQUANTS_API_KEY in .env)" if e.code in (401, 403) else ""
            raise JQuantsError(f"J-Quants {endpoint} returned HTTP {e.code}{hint}: {detail}") from e
        rows.extend(payload.get("data", []))
        next_key = payload.get("pagination_key")
        if not next_key:
            return rows
        query["pagination_key"] = next_key


def master(code: str | None = None, date: str | None = None) -> list[dict[str, Any]]:
    """Listed-issue master data (name, sector, market segment)."""
    return get("equities/master", code=code, date=date)


def daily_bars(code: str, from_: str | None = None, to: str | None = None) -> list[dict[str, Any]]:
    """Daily OHLCV bars. Dates are YYYYMMDD strings."""
    return get("equities/bars/daily", code=code, **{"from": from_, "to": to})


def fins_summary(code: str) -> list[dict[str, Any]]:
    """Financial statement summaries (kessan tanshin)."""
    return get("fins/summary", code=code)


def market_calendar(from_: str | None = None, to: str | None = None) -> list[dict[str, Any]]:
    return get("markets/calendar", **{"from": from_, "to": to})


def _main(argv: list[str]) -> int:
    if len(argv) != 1:
        print("usage: python -m investing.jquants CODE", file=sys.stderr)
        return 2
    print(json.dumps(master(argv[0]), indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
