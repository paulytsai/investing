"""Financial Modeling Prep (Ultimate tier) — US primary source; bulk CSV endpoints for the 10-year pull."""
from __future__ import annotations

import gzip
import io
from typing import Any

import pandas as pd

from .http import Client


class FMP:
    def __init__(self) -> None:
        self.c = Client("fmp")
        self.key = self.c.key("FMP_API_KEY")

    def _p(self, **params: Any) -> dict[str, Any]:
        p = {k: v for k, v in params.items() if v is not None}
        p["apikey"] = self.key
        return p

    def get(self, endpoint: str, key: str = "_", max_age_days: int | None = None, **params: Any) -> Any:
        return self.c.get(f"stable/{endpoint}", self._p(**params), key=key, max_age_days=max_age_days).data

    # ---- reference / universe --------------------------------------------------------------
    def profile(self, symbol: str) -> dict[str, Any] | None:
        d = self.get("profile", key=symbol, max_age_days=30, symbol=symbol)
        return d[0] if d else None

    def screener(self, **filters: Any) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        page = 0
        while True:
            d = self.get("company-screener", key=f"p{page}_{filters.get('country','')}_{filters.get('exchange','')}",
                         max_age_days=7, limit=1000, page=page, **filters)
            if not d:
                break
            out.extend(d)
            if len(d) < 1000:
                break
            page += 1
        return out

    def delisted(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        page = 0
        while True:
            d = self.get("delisted-companies", key=f"p{page}", max_age_days=7, page=page, limit=100)
            if not d:
                break
            out.extend(d)
            if len(d) < 100:
                break
            page += 1
        return out

    def sp500_history(self) -> list[dict[str, Any]]:
        return self.get("historical-sp500-constituent", key="sp500", max_age_days=30) or []

    def sp500_current(self) -> list[dict[str, Any]]:
        return self.get("sp500-constituent", key="sp500", max_age_days=30) or []

    # ---- statements ------------------------------------------------------------------------
    def statement(self, kind: str, symbol: str, period: str = "annual", limit: int = 120) -> list[dict[str, Any]]:
        ep = {"income": "income-statement", "balance": "balance-sheet-statement", "cashflow": "cash-flow-statement"}[kind]
        return self.get(ep, key=f"{symbol}_{period}", max_age_days=30, symbol=symbol, period=period, limit=limit) or []

    def statement_as_reported(self, symbol: str, period: str = "annual", limit: int = 40) -> list[dict[str, Any]]:
        return self.get("income-statement-as-reported", key=f"{symbol}_{period}", max_age_days=90,
                        symbol=symbol, period=period, limit=limit) or []

    def bulk_csv(self, endpoint: str, key: str, **params: Any) -> pd.DataFrame:
        """Bulk CSV endpoints (income-statement-bulk?year&period, eod-bulk?date, profile-bulk?part…)."""
        r = self.c.get(f"stable/{endpoint}", self._p(**params), key=key, as_text=True)
        text = r.text
        if text.startswith(("Restricted", "Premium", "{")):
            raise RuntimeError(f"bulk {endpoint} unavailable: {text[:120]}")
        return pd.read_csv(io.StringIO(text), low_memory=False)

    def bulk_statements(self, kind: str, year: int, period: str) -> pd.DataFrame:
        ep = {"income": "income-statement-bulk", "balance": "balance-sheet-statement-bulk",
              "cashflow": "cash-flow-statement-bulk"}[kind]
        return self.bulk_csv(ep, key=f"{year}_{period}", year=year, period=period)

    def bulk_eod(self, date: str) -> pd.DataFrame:
        return self.bulk_csv("eod-bulk", key=date, date=date)

    def bulk_profiles(self, part: int) -> pd.DataFrame:
        return self.bulk_csv("profile-bulk", key=f"part{part}", part=part)

    # ---- prices / caps ---------------------------------------------------------------------
    def prices(self, symbol: str, start: str = "2009-01-01", end: str | None = None) -> list[dict[str, Any]]:
        return self.get("historical-price-eod/full", key=symbol, max_age_days=3, symbol=symbol, **{"from": start, "to": end}) or []

    def prices_div_adjusted(self, symbol: str, start: str = "2009-01-01", end: str | None = None) -> list[dict[str, Any]]:
        return self.get("historical-price-eod/dividend-adjusted", key=symbol, max_age_days=3, symbol=symbol,
                        **{"from": start, "to": end}) or []

    def market_cap_history(self, symbol: str, start: str = "2009-01-01", end: str | None = None) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        # 5,000-row cap per call → walk backwards in windows
        cur_end = end
        for _ in range(8):
            d = self.get("historical-market-capitalization", key=f"{symbol}_{cur_end or 'now'}", max_age_days=3,
                         symbol=symbol, limit=5000, **{"from": start, "to": cur_end}) or []
            if not d:
                break
            out.extend(d)
            oldest = min(x["date"] for x in d)
            if len(d) < 5000 or oldest <= start:
                break
            cur_end = (pd.Timestamp(oldest) - pd.Timedelta(days=1)).strftime("%Y-%m-%d")
        return out

    def splits(self, symbol: str) -> list[dict[str, Any]]:
        return self.get("splits", key=symbol, max_age_days=30, symbol=symbol) or []

    def dividends(self, symbol: str) -> list[dict[str, Any]]:
        return self.get("dividends", key=symbol, max_age_days=7, symbol=symbol) or []

    # ---- events / corroboration ------------------------------------------------------------
    def earnings(self, symbol: str, limit: int = 200) -> list[dict[str, Any]]:
        return self.get("earnings", key=symbol, max_age_days=3, symbol=symbol, limit=limit) or []

    def filings(self, symbol: str, start: str = "2009-01-01", end: str | None = None, page: int = 0) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for pg in range(0, 20):
            d = self.get("sec-filings-search/symbol", key=f"{symbol}_p{pg}", max_age_days=3, symbol=symbol,
                         limit=1000, page=pg, **{"from": start, "to": end}) or []
            out.extend(d)
            if len(d) < 1000:
                break
        return out

    def insider_trades(self, symbol: str) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for pg in range(0, 10):
            d = self.get("insider-trading/search", key=f"{symbol}_p{pg}", max_age_days=3, symbol=symbol, limit=1000, page=pg) or []
            out.extend(d)
            if len(d) < 1000:
                break
        return out

    def analyst_estimates(self, symbol: str, period: str = "annual") -> list[dict[str, Any]]:
        return self.get("analyst-estimates", key=f"{symbol}_{period}", max_age_days=3, symbol=symbol, period=period, limit=40) or []

    def price_target_summary(self, symbol: str) -> dict[str, Any] | None:
        d = self.get("price-target-summary", key=symbol, max_age_days=3, symbol=symbol)
        return d[0] if d else None

    def grades_consensus(self, symbol: str) -> dict[str, Any] | None:
        d = self.get("grades-consensus", key=symbol, max_age_days=3, symbol=symbol)
        return d[0] if d else None

    def ratings_historical(self, symbol: str, limit: int = 400) -> list[dict[str, Any]]:
        return self.get("ratings-historical", key=symbol, max_age_days=7, symbol=symbol, limit=limit) or []

    def key_metrics_ttm(self, symbol: str) -> dict[str, Any] | None:
        d = self.get("key-metrics-ttm", key=symbol, max_age_days=3, symbol=symbol)
        return d[0] if d else None

    def segments(self, symbol: str, kind: str = "product") -> list[dict[str, Any]]:
        ep = "revenue-product-segmentation" if kind == "product" else "revenue-geographic-segmentation"
        return self.get(ep, key=symbol, max_age_days=30, symbol=symbol, period="annual") or []

    def dcf(self, symbol: str) -> dict[str, Any] | None:
        d = self.get("discounted-cash-flow", key=symbol, max_age_days=3, symbol=symbol)
        return d[0] if d else None

    # ---- transcripts / 13F / ETF ----------------------------------------------------------
    def transcript_dates(self, symbol: str) -> list[dict[str, Any]]:
        return self.get("earning-call-transcript-dates", key=symbol, max_age_days=3, symbol=symbol) or []

    def transcript(self, symbol: str, year: int, quarter: int) -> dict[str, Any] | None:
        d = self.get("earning-call-transcript", key=f"{symbol}_{year}Q{quarter}", symbol=symbol, year=year, quarter=quarter)
        return d[0] if d else None

    def thirteenf(self, cik: str, year: int, quarter: int) -> list[dict[str, Any]]:
        return self.get("institutional-ownership/extract", key=f"{cik}_{year}Q{quarter}", cik=cik, year=year, quarter=quarter) or []

    def holders_summary(self, symbol: str, year: int, quarter: int) -> dict[str, Any] | None:
        d = self.get("institutional-ownership/symbol-positions-summary", key=f"{symbol}_{year}Q{quarter}", symbol=symbol,
                     year=year, quarter=quarter)
        return d[0] if d else None

    def etf_holdings(self, symbol: str) -> list[dict[str, Any]]:
        return self.get("etf/holdings", key=symbol, max_age_days=7, symbol=symbol) or []

    # ---- macro / fx ------------------------------------------------------------------------
    def treasury_rates(self, start: str, end: str | None = None) -> list[dict[str, Any]]:
        return self.get("treasury-rates", key=f"{start}_{end}", max_age_days=1, **{"from": start, "to": end}) or []

    def fx(self, pair: str = "USDJPY", start: str = "2009-01-01", end: str | None = None) -> list[dict[str, Any]]:
        return self.get("historical-price-eod/full", key=pair, max_age_days=3, symbol=pair, **{"from": start, "to": end}) or []


def read_raw_csv_gz(path) -> pd.DataFrame:
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return pd.read_csv(f, low_memory=False)
