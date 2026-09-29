"""EDINET v2: filings index by date (有価証券報告書 docTypeCode 120) and document download."""
from __future__ import annotations

import io
import zipfile
from typing import Any

from .http import Client

YUHO = "120"


class EDINET:
    def __init__(self) -> None:
        self.c = Client("edinet")
        self.key = self.c.key("EDINET_API_KEY")

    def documents(self, date: str, only_yuho: bool = True) -> list[dict[str, Any]]:
        d = self.c.get("api/v2/documents.json", {"date": date, "type": 2, "Subscription-Key": self.key}, key=date, max_age_days=30).data
        meta = d.get("metadata", {})
        if str(meta.get("status")) != "200":
            return []
        rows = d.get("results") or []
        if only_yuho:
            rows = [r for r in rows if r.get("docTypeCode") == YUHO and r.get("secCode")]
        return rows

    def download(self, doc_id: str, kind: int = 5) -> dict[str, bytes]:
        """kind 1 = XBRL zip, 2 = PDF, 5 = CSV zip. Returns {member_name: bytes} for zips."""
        from ..store import RAW_DIR

        p = RAW_DIR / "edinet" / "docs" / f"{doc_id}_{kind}.bin"
        if p.exists():
            content = p.read_bytes()
        else:
            self.c.bucket.take()
            r = self.c.http.get(f"{self.c.base}/api/v2/documents/{doc_id}", params={"type": kind, "Subscription-Key": self.key})
            r.raise_for_status()
            content = r.content
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(content)
        if kind == 2:
            return {"document.pdf": content}
        out: dict[str, bytes] = {}
        with zipfile.ZipFile(io.BytesIO(content)) as z:
            for name in z.namelist():
                out[name] = z.read(name)
        return out
