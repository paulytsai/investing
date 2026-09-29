"""Thin client for the X (Twitter) API v2.

Example::

    from investing.xapi import search_recent, user_by_username
    search_recent("from:XDevelopers", max_results=10)
    user_by_username("XDevelopers")

Or from the shell::

    python -m investing.xapi "from:XDevelopers"
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from investing.config import settings

BASE_URL = "https://api.x.com/2"

DEFAULT_TWEET_FIELDS = "created_at,author_id,public_metrics,lang"


class XApiError(RuntimeError):
    pass


def get(endpoint: str, **params: Any) -> dict[str, Any]:
    """GET ``/2/<endpoint>`` and return the parsed JSON body."""
    headers = {"User-Agent": "investing/0.1"}
    # If X_BEARER_TOKEN is unset the request goes out without a token. That
    # works where an outbound proxy injects the credential; elsewhere the API
    # answers 401 and the error below says to set the token.
    token = settings.get("X_BEARER_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
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
        hint = " (set X_BEARER_TOKEN in .env)" if e.code in (401, 403) else ""
        raise XApiError(f"X {endpoint} returned HTTP {e.code}{hint}: {detail}") from e


def search_recent(
    query: str,
    max_results: int = 10,
    tweet_fields: str = DEFAULT_TWEET_FIELDS,
    **params: Any,
) -> list[dict[str, Any]]:
    """Tweets from the last 7 days matching ``query`` (X search syntax,
    e.g. ``"from:XDevelopers"`` or ``"$AAPL lang:en -is:retweet"``).
    ``max_results`` must be 10..100."""
    body = get(
        "tweets/search/recent",
        query=query,
        max_results=max_results,
        **{"tweet.fields": tweet_fields},
        **params,
    )
    return body.get("data", [])


def user_by_username(username: str, user_fields: str = "public_metrics,description,created_at") -> dict[str, Any]:
    body = get(f"users/by/username/{username.lstrip('@')}", **{"user.fields": user_fields})
    return body["data"]


def user_tweets(user_id: str, max_results: int = 10, tweet_fields: str = DEFAULT_TWEET_FIELDS, **params: Any) -> list[dict[str, Any]]:
    body = get(f"users/{user_id}/tweets", max_results=max_results, **{"tweet.fields": tweet_fields}, **params)
    return body.get("data", [])


def _main(argv: list[str]) -> int:
    if len(argv) != 1:
        print('usage: python -m investing.xapi "QUERY"', file=sys.stderr)
        return 2
    print(json.dumps(search_recent(argv[0]), indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
