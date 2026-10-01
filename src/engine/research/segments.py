"""Segment history from the XBRL of each 10-K (F-107 drivers: price × quantity by region/segment). EDGAR's companyfacts
API drops dimensioned facts, so a segment series (Nike's Greater China, say) has to be read from the filings' own XBRL
instances, where the facts carry the segment member on the StatementBusinessSegmentsAxis. Each 10-K restates three years;
the latest filing wins for every fiscal year. Raw documents are cached by the EDGAR client (immutable pulls)."""
from __future__ import annotations

import re
from typing import Any

import pandas as pd

from ..connectors.edgar import EDGAR

CTX_RE = re.compile(r"<(?:xbrli:)?context\b[^>]*\bid=\"([^\"]+)\"[^>]*>(.*?)</(?:xbrli:)?context>", re.S)
START_RE = re.compile(r"<(?:xbrli:)?startDate>\s*([\d-]+)\s*<")
END_RE = re.compile(r"<(?:xbrli:)?endDate>\s*([\d-]+)\s*<")
MEMBER_RE = re.compile(r"<(?:xbrldi:)?explicitMember[^>]*dimension=\"([^\"]+)\"[^>]*>\s*([^<\s]+)\s*<")
FACT_RE = re.compile(r"<(?:ix:nonFraction|([\w-]+:[\w-]+))\b([^>]*)>([^<]*)<", re.S)
IX_RE = re.compile(r"<ix:nonFraction\b([^>]*)>(.*?)</ix:nonFraction>", re.S)
ATTR_RE = re.compile(r"([\w:-]+)=\"([^\"]*)\"")


def parse_contexts(xml: str) -> dict[str, dict[str, Any]]:
    """context id → {start, end, members: {axis: member}} (instants have start None)."""
    out: dict[str, dict[str, Any]] = {}
    for cid, body in CTX_RE.findall(xml):
        s, e = START_RE.search(body), END_RE.search(body)
        inst = re.search(r"<(?:xbrli:)?instant>\s*([\d-]+)\s*<", body)
        out[cid] = {"start": s.group(1) if s else None, "end": e.group(1) if e else (inst.group(1) if inst else None),
                    "members": {ax.split(":")[-1]: mem.split(":")[-1] for ax, mem in MEMBER_RE.findall(body)}}
    return out


def _num(text: str, attrs: dict[str, str]) -> float | None:
    t = re.sub(r"[^\d.\-]", "", text or "")
    if t in ("", "-", "."):
        return None
    try:
        v = float(t)
    except ValueError:
        return None
    scale = int(attrs.get("scale", "0") or 0)
    v *= 10 ** scale
    if attrs.get("sign") == "-":
        v = -v
    return v


def parse_facts(xml: str, concepts: set[str]) -> list[dict[str, Any]]:
    """Facts for the named concepts (local names, e.g. 'Revenues'), from an XBRL instance or an inline-XBRL 10-K."""
    rows: list[dict[str, Any]] = []
    if "<ix:nonFraction" in xml:
        for attr_s, inner in IX_RE.findall(xml):
            attrs = dict(ATTR_RE.findall(attr_s))
            name = attrs.get("name", "")
            if name.split(":")[-1] not in concepts:
                continue
            v = _num(re.sub(r"<[^>]+>", "", inner), attrs)
            if v is not None:
                rows.append({"concept": name.split(":")[-1], "qname": name, "context": attrs.get("contextRef"), "value": v})
    else:
        for tag in concepts:
            for m in re.finditer(rf"<([\w-]+:{tag})\b([^>]*)>([^<]*)<", xml):
                attrs = dict(ATTR_RE.findall(m.group(2)))
                v = _num(m.group(3), attrs)
                if v is not None and attrs.get("contextRef"):
                    rows.append({"concept": tag, "qname": m.group(1), "context": attrs["contextRef"], "value": v})
    return rows


PARENT_MEMBERS = {"OperatingSegmentsMember"}


def classify_context(members: dict[str, str], member: str, parents: set[str] | None = None) -> str | None:
    """'total' for the undimensioned company figure; 'segment' when exactly one member matches `member` and every other
    member is a parent (the operating-segments consolidation item, the brand the segment sits under); None otherwise — a
    product, channel or elimination slice of the segment is not the segment."""
    if not members:
        return "total"
    hit = [v for v in members.values() if member.lower() in v.lower()]
    if len(hit) != 1:
        return None
    allowed = PARENT_MEMBERS | (parents or set())
    for val in members.values():
        if val == hit[0]:
            continue
        if not any(a.lower() in val.lower() for a in allowed):
            return None
    return "segment"


