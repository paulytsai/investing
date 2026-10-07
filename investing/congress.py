"""Congressional trading report built from Financial Modeling Prep (FMP).

Pulls the latest Senate and House financial disclosures, enriches each
ticker with its sector from the FMP company profile, and renders a
self-contained HTML report (``reports/congress-trades.html``) that groups
trades by sector and ranks them by disclosed size.

Example::

    python -m investing.congress                 # last 90 days -> reports/congress-trades.html
    python -m investing.congress --days 180      # wider window
    python -m investing.congress --artifact out.html   # body-only fragment for claude.ai Artifacts

Profiles are cached in ``data/congress_profiles.json`` (gitignored) so
re-runs only look up tickers that are new.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path
from typing import Any

from investing.fmp import FmpError, get

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = Path(__file__).resolve().parent / "templates" / "congress_report.html"
DEFAULT_OUTPUT = ROOT / "reports" / "congress-trades.html"
PROFILE_CACHE = ROOT / "data" / "congress_profiles.json"

PAGE_SIZE = 100
ENDPOINTS = {"senate": "senate-latest", "house": "house-latest"}

_NUM = re.compile(r"\$?([\d,]+)")


def parse_amount(text: str) -> tuple[int, int | None]:
    """Turn a disclosure band like ``"$15,001 - $50,000"`` into ``(low, high)``.

    Open-ended bands (``"Over $50,000,000"``) return ``high=None``.
    Unparseable text returns ``(0, None)``.
    """
    nums = [int(n.replace(",", "")) for n in _NUM.findall(text or "")]
    if not nums:
        return 0, None
    if len(nums) == 1:
        return nums[0], None
    return min(nums[0], nums[1]), max(nums[0], nums[1])


def fetch_trades(chamber: str, since: dt.date, max_pages: int = 60) -> list[dict[str, Any]]:
    """All ``chamber`` ("senate" | "house") disclosures filed on/after ``since``.

    FMP pages are ordered newest-first by disclosure date, so we stop at the
    first page whose oldest row predates ``since``.
    """
    endpoint = ENDPOINTS[chamber]
    cutoff = since.isoformat()
    out: list[dict[str, Any]] = []
    for page in range(max_pages):
        rows = get(endpoint, page=page, limit=PAGE_SIZE)
        if not rows:
            break
        for row in rows:
            if (row.get("disclosureDate") or "") >= cutoff:
                out.append(_normalize(row, chamber))
        if rows[-1].get("disclosureDate", "") < cutoff or len(rows) < PAGE_SIZE:
            break
    return out


def _normalize(row: dict[str, Any], chamber: str) -> dict[str, Any]:
    low, high = parse_amount(row.get("amount", ""))
    return {
        "chamber": chamber,
        "symbol": (row.get("symbol") or "").strip().upper(),
        "name": f"{row.get('firstName', '').strip()} {row.get('lastName', '').strip()}".strip(),
        "district": row.get("district") or "",
        "owner": row.get("owner") or "",
        "asset": row.get("assetDescription") or "",
        "assetType": row.get("assetType") or "",
        "type": row.get("type") or "",
        "amount": row.get("amount") or "",
        "low": low,
        "high": high,
        "transactionDate": row.get("transactionDate") or "",
        "disclosureDate": row.get("disclosureDate") or "",
        "link": row.get("link") or "",
    }


def load_profile_cache() -> dict[str, Any]:
    if PROFILE_CACHE.exists():
        try:
            return json.loads(PROFILE_CACHE.read_text())
        except json.JSONDecodeError:
            return {}
    return {}


def save_profile_cache(cache: dict[str, Any]) -> None:
    PROFILE_CACHE.parent.mkdir(parents=True, exist_ok=True)
    PROFILE_CACHE.write_text(json.dumps(cache, indent=0, sort_keys=True))


def fetch_profiles(symbols: set[str], cache: dict[str, Any]) -> dict[str, Any]:
    """Sector / industry / name for every symbol, filling ``cache`` in place.

    A symbol FMP does not know is cached as ``None`` so it is not retried.
    """
    todo = sorted(s for s in symbols if s and s not in cache)
    for i, symbol in enumerate(todo, 1):
        try:
            rows = get("profile", symbol=symbol)
        except FmpError as e:
            print(f"  profile {symbol}: {e}", file=sys.stderr)
            continue
        if rows:
            p = rows[0]
            cache[symbol] = {
                "name": p.get("companyName") or "",
                "sector": p.get("sector") or "",
                "industry": p.get("industry") or "",
                "isEtf": bool(p.get("isEtf")),
                "isFund": bool(p.get("isFund")),
                "marketCap": p.get("marketCap") or 0,
            }
        else:
            cache[symbol] = None
        if i % 25 == 0:
            print(f"  profiles {i}/{len(todo)}", file=sys.stderr)
            save_profile_cache(cache)
    save_profile_cache(cache)
    return {s: cache.get(s) for s in symbols if s}


def build_report(days: int = 90) -> dict[str, Any]:
    today = dt.date.today()
    since = today - dt.timedelta(days=days)
    trades: list[dict[str, Any]] = []
    for chamber in ENDPOINTS:
        rows = fetch_trades(chamber, since)
        print(f"{chamber}: {len(rows)} disclosures since {since}", file=sys.stderr)
        trades.extend(rows)
    cache = load_profile_cache()
    profiles = fetch_profiles({t["symbol"] for t in trades}, cache)
    return {
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "since": since.isoformat(),
        "days": days,
        "source": "Financial Modeling Prep senate-latest / house-latest + company profiles",
        "trades": trades,
        "profiles": profiles,
    }


def render(report: dict[str, Any], standalone: bool = True) -> str:
    """Fill the HTML template with the report JSON.

    ``standalone`` wraps the fragment in a full document for local viewing;
    the bare fragment is what the claude.ai Artifact publisher expects.
    """
    template = TEMPLATE.read_text()
    blob = json.dumps(report, separators=(",", ":")).replace("</", "<\\/")
    html = template.replace("__REPORT_DATA__", blob)
    if not standalone:
        return html
    return (
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n"
        "</head>\n<body>\n" + html + "\n</body>\n</html>\n"
    )


def _main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--days", type=int, default=90, help="disclosure window in days (default 90)")
    ap.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="standalone HTML path")
    ap.add_argument("--artifact", type=Path, help="also write a body-only fragment here")
    ap.add_argument("--json", type=Path, help="also dump the report data as JSON")
    args = ap.parse_args(argv)

    report = build_report(days=args.days)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(render(report, standalone=True))
    print(f"wrote {args.output} ({len(report['trades'])} trades)", file=sys.stderr)
    if args.artifact:
        args.artifact.write_text(render(report, standalone=False))
        print(f"wrote {args.artifact}", file=sys.stderr)
    if args.json:
        args.json.write_text(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
