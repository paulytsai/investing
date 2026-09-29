"""Federal Register API (public, no key): rules, proposed rules, notices and presidential documents that touch
sectors Paul cares about (tariffs, export controls, antitrust, nuclear/energy permitting, SEC/FTC rules)."""
from __future__ import annotations

from typing import Any

from .http import Client


class FederalRegister:
    def __init__(self) -> None:
        self.c = Client("federal_register")

    def search(self, term: str, *, start: str, end: str | None = None, doc_types: tuple[str, ...] = ("RULE", "PRORULE", "PRESDOCU"),
               per_page: int = 100, max_pages: int = 5) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for page in range(1, max_pages + 1):
            params: list[tuple[str, Any]] = [("conditions[term]", term), ("conditions[publication_date][gte]", start), ("per_page", per_page),
                                             ("page", page), ("order", "newest"),
                                             ("fields[]", "title"), ("fields[]", "type"), ("fields[]", "abstract"), ("fields[]", "publication_date"),
                                             ("fields[]", "agencies"), ("fields[]", "html_url"), ("fields[]", "document_number"), ("fields[]", "significant")]
            if end:
                params.append(("conditions[publication_date][lte]", end))
            for t in doc_types:
                params.append(("conditions[type][]", t))
            r = self.c.get("api/v1/documents.json", params, key=f"{term}_{start}_{page}", max_age_days=1)
            data = r.data or {}
            out.extend(data.get("results") or [])
            if not data.get("next_page_url"):
                break
        return out
