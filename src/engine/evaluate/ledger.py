"""The thesis ledger: one row per name per evaluation (data/evaluations.jsonl) so the next evaluation can say what changed —
rank, stance, action, Kelly size, and each thesis claim's status. Appended, never rewritten."""
from __future__ import annotations

import json
from datetime import datetime

from ..config import DATA_DIR

PATH = DATA_DIR / "evaluations.jsonl"


def history(symbol: str | None = None, limit: int = 200) -> list[dict]:
    if not PATH.exists():
        return []
    rows = [json.loads(line) for line in PATH.read_text(encoding="utf-8").splitlines() if line.strip()]
    if symbol:
        rows = [r for r in rows if r.get("symbol") == symbol.upper()]
    return rows[-limit:]


def previous(symbol: str) -> dict | None:
    h = history(symbol)
    return h[-1] if h else None


def append(rows: list[dict]) -> None:
    PATH.parent.mkdir(parents=True, exist_ok=True)
    with PATH.open("a", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps({"ts": datetime.now().isoformat(timespec="seconds"), **r}, default=str) + "\n")


def entry(symbol: str, as_of: str, run_id: str, c, place: dict, sector_call, weight: float | None, verdict: dict | None, thesis: str | None) -> dict:
    return {"symbol": symbol, "as_of": as_of, "run_id": run_id, "strength": c.idea_strength, "action": c.action, "rank": place.get("rank"), "of": place.get("of"),
            "sector": c.theme_sector, "stance": (sector_call.stance if sector_call else None), "bet_pp": ((sector_call.bet or {}).get("active_bet_pp") if sector_call else None),
            "kelly_weight": weight, "would_be_chosen": place.get("would_be_chosen"), "thesis": thesis,
            "verdict": (verdict or {}).get("overall"), "claims": {cl["claim"]: cl["status"] for cl in (verdict or {}).get("claims", [])}}


def diff(prev: dict | None, cur: dict) -> dict | None:
    """What changed since the previous evaluation of this name (None when there is none)."""
    if not prev:
        return None
    out = {"prev_ts": prev.get("ts"), "prev_as_of": prev.get("as_of"), "changes": []}

    def ch(label, a, b, fmt=lambda x: x):
        if a != b and not (a is None and b is None):
            out["changes"].append(f"{label}: {fmt(a)} → {fmt(b)}")
    ch("Idea Strength", prev.get("strength"), cur.get("strength"), lambda x: f"{x:.0f}" if isinstance(x, (int, float)) else "–")
    ch("rank", prev.get("rank"), cur.get("rank"))
    ch("action", prev.get("action"), cur.get("action"))
    ch("sector stance", prev.get("stance"), cur.get("stance"))
    ch("Kelly weight", prev.get("kelly_weight"), cur.get("kelly_weight"), lambda x: f"{x*100:.1f}%" if isinstance(x, (int, float)) else "–")
    ch("would sourcing choose it", prev.get("would_be_chosen"), cur.get("would_be_chosen"))
    ch("verdict", prev.get("verdict"), cur.get("verdict"))
    pc, cc = prev.get("claims") or {}, cur.get("claims") or {}
    for claim, st in cc.items():
        if claim in pc and pc[claim] != st:
            out["changes"].append(f"claim '{claim[:60]}': {pc[claim]} → {st}")
        elif claim not in pc:
            out["changes"].append(f"new claim '{claim[:60]}': {st}")
    for claim in pc:
        if claim not in cc:
            out["changes"].append(f"claim dropped: '{claim[:60]}'")
    return out
