"""Thin client for the Financial Modeling Prep (FMP) "stable" API.

Example::

    from investing.fmp import profile
    profile("AAPL")["companyName"]   # -> "Apple Inc."

Or from the shell::

    python -m investing.fmp AAPL
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from investing.config import settings

BASE_URL = "https://financialmodelingprep.com/stable"


class FmpError(RuntimeError):
    pass


def get(endpoint: str, **params: Any) -> Any:
    """GET ``/stable/<endpoint>`` with the API key appended. Returns parsed JSON."""
    query = {k: v for k, v in params.items() if v is not None}
    # If FMP_API_KEY is unset the request goes out without a key. That works
    # in environments where an outbound proxy injects the credential; anywhere
    # else FMP answers 401 and the error below says to set the key.
    api_key = settings.get("FMP_API_KEY")
    if api_key:
        query["apikey"] = api_key
    url = f"{BASE_URL}/{endpoint.lstrip('/')}?{urllib.parse.urlencode(query)}"
    req = urllib.request.Request(url, headers={"User-Agent": "investing/0.1"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read()
    except urllib.error.HTTPError as e:
        detail = e.read()[:300].decode("utf-8", "replace")
        hint = " (set FMP_API_KEY in .env)" if e.code in (401, 403) else ""
        raise FmpError(f"FMP {endpoint} returned HTTP {e.code}{hint}: {detail}") from e
    data = json.loads(body)
    if isinstance(data, dict) and "Error Message" in data:
        raise FmpError(data["Error Message"])
    return data


def profile(symbol: str) -> dict[str, Any]:
    """Company profile: price, market cap, sector, description, etc."""
    rows = get("profile", symbol=symbol.upper())
    if not rows:
        raise FmpError(f"No profile found for {symbol!r}")
    return rows[0]


def quote(symbol: str) -> dict[str, Any]:
    rows = get("quote", symbol=symbol.upper())
    if not rows:
        raise FmpError(f"No quote found for {symbol!r}")
    return rows[0]


def _main(argv: list[str]) -> int:
    if len(argv) != 1:
        print("usage: python -m investing.fmp SYMBOL", file=sys.stderr)
        return 2
    print(json.dumps(profile(argv[0]), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
