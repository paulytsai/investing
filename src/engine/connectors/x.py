"""X (Twitter) API v2 connector. The bearer token is attached by the environment's proxy for api.x.com —
this module never sets an Authorization header and never reads a key."""
from __future__ import annotations

from typing import Any

from ..config import CONFIG_DIR
from .http import Client


class X:
    def __init__(self) -> None:
        self.c = Client("x")
        self.media = Client("x_media")

    def resolve_user(self, handle: str) -> dict[str, Any]:
        r = self.c.get(f"2/users/by/username/{handle}", {"user.fields": "id,name,username,description"}, key=handle, max_age_days=365)
        return r.data.get("data", {})

    def user_tweets(self, user_id: str, *, fields: dict[str, str], page_size: int = 100, start_time: str | None = None,
                    since_id: str | None = None, next_token: str | None = None) -> dict[str, Any]:
        """One page of GET /2/users/{id}/tweets (exclude=retweets). Raw page cached + ledgered."""
        params: dict[str, Any] = {"exclude": "retweets", "max_results": page_size, **fields}
        if since_id:
            params["since_id"] = since_id
        elif start_time:
            params["start_time"] = start_time
        if next_token:
            params["pagination_token"] = next_token
        key = f"{user_id}_{since_id or start_time or 'latest'}_{next_token or 'p0'}"
        r = self.c.get(f"2/users/{user_id}/tweets", params, key=key, max_age_days=3650)
        return r.data or {}

    def download_media(self, url: str, dest) -> bool:
        """Download an image to `dest` (immutable). Returns False on failure."""
        from pathlib import Path

        dest = Path(dest)
        if dest.exists():
            return True
        try:
            self.media.bucket.take()
            r = self.media.http.get(url, follow_redirects=True)
            if r.status_code != 200:
                return False
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(r.content)
            return True
        except Exception:  # noqa: BLE001
            return False


def save_user_id(handle: str, user_id: str) -> None:
    """Persist the resolved id into config/x_sources.yaml so it is never looked up again."""
    import yaml

    p = CONFIG_DIR / "x_sources.yaml"
    cfg = yaml.safe_load(p.read_text(encoding="utf-8"))
    for a in cfg["accounts"]:
        if a["handle"].lower() == handle.lower():
            a["user_id"] = str(user_id)
    p.write_text(yaml.safe_dump(cfg, allow_unicode=True, sort_keys=False), encoding="utf-8")
