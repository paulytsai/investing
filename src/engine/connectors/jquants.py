"""J-Quants v2 (x-api-key). Subscription on this account covers 2016-09-30 → today."""
from __future__ import annotations

from typing import Any

from .http import Client


class JQuants:
    def __init__(self) -> None:
        self.c = Client("jquants")
        self.headers = {"x-api-key": self.c.key("JQUANTS_API_KEY")}

    def _get(self, endpoint: str, key: str, max_age_days: int | None = None, **params: Any) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        pk: str | None = None
        for _ in range(200):
            p = {k: v for k, v in params.items() if v is not None}
            if pk:
                p["pagination_key"] = pk
            d = self.c.get(f"v2/{endpoint}", p, key=f"{key}_{pk or '0'}", headers=self.headers, max_age_days=max_age_days).data
            out.extend(d.get("data") or [])
            pk = d.get("pagination_key")
            if not pk:
                break
        return out

    def master(self, date: str | None = None, code: str | None = None) -> list[dict[str, Any]]:
        return self._get("equities/master", key=f"{date or 'latest'}_{code or 'all'}", max_age_days=7, date=date, code=code)

    def bars(self, code: str, start: str, end: str | None = None) -> list[dict[str, Any]]:
        return self._get("equities/bars/daily", key=f"{code}_{start}_{end}", max_age_days=3, code=code, **{"from": start, "to": end})

    def bars_by_date(self, date: str) -> list[dict[str, Any]]:
        return self._get("equities/bars/daily", key=f"date_{date}", date=date)

    def fins_summary(self, code: str) -> list[dict[str, Any]]:
        return self._get("fins/summary", key=code, max_age_days=3, code=code)

    def fins_summary_by_date(self, date: str) -> list[dict[str, Any]]:
        return self._get("fins/summary", key=f"date_{date}", date=date)

    def earnings_calendar(self, date: str | None = None) -> list[dict[str, Any]]:
        return self._get("equities/earnings-calendar", key=date or "latest", max_age_days=1, date=date)

    def topix(self, start: str, end: str | None = None) -> list[dict[str, Any]]:
        return self._get("indices/bars/daily", key=f"topix_{start}_{end}", max_age_days=3, code="0000", **{"from": start, "to": end})
