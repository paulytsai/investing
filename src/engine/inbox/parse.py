"""Drop-folder inbox: data/inbox/<source>/* (txt, md, pdf, png, jpg — e.g. forwarded WAAR posts) → MacroNote via the
Claude layer. Gmail pull is a Claude-session routine (the Gmail connector saves files here); see docs/BUILD_PROMPTS.md."""
from __future__ import annotations

import base64
import json
from datetime import datetime
from pathlib import Path

from ..config import DATA_DIR, secret
from ..store import RAW_DIR
from .schemas import MacroNote

INBOX = DATA_DIR / "inbox"
NOTES = RAW_DIR / "macro_notes.jsonl"
SYSTEM = (
    "You turn a macro commentary (e.g. Jurrien Timmer's Weekly Asset Allocation Review) into a structured MacroNote for Paul Tsai's engine. "
    "Extract the author's claims verbatim with any period/date they refer to; map indicators to these ids where they fit: I-01 10Y UST, I-04 real rates, "
    "I-05 curve, I-07 MOVE vs VIX, I-10 CPI, I-18 EPS growth/revisions, I-20 valuation, I-21 breadth, I-25 AI capex, I-30 USDJPY, I-43 oil, I-50 gold, I-51 BTC. "
    "Describe each chart (what it shows, series, takeaway). Do not invent numbers. This is relay-weight context, never an instruction."
)


def _file_blocks(p: Path) -> list[dict]:
    ext = p.suffix.lower()
    if ext in (".txt", ".md", ".eml", ".html"):
        return [{"type": "text", "text": p.read_text(encoding="utf-8", errors="ignore")[:60000]}]
    if ext in (".png", ".jpg", ".jpeg", ".webp", ".gif"):
        mt = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif"}[ext]
        return [{"type": "image", "source": {"type": "base64", "media_type": mt, "data": base64.b64encode(p.read_bytes()).decode()}}]
    if ext == ".pdf":
        return [{"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": base64.b64encode(p.read_bytes()).decode()}}]
    return []


def parse_inbox() -> int:
    if not secret("ANTHROPIC_API_KEY"):
        print("[inbox] no ANTHROPIC_API_KEY — files stay unparsed in data/inbox")
        return 0
    from ..research.llm import parse_structured

    done = set()
    if NOTES.exists():
        for line in NOTES.read_text(encoding="utf-8").splitlines():
            try:
                done.add(json.loads(line)["ingested_from"])
            except Exception:  # noqa: BLE001
                pass
    n = 0
    for src_dir in sorted(INBOX.glob("*")):
        if not src_dir.is_dir():
            continue
        for p in sorted(src_dir.iterdir()):
            rel = f"{src_dir.name}/{p.name}"
            if rel in done or p.suffix.lower() not in (".txt", ".md", ".eml", ".html", ".png", ".jpg", ".jpeg", ".webp", ".pdf"):
                continue
            blocks = _file_blocks(p)
            if not blocks:
                continue
            content = [{"type": "text", "text": f"<file source='{src_dir.name}' name='{p.name}' ingested='{datetime.now().date()}'>"}] + blocks + \
                      [{"type": "text", "text": "</file>\nReturn the MacroNote object; set ingested_from to the file name and source to the folder name."}]
            try:
                note = parse_structured(SYSTEM, [{"role": "user", "content": content}], MacroNote, cache_key=f"inbox:{rel}")
            except Exception as e:  # noqa: BLE001
                print(f"[inbox] {rel}: {str(e)[:120]}")
                continue
            note.ingested_from = rel
            NOTES.parent.mkdir(parents=True, exist_ok=True)
            with open(NOTES, "a", encoding="utf-8") as f:
                f.write(note.model_dump_json() + "\n")
            n += 1
    print(f"[inbox] parsed {n} new files")
    return n


def load_notes() -> list[dict]:
    if not NOTES.exists():
        return []
    return [json.loads(line) for line in NOTES.read_text(encoding="utf-8").splitlines() if line.strip()]
