"""Citation enforcement (§8.7): a Claim is verified only if its source is a doc id from the context or a FinancialRead key
whose value matches within 1%; uncited numbers in free text get '(unverified)'."""
from __future__ import annotations

import re

from .schemas import Claim

NUM_RE = re.compile(r"(?<![\w(\-])[$€¥]?\d[\d,]*\.?\d*\s?(%|x|bn|B|M|T|億|兆|pp|bp)?(?![\w)\-])")
# a parenthetical citation: (period, source) — FY/Q period, ISO date, a doc id (10-K/10-Q/8-K/transcript) or a FinancialRead key
CITE_RE = re.compile(r"\([^()]*(FY\d{2,4}|Q[1-4]\b|\d{4}-\d{2}-\d{2}|FinancialRead\.|transcript|10-K|10-Q|8-K|ReasonComponents|TTM)[^()]*\)", re.I)
YEAR_RE = re.compile(r"^(19|20)\d{2}$")


def doc_ids(messages: list[dict]) -> set[str]:
    ids = set()
    for m in messages:
        for blk in m.get("content", []) if isinstance(m.get("content"), list) else [{"type": "text", "text": m.get("content", "")}]:
            if blk.get("type") == "text":
                ids.update(re.findall(r'<doc id="([^"]+)"', blk["text"]))
    return ids


def verify_claim(c: Claim, ids: set[str], fr: dict) -> Claim:
    src = (c.source or "").strip()
    ok = False
    if src.startswith("FinancialRead."):
        key = src.split(".", 1)[1]
        v = fr.get(key)
        if v is not None and c.value is not None:
            try:
                ok = abs(float(v) - float(c.value)) <= 0.01 * max(1e-9, abs(float(v))) or abs(float(v) * 100 - float(c.value)) <= 0.01 * max(1e-9, abs(float(v) * 100))
            except (TypeError, ValueError):
                ok = False
        elif v is not None:
            ok = True
    elif src:
        ok = any(src == i or src in i or i in src for i in ids)
    c.verified = ok
    if not ok and not c.text.endswith("(unverified)"):
        c.text = c.text + " (unverified)"
    return c


def mark_free_text(text: str) -> tuple[str, int]:
    """Append '(unverified)' to numbers in free text that carry no citation. A number counts as cited when a (period, source)
    parenthetical follows it later in the same sentence (one trailing citation may cover a list of figures). Plain years
    and already-marked numbers are skipped; rule ids (F-105) and 'top-5' are excluded by the regex."""
    n = 0
    pieces = []
    for sent in re.split(r"((?<=[.。!?;])\s+)", text):   # keep the separators
        if not sent or sent.isspace():
            pieces.append(sent)
            continue
        out, last = [], 0
        for m in NUM_RE.finditer(sent):
            tok = m.group(0).strip().rstrip(".")
            rest = sent[m.end():]
            if rest.lstrip().startswith("(") or "unverified" in rest[:15] or YEAR_RE.match(tok) or CITE_RE.search(rest):
                continue
            out.append(sent[last: m.end()])
            out.append(" (unverified)")
            last = m.end()
            n += 1
        out.append(sent[last:])
        pieces.append("".join(out))
    return "".join(pieces), n
