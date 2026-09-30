"""Symbol lists from the command line or from files. Every command that takes symbols accepts, in any mix: tickers
(`NVDA,ORCL`), a CSV/TSV/TXT/XLSX path (a `symbol` / `ticker` / `code` column, else the first column), or an `@file`.
Codes are upper-cased and de-duplicated in order; a 4-digit code is a Japanese security code (`7203` → JP)."""
from __future__ import annotations

import csv
import re
from pathlib import Path

COLUMNS = ("symbol", "ticker", "code", "securities code", "stock code", "sec code", "銘柄コード", "コード", "ticker symbol")


def _clean(x: str) -> str | None:
    x = (x or "").strip().strip('"').strip("'").upper()
    x = x.split(":")[-1] if x.count(":") == 1 and not x.startswith("US:") else x   # "NASDAQ:NVDA" → NVDA
    if not x or x in ("SYMBOL", "TICKER", "CODE", "N/A", "NAN"):
        return None
    if x.endswith(".T"):
        x = x[:-2]
    return x if re.fullmatch(r"[A-Z0-9][A-Z0-9.\-]{0,9}", x) else None


def _read_file(path: Path) -> list[str]:
    if path.suffix.lower() in (".xlsx", ".xls"):
        try:
            import pandas as pd
        except ImportError as e:  # pragma: no cover
            raise SystemExit("pandas is required to read spreadsheets") from e
        df = pd.read_excel(path)
        rows = [[str(v) for v in r] for r in df.itertuples(index=False)]
        header = [str(c) for c in df.columns]
        rows = [header] + rows
    else:
        text = path.read_text(encoding="utf-8-sig")
        dialect = csv.excel_tab if path.suffix.lower() == ".tsv" or ("\t" in text and "," not in text.splitlines()[0]) else csv.excel
        rows = [r for r in csv.reader(text.splitlines(), dialect=dialect) if any(c.strip() for c in r)]
    if not rows:
        return []
    header = [c.strip().lower() for c in rows[0]]
    col = next((i for i, h in enumerate(header) if h in COLUMNS), None)
    body = rows[1:] if col is not None or any(h in COLUMNS or h.isalpha() and len(h) > 6 for h in header) else rows
    col = col if col is not None else 0
    out = []
    for r in body:
        if len(r) > col:
            s = _clean(r[col])
            if s:
                out.append(s)
    return out


def read_symbols(spec: str | list[str] | None) -> list[str]:
    """Parse a symbols argument: comma/space separated tickers and/or file paths (optionally prefixed with @)."""
    if not spec:
        return []
    parts = spec if isinstance(spec, list) else re.split(r"[,\s]+", spec)
    out: list[str] = []
    for p in parts:
        if not p:
            continue
        cand = Path(p[1:] if p.startswith("@") else p)
        if cand.exists() and cand.is_file():
            out.extend(_read_file(cand))
        else:
            s = _clean(p)
            if s:
                out.append(s)
    seen, uniq = set(), []
    for s in out:
        if s not in seen:
            seen.add(s)
            uniq.append(s)
    return uniq


def split_regions(symbols: list[str]) -> dict[str, list[str]]:
    """{'US': [...], 'JP': [...]} — 4-digit codes are Japanese."""
    out: dict[str, list[str]] = {"US": [], "JP": []}
    for s in symbols:
        out["JP" if re.fullmatch(r"\d{4}", s) else "US"].append(s)
    return {k: v for k, v in out.items() if v}
