"""Alpaca market data (data.alpaca.markets only). Daily bars from 2016 for cross-checks and delisted names."""
from __future__ import annotations

from typing import Any

from .http import Client


class Alpaca:
    def __init__(self) -> None:
        self.c = Client("alpaca")
        self.headers = {"APCA-API-KEY-ID": self.c.key("ALPACA_API_KEY"), "APCA-API-SECRET-KEY": self.c.key("ALPACA_SECRET_KEY")}

    def bars(self, symbol: str, start: str = "2016-01-01", end: str | None = None, adjustment: str = "all") -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        token = None
        for _ in range(50):
            params: dict[str, Any] = {"timeframe": "1Day", "start": start, "limit": 10000, "adjustment": adjustment, "feed": "sip"}
            if end:
                params["end"] = end
            if token:
                params["page_token"] = token
            d = self.c.get(f"v2/stocks/{symbol}/bars", params, key=f"{symbol}_{adjustment}_{token or '0'}",
                           headers=self.headers, max_age_days=3).data
            out.extend(d.get("bars") or [])
            token = d.get("next_page_token")
            if not token:
                break
        return out