def segment_members(symbol_or_cik: str | int, forms: tuple[str, ...] = ("10-K",), years: int = 15) -> pd.DataFrame:
    """Every (axis, member) pair that appears with a 12-month duration context across the filings — to discover a filer's
    segment vocabulary before asking for a history."""
    ed, cik, idx = _filings(symbol_or_cik, forms, years)
    rows = []
    for f in idx:
        xml = _instance(ed, cik, f)
        if xml is None:
            continue
        for c in parse_contexts(xml).values():
            if c["start"] and c["end"] and 350 <= (pd.Timestamp(c["end"]) - pd.Timestamp(c["start"])).days <= 380:
                for ax, mem in c["members"].items():
                    rows.append({"filed": f["filed"], "fiscal_year_end": c["end"], "axis": ax, "member": mem})
    return pd.DataFrame(rows).drop_duplicates() if rows else pd.DataFrame(columns=["filed", "fiscal_year_end", "axis", "member"])


def _filings(symbol_or_cik, forms, years):
    from ..store import read_df

    ed = EDGAR()
    cik = symbol_or_cik
    if isinstance(symbol_or_cik, str) and not symbol_or_cik.isdigit():
        sm = read_df("security_master", f"symbol = '{symbol_or_cik.upper()}'")
        cik = int(sm["cik"].iloc[0])
    idx = [f for f in ed.filing_index(cik, forms=forms, older=True) if f["filed"] >= f"{pd.Timestamp.today().year - years - 1}-01-01"]
    return ed, cik, idx


def _instance(ed: EDGAR, cik, f: dict) -> str | None:
    files = filing_files(ed, cik, f["accession"])
    doc = instance_doc(files, f["primary_doc"])
    if not doc:
        return None
    acc = f["accession"].replace("-", "")
    url = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc}/{doc}"
    return ed.www.get("", key=f"{acc}_{doc}", as_text=True, url=url).text


def filing_files(ed: EDGAR, cik: str | int, accession: str) -> list[str]:
    acc = accession.replace("-", "")
    url = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc}/index.json"
    r = ed.www.get("", key=f"{acc}_index", url=url)
    items = (r.data or {}).get("directory", {}).get("item", [])
    return [i["name"] for i in items]


def instance_doc(files: list[str], primary_doc: str | None) -> str | None:
    """The XBRL instance: `*_htm.xml` (inline era), else the `<ticker>-<date>.xml` instance, else the inline 10-K itself."""
    for f in files:
        if f.endswith("_htm.xml"):
            return f
    cands = [f for f in files if re.match(r"^[a-z]+-\d{8}\.xml$", f)]
    if cands:
        return cands[0]
    return primary_doc


def segment_history(symbol_or_cik: str | int, members: list[str] | str, concepts: dict[str, list[str]], forms: tuple[str, ...] = ("10-K",),
                    years: int = 15, parents: set[str] | None = None) -> pd.DataFrame:
    """Annual history of one or more segment members and of the company total for each named line.

    members: keywords matched inside the XBRL member name (e.g. ["GreaterChina", "NorthAmerica"]); the output `segment`
    column carries the keyword ('total' for the undimensioned figure). concepts: {"revenue": [...], "ebit": [...]} in
    preference order. parents: extra member keywords that may accompany the segment member (a parent brand).
    Returns rows [fiscal_year_end, line, segment, value, concept, accession, filed]; latest filing wins per (year, line, segment)."""
    members = [members] if isinstance(members, str) else list(members)
    ed, cik, idx = _filings(symbol_or_cik, forms, years)
    all_concepts = {c for cs in concepts.values() for c in cs}
    rows: list[dict[str, Any]] = []
    for f in idx:
        xml = _instance(ed, cik, f)
        if xml is None:
            continue
        ctx = parse_contexts(xml)
        facts = parse_facts(xml, all_concepts)
        for fact in facts:
            c = ctx.get(fact["context"])
            if not c or not c["start"] or not c["end"]:
                continue
            days = (pd.Timestamp(c["end"]) - pd.Timestamp(c["start"])).days
            if not 350 <= days <= 380:
                continue
            seg = None
            if not c["members"]:
                seg = "total"
            else:
                for m in members:
                    if classify_context(c["members"], m, parents) == "segment":
                        seg = m
                        break
            if seg is None:
                continue
            line = next((ln for ln, cs in concepts.items() if fact["concept"] in cs), None)
            rows.append({"fiscal_year_end": c["end"], "line": line, "segment": seg, "value": fact["value"], "concept": fact["concept"],
                         "accession": f["accession"], "filed": f["filed"], "concept_rank": concepts[line].index(fact["concept"])})
    if not rows:
        return pd.DataFrame(columns=["fiscal_year_end", "line", "segment", "value", "concept", "accession", "filed"])
    df = pd.DataFrame(rows).sort_values(["fiscal_year_end", "line", "segment", "filed", "concept_rank"], ascending=[True, True, True, False, True])
    df = df.drop_duplicates(["fiscal_year_end", "line", "segment"], keep="first").drop(columns="concept_rank")
    return df.reset_index(drop=True)
