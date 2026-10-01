"""Annual operating cash flow for Japan's big three shipping lines (NYK, MOL, K-Line).

Pulls consolidated cash flow statements from FMP and prints a CSV in JPY billions,
one row per fiscal year (Japanese FY ends 31 March; FY2026 = year ended Mar 2026).

    python -m scripts.shipping_ocf [--years 20]
"""

from __future__ import annotations

import argparse
import csv
import sys

from investing.fmp import get

COMPANIES = {"9101.T": "NYK", "9104.T": "MOL", "9107.T": "K-Line"}


def fetch(years: int) -> dict[int, dict[str, float]]:
    table: dict[int, dict[str, float]] = {}
    for symbol, name in COMPANIES.items():
        rows = get("cash-flow-statement", symbol=symbol, period="annual", limit=years + 5)
        for r in rows:
            table.setdefault(int(r["fiscalYear"]), {})[name] = r["operatingCashFlow"] / 1e9
    latest = max(table)
    return {fy: table[fy] for fy in sorted(table) if fy > latest - years}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--years", type=int, default=20)
    args = parser.parse_args()
    out = csv.writer(sys.stdout)
    names = list(COMPANIES.values())
    out.writerow(["fiscal_year", *names, "total"])
    for fy, vals in fetch(args.years).items():
        nums = [vals.get(n) for n in names]
        total = sum(v for v in nums if v is not None)
        out.writerow([fy, *(f"{v:.1f}" if v is not None else "" for v in nums), f"{total:.1f}"])


if __name__ == "__main__":
    main()
