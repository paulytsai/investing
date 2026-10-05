"""Thin client for the edgar.tools REST API (SEC filings, companies, entities).

Example::

    from investing.edgartools import company, filings
    company("AAPL")["entity"]["company"]["cik"]   # -> "0000320193"
    filings("AAPL", form="10-K", limit=5)

Or from the shell::

    python -m investing.edgartools AAPL
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from investing.config import settings

BASE_URL = "https://api.edgar.tools/v1"


class EdgarToolsError(RuntimeError):
    pass


def get(endpoint: str, **params: Any) -> dict[str, Any]:
    """GET ``/v1/<endpoint>`` and return the parsed JSON body."""
    headers = {"User-Agent": "investing/0.1"}
    # If EDGAR_TOOLS_API_KEY is unset the request goes out without a key. That
    # works where an outbound proxy injects the credential; elsewhere the API
    # answers 401 and the error below says to set the key.
    api_key = settings.get("EDGAR_TOOLS_API_KEY")
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    query = {k: v for k, v in params.items() if v is not None}
    url = f"{BASE_URL}/{endpoint.lstrip('/')}"
    if query:
        url += "?" + urllib.parse.urlencode(query)
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        detail = e.read()[:300].decode("utf-8", "replace")
        hint = " (set EDGAR_TOOLS_API_KEY in .env)" if e.code in (401, 403) else ""
        raise EdgarToolsError(
            f"edgar.tools {endpoint} returned HTTP {e.code}{hint}: {detail}"
        ) from e


def company(identifier: str) -> dict[str, Any]:
    """Company/entity profile by ticker or CIK: SIC, sector, fiscal year end,
    tickers, business summary, etc."""
    return get(f"companies/{urllib.parse.quote(identifier.upper())}")


def cik(identifier: str) -> str:
    """Resolve a ticker (or CIK) to a zero-padded 10-digit CIK."""
    if identifier.isdigit():
        return identifier.zfill(10)
    return company(identifier)["entity"]["company"]["cik"]


def filings(
    identifier: str,
    form: str | None = None,
    limit: int = 20,
    page: int = 1,
) -> list[dict[str, Any]]:
    """Filings for a ticker or CIK, newest first. ``form`` filters by form
    type (e.g. ``"10-K"``, ``"8-K"``, ``"4"``)."""
    body = get(f"companies/{cik(identifier)}/filings", form=form, limit=limit, page=page)
    return body.get("filings", [])


def search(query: str) -> list[dict[str, Any]]:
    """Search companies, funds and people by name or ticker."""
    return get("search", q=query).get("entities", [])


def _main(argv: list[str]) -> int:
    if len(argv) != 1:
        print("usage: python -m investing.edgartools TICKER_OR_CIK", file=sys.stderr)
        return 2
    print(json.dumps(company(argv[0]), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
