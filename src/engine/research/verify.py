"""Citation enforcement (§8.7): a Claim is verified only if its source is a doc id from the context or a FinancialRead key
whose value matches within 1%; uncited numbers in free text get '(unverified)'."""
from __future__ import annotations

import re

from .schemas import Claim

NUM_RE = re.compile(r"(?<![\w(])[$€¥]?\d[\d,]*\.?\d*\s?(%|x|bn|B|M|T|億|兆|pp|bp)?(?![\w)])")


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
    """Append '(unverified)' to numbers not followed by a parenthetical citation."""
    n = 0
    out = []
    last = 0
    for m in NUM_RE.finditer(text):
        after = text[m.end(): m.end() + 40]
        if after.lstrip().startswith("(") or "unverified" in after[:15]:
            continue
        out.append(text[last: m.end()])
        out.append(" (unverified)")
        last = m.end()
        n += 1
    out.append(text[last:])
    return "".join(out), n
