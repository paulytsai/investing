"""SEC EDGAR: submissions index, XBRL companyfacts/frames, filing documents (10-K/10-Q items, 8-K Ex-99.1),
and the Financial Statement Data Sets zips used as the validation oracle for FMP."""
from __future__ import annotations

import re
from typing import Any

from lxml import html as lxml_html

from .http import Client

_UA_NOTE = "SEC asks for a descriptive User-Agent; set EDGAR_USER_AGENT to '<name> <email>' if you like."


class EDGAR:
    def __init__(self) -> None:
        self.c = Client("edgar")
        self.www = Client("edgar_www")
        import os

        ua = os.environ.get("EDGAR_USER_AGENT")
        if ua:
            self.c.http.headers["User-Agent"] = ua
            self.www.http.headers["User-Agent"] = ua

    @staticmethod
    def cik10(cik: str | int) -> str:
        return str(int(cik)).zfill(10)

    def submissions(self, cik: str | int) -> dict[str, Any]:
        return self.c.get(f"submissions/CIK{self.cik10(cik)}.json", key=self.cik10(cik), max_age_days=3).data

    def companyfacts(self, cik: str | int) -> dict[str, Any]:
        return self.c.get(f"api/xbrl/companyfacts/CIK{self.cik10(cik)}.json", key=self.cik10(cik), max_age_days=7).data

    def frame(self, tag: str, period: str, unit: str = "USD") -> dict[str, Any]:
        return self.c.get(f"api/xbrl/frames/us-gaap/{tag}/{unit}/{period}.json", key=f"{tag}_{period}", max_age_days=30).data

    def facts_for_tag(self, cik: str | int, tags: list[str]) -> list[dict[str, Any]]:
        """All facts (any of `tags`, USD or USD/shares) with `filed` dates, first tag with data wins per period."""
        cf = self.companyfacts(cik)
        us = cf.get("facts", {}).get("us-gaap", {})
        out: list[dict[str, Any]] = []
        for tag in tags:
            node = us.get(tag)
            if not node:
                continue
            for unit, rows in node.get("units", {}).items():
                for r in rows:
                    out.append({**r, "tag": tag, "unit": unit})
        return out

    # ---- documents -------------------------------------------------------------------------
    def filing_index(self, cik: str | int, forms: tuple[str, ...] = ("10-K", "10-Q", "8-K", "20-F")) -> list[dict[str, Any]]:
        sub = self.submissions(cik)
        rec = sub.get("filings", {}).get("recent", {})
        rows = []
        for i, form in enumerate(rec.get("form", [])):
            if form in forms:
                rows.append({
                    "form": form,
                    "accession": rec["accessionNumber"][i],
                    "filed": rec["filingDate"][i],
                    "report_date": rec.get("reportDate", [None] * len(rec["form"]))[i],
                    "primary_doc": rec.get("primaryDocument", [None] * len(rec["form"]))[i],
                    "items": rec.get("items", [""] * len(rec["form"]))[i],
                })
        return rows

    def document_text(self, cik: str | int, accession: str, primary_doc: str) -> str:
        acc = accession.replace("-", "")
        url = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc}/{primary_doc}"
        r = self.www.get("", key=f"{acc}_{primary_doc}", as_text=True, url=url)
        return html_to_text(r.text)

    def fsds_zip(self, year: int, quarter: int) -> bytes:
        """Financial Statement Data Sets quarterly zip (validation oracle). Cached on disk as text? No — binary;
        fetched directly, cached by the caller under data/raw/edgar_fsds/."""
        import gzip
        from ..store import RAW_DIR

        p = RAW_DIR / "edgar_fsds" / f"{year}q{quarter}.zip"
        if p.exists():
            return p.read_bytes()
        url = f"https://www.sec.gov/files/dera/data/financial-statement-data-sets/{year}q{quarter}.zip"
        self.www.bucket.take()
        r = self.www.http.get(url, follow_redirects=True)
        r.raise_for_status()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(r.content)
        _ = gzip  # keep import for symmetry with other connectors
        return r.content


_ITEM_RE = re.compile(r"^\s*ITEM\s+(\d+[A-Z]?)\.?\s*(.*)$", re.I)


def html_to_text(raw: str) -> str:
    try:
        doc = lxml_html.fromstring(raw)
    except Exception:
        return re.sub(r"<[^>]+>", " ", raw)
    for bad in doc.xpath("//script|//style"):
        bad.drop_tree()
    text = doc.text_content()
    text = text.replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n\n", text)
    return text.strip()


def split_items(text: str) -> dict[str, str]:
    """Split a 10-K/10-Q text into Items ('1', '1A', '7', '2' …). Heuristic: the last occurrence of each
    'Item N.' heading that begins a line (the table of contents comes first)."""
    positions: dict[str, list[int]] = {}
    for m in re.finditer(r"(?im)^\s*item\s+(\d+[a-z]?)[\.\s:]", text):
        positions.setdefault(m.group(1).upper(), []).append(m.start())
    if not positions:
        return {}
    # choose, per item, the occurrence that starts the longest section
    starts = sorted({(p, k) for k, ps in positions.items() for p in ps})
    best: dict[str, tuple[int, int]] = {}
    for i, (p, k) in enumerate(starts):
        end = starts[i + 1][0] if i + 1 < len(starts) else len(text)
        if k not in best or (end - p) > best[k][1]:
            best[k] = (p, end - p)
    return {k: text[p: p + n].strip() for k, (p, n) in best.items()}
