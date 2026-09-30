"""What changed between two full screens (the "since last run" strip): names entering and leaving the chosen book, action
changes, sector stance flips and cycle-phase changes, and the biggest Idea Strength moves. Reads the run folders only."""
from __future__ import annotations

import glob
import json
import os
from pathlib import Path

from ..config import REPORTS_DIR


def full_runs(region: str = "US", min_scored: int = 200) -> list[Path]:
    """Full-universe ideas runs, oldest → newest (one per as_of date: the latest run of each date)."""
    out: dict[str, Path] = {}
    for r in sorted(glob.glob(str(REPORTS_DIR / "ideas" / "*" / "run.json")), key=os.path.getmtime):
        try:
            m = json.loads(Path(r).read_text())
        except Exception:  # noqa: BLE001
            continue
        if int(m.get("n_scored") or 0) >= min_scored and (Path(r).parent / "sizing.json").exists():
            out[str(m.get("as_of"))] = Path(r).parent
    return [out[k] for k in sorted(out)]


def _load(run: Path) -> dict:
    cands = json.loads((run / "candidates.json").read_text())
    sizing = json.loads((run / "sizing.json").read_text()) if (run / "sizing.json").exists() else {}
    sectors = json.loads((run / "sectors.json").read_text()) if (run / "sectors.json").exists() else {}
    chosen = set((sizing.get("weights") or {}).keys())
    by = {c["security_id"]: c for c in cands}
    return {"as_of": json.loads((run / "run.json").read_text()).get("as_of"), "by": by, "chosen": chosen, "sectors": sectors, "weights": sizing.get("weights") or {}}


def diff_runs(prev: Path, cur: Path) -> dict:
    a, b = _load(prev), _load(cur)
    sym = lambda d, sid: (d["by"].get(sid) or {}).get("symbol", sid)  # noqa: E731
    entered = [sym(b, s) for s in sorted(b["chosen"] - a["chosen"], key=lambda s: -(b["by"].get(s, {}).get("idea_strength") or 0))]
    left = [sym(a, s) for s in sorted(a["chosen"] - b["chosen"], key=lambda s: -(a["by"].get(s, {}).get("idea_strength") or 0))]
    actions = []
    for s in b["chosen"] | a["chosen"]:
        pa, pb = (a["by"].get(s) or {}).get("action"), (b["by"].get(s) or {}).get("action")
        if pa and pb and pa != pb:
            actions.append(f"{sym(b, s)}: {pa} → {pb}")
    stances, cycles = [], []
    for k, v in b["sectors"].items():
        u = a["sectors"].get(k) or {}
        if u.get("stance") and u["stance"] != v.get("stance"):
            stances.append(f"{v.get('label', k).split(' — ')[0]}: {u['stance']} → {v['stance']}")
        pc, cc = ((u.get("bet") or {}).get("cycle") or {}).get("phase"), ((v.get("bet") or {}).get("cycle") or {}).get("phase")
        if pc and cc and pc != cc:
            cycles.append(f"{v.get('label', k).split(' — ')[0]}: {pc} → {cc}")
    moves = []
    for s, c in b["by"].items():
        p = a["by"].get(s)
        if p and c.get("idea_strength") is not None and p.get("idea_strength") is not None and (s in b["chosen"] or s in a["chosen"] or (c.get("rank") or 999) <= 40):
            moves.append((c["idea_strength"] - p["idea_strength"], c["symbol"], p["idea_strength"], c["idea_strength"]))
    moves.sort(key=lambda t: -abs(t[0]))
    kelly = []
    for s in b["chosen"]:
        wa, wb = a["weights"].get(s), b["weights"].get(s)
        if wa is not None and wb is not None and abs(wa - wb) >= 0.03:
            kelly.append(f"{sym(b, s)}: {wa*100:.0f}% → {wb*100:.0f}%")
    return {"prev_as_of": a["as_of"], "cur_as_of": b["as_of"], "entered": entered, "left": left, "actions": sorted(actions), "stances": stances, "cycles": cycles,
            "moves": [f"{t[1]} {t[2]:.0f} → {t[3]:.0f}" for t in moves[:6]], "kelly": kelly,
            "unchanged": not (entered or left or actions or stances or cycles)}


def latest_diff(region: str = "US") -> dict | None:
    runs = full_runs(region)
    if len(runs) < 2:
        return None
    return diff_runs(runs[-2], runs[-1])
