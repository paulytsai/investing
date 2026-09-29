"""FRED macro series (hurdle rate, CPI, USDJPY, spec §6.2 indicator lines)."""
from __future__ import annotations

from typing import Any

from .http import Client

SERIES = {
    "DGS10": "10-yr UST (I-01, hurdle)",
    "DGS1": "1-yr UST",
    "DGS30": "30-yr UST (I-02)",
    "DTB3": "3-month T-bill (I-08 hurdle)",
    "DGS2": "2-yr UST",
    "T10Y2Y": "10y–2y curve (I-05)",
    "DFII10": "10-yr real yield (I-04)",
    "T10YIE": "10-yr breakeven",
    "MORTGAGE30US": "30-yr mortgage (I-09)",
    "CPIAUCSL": "CPI (I-10)",
    "CPILFESL": "Core CPI (I-10)",
    "UNRATE": "Unemployment (I-13)",
    "DCOILWTICO": "WTI (I-43)",
    "DCOILBRENTEU": "Brent (I-43)",
    "DEXJPUS": "USDJPY (I-30)",
    "VIXCLS": "VIX (I-07)",
    "BAMLH0A0HYM2": "HY OAS (I-26/I-53)",
    "DTWEXBGS": "Broad dollar (I-37)",
}


class FRED:
    def __init__(self) -> None:
        self.c = Client("fred")
        self.key = self.c.key("FRED_API_KEY")

    def observations(self, series_id: str, start: str = "2009-01-01") -> list[dict[str, Any]]:
        d = self.c.get(
            "fred/series/observations",
            {"series_id": series_id, "api_key": self.key, "file_type": "json", "observation_start": start},
            key=series_id, max_age_days=1,
        ).data
        rows = []
        for o in d.get("observations", []):
            if o.get("value") not in (None, ".", ""):
                rows.append({"series_id": series_id, "date": o["date"], "value": float(o["value"])})
        return rows
