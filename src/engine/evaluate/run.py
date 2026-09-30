"""`engine evaluate SYM… [--thesis …]`: the evaluation program. Paul supplies the names (and, optionally, his thesis); the
engine places each name inside the full scored universe of the same date (same metrics, gates, angles, sector call, text
reads, Kelly), says where it would rank and whether sourcing would have chosen it, and — with the narrative layer — tests
Paul's thesis claim by claim against the filings and calls. Sourcing and evaluation share every function below; only the
question differs: "what should I look at?" vs "is my idea good, and how big?"."""
from __future__ import annotations

import glob
import json
import os
import re
from datetime import datetime
from pathlib import Path

import pandas as pd

from ..config import REPORTS_DIR, Hypotheses
from ..reports import render
from ..screen.models import IdeaCandidate
from ..screen.run import _render, build_candidates, last_trading_day, size_positions
from ..screen.scoring import score_universe, select_top
from ..screen.sectors import evaluate_sectors, sector_bets
from ..store import ledger as run_ledger


def parse_thesis(text_or_path: str | None) -> dict[str, str]:
    """Paul's thesis: a string (applies to every name) or a markdown file with `## SYM` sections (one per name)."""
    if not text_or_path:
        return {}
    p = Path(text_or_path)
    text = p.read_text(encoding="utf-8") if p.exists() and p.is_file() else text_or_path
    parts = re.split(r"^##\s+([A-Za-z0-9.\-]+)\s*$", text, flags=re.M)
    if len(parts) < 3:
        return {"*": text.strip()}
    out = {}
    if parts[0].strip():
        out["*"] = parts[0].strip()
    for i in range(1, len(parts) - 1, 2):
        out[parts[i].upper()] = parts[i + 1].strip()
    return out


def latest_universe(as_of: pd.Timestamp, region: str) -> tuple[list[IdeaCandidate], str | None]:
    """The most recent full-universe screen of this region for this date (candidates.json), else nothing."""
    runs = sorted(glob.glob(str(REPORTS_DIR / "ideas" / "*" / "candidates.json")), key=os.path.getmtime, reverse=True)
    for r in runs:
        if os.path.getsize(r) < 2_000_000:
            continue
        meta = Path(r).parent / "run.json"
        try:
            m = json.loads(meta.read_text())
        except Exception:  # noqa: BLE001
            continue
        if str(m.get("as_of")) != str(as_of.date()):
            continue
        cands = [IdeaCandidate.model_validate(x) for x in json.loads(Path(r).read_text())]
        cands = [c for c in cands if c.region == region]
        if cands:
            return cands, r
    return [], None


def placement(all_cands: list[IdeaCandidate], names: list[IdeaCandidate], top: int, max_sector: int | None, calls) -> dict[str, dict]:
    """Where each evaluated name stands inside the scored universe: rank, percentile of Idea Strength, would sourcing choose it."""
    ranked = sorted([c for c in all_cands if c.idea_strength is not None], key=lambda c: -(c.idea_strength or 0))
    pos = {c.security_id: i + 1 for i, c in enumerate(ranked)}
    chosen = {c.security_id for c in select_top(all_cands, top, max_sector, calls)}
    out = {}
    for c in names:
        r = pos.get(c.security_id)
        sector_peers = sorted([x for x in all_cands if x.theme_sector == c.theme_sector and x.idea_strength is not None], key=lambda x: -(x.idea_strength or 0))
        spos = next((i + 1 for i, x in enumerate(sector_peers) if x.security_id == c.security_id), None)
        why_not = list(c.excluded_by) + [f"{g.gate_id} {g.outcome}" for g in c.gates if g.outcome in ("veto", "avoid")]
        out[c.security_id] = {"rank": r, "of": len(ranked), "pct": (100.0 * (1 - (r - 1) / max(len(ranked), 1))) if r else None,
                              "sector_rank": spos, "sector_of": len(sector_peers), "would_be_chosen": c.security_id in chosen,
                              "eligible": c.eligible, "excluded_by": why_not or (["not in the sector-first top-N"] if not c.eligible else [])}
    return out


def run_evaluate(symbols: list[str], thesis: str | None = None, as_of=None, region: str = "US", narrate: bool = False, universe: str = "latest",
                 top: int = 20, out_dir=None, scenarios: dict | None = None) -> dict:
    """`scenarios` = Paul's own {SYM: {bull: {prob, return}, base: {...}, bear: {...}}} — used for Kelly instead of the engine's."""
    from . import ledger

    hyp = Hypotheses.load()
    as_of = last_trading_day(as_of)
    region = region.upper()
    symbols = [s.upper() for s in symbols]
    theses = parse_thesis(thesis)
    # 1. the universe of the date (context for percentiles, sector calls and "where would it rank")
    uni, src = latest_universe(as_of, region) if universe == "latest" else ([], None)
    if not uni:
        print(f"[evaluate] no full screen for {as_of.date()} → scoring the whole {region} universe (slow; run `engine ideas` first to reuse it)")
        uni = build_candidates(as_of, region, hyp)
        src = "fresh"
    # 2. the names, built fresh (so a name outside the cap floor or the universe still gets evaluated)
    names = build_candidates(as_of, region, hyp, symbols)
    missing = sorted(set(symbols) - {c.symbol for c in names})
    if missing:
        print(f"[evaluate] no data for {', '.join(missing)} (not in the security master or no filings visible at {as_of.date()})")
    if not names:
        return {}
    by_id = {c.security_id for c in names}
    all_cands = [c for c in uni if c.security_id not in by_id] + names
    for c in all_cands:
        c.reasons, c.gates, c.alerts, c.penalties, c.angles, c.excluded_by = [], [], [], [], [], []
    score_universe(all_cands, hyp, None)
    calls = evaluate_sectors(all_cands, as_of, hyp)
    max_sector = hyp.get("screen.max_per_sector")
    place = placement(all_cands, names, top, int(max_sector) if max_sector else None, calls)
    sizing = size_positions(names, as_of, hyp, scenarios)   # Kelly among the evaluated names (the book Paul is asking about)
    sector_bets(calls, all_cands, as_of, sizing)
    run_id = f"{as_of.date()}_{datetime.now().strftime('%H%M%S')}"
    out = out_dir or (REPORTS_DIR / "evaluate" / run_id)
    out.mkdir(parents=True, exist_ok=True)
    # 3. the idea pages (same template as sourcing: chart, reasons, gates, valuation, DCF, sector view, Kelly, narrative)
    _render(all_cands, names, as_of, out, hyp, hyp.get("screen.preset"), [region], top, narrate, [c.symbol for c in names], calls, sizing)
    # 4. the verdict page
    rows = []
    for c in names:
        t = theses.get(c.symbol) or theses.get("*")
        verdict_html, verdict = None, None
        if t and narrate:
            from ..research.stages import verdict_html as _vh

            verdict_html, verdict = _vh(c, t, None)
        scored = sorted([r for r in c.reasons if r.kind == "factor" and r.contribution is not None], key=lambda r: -abs(r.contribution))
        ent = ledger.entry(c.symbol, str(as_of.date()), run_id, c, place[c.security_id], calls.get(c.theme_sector), (sizing.get("weights") or {}).get(c.security_id), verdict, t)
        since = ledger.diff(ledger.previous(c.symbol), ent)
        rows.append({"c": c, "place": place[c.security_id], "thesis": t, "verdict_html": verdict_html, "verdict": verdict, "since": since, "ledger_entry": ent,
                     "kelly": (sizing.get("blocks") or {}).get(c.security_id), "weight": (sizing.get("weights") or {}).get(c.security_id),
                     "sector_call": calls.get(c.theme_sector), "angles": {a.key: a.score for a in c.angles},
                     "top_reasons": [{**r.model_dump(), "value_fmt": render.fmt_value(r.value, r.unit)} for r in scored[:5]],
                     "against": [{**r.model_dump(), "value_fmt": render.fmt_value(r.value, r.unit)} for r in scored if r.contribution < 0][:4],
                     "gates": [{"gate_id": g.gate_id, "gate": g.gate_id, "outcome": g.outcome, "evidence": g.evidence} for g in c.gates if g.outcome != "pass"],
                     "alerts": [a.message for a in c.alerts]})
    ledger.append([r["ledger_entry"] for r in rows])
    from ..screen.rules import rules

    angle_labels = {k: v["label"] for k, v in rules()["angles"].items()}
    html = render.env().get_template("evaluate.html.j2").render(
        title=f"Evaluate {' '.join(symbols)}", as_of=as_of.date(), rows=rows, n_scored=len(all_cands), universe_src=src, top=top,
        sector_calls=sorted(calls.values(), key=lambda x: -(x.score or 0)), sizing=sizing, angle_labels=angle_labels, macro=render.macro_strip(as_of),
        narrate=narrate, decisions=hyp.decisions_touched(), generated=render.now(), assets="../../assets/")
    render.write(out / "index.html", html)
    (out / "evaluation.json").write_text(json.dumps({"as_of": str(as_of.date()), "symbols": symbols, "universe_src": src, "thesis": theses,
                                                     "placement": place, "sizing": {"weights": sizing.get("weights"), "cash": sizing.get("cash"), "rf": sizing.get("rf")},
                                                     "verdicts": {r["c"].symbol: r["verdict"] for r in rows if r["verdict"]},
                                                     "sector_calls": {k: v.model_dump(mode="json") for k, v in calls.items() if k in {c.theme_sector for c in names}}},
                                                    indent=1, default=str))
    (out / "run.json").write_text(json.dumps({"as_of": str(as_of.date()), "title": f"Evaluate {' '.join(symbols)}", "entry": "index.html"}))
    con = run_ledger()
    con.execute("INSERT OR REPLACE INTO runs VALUES (?,?,?,?,?,?)", [run_id, "evaluate", as_of.date(), datetime.now(), json.dumps({"symbols": symbols}), str(out)])
    con.close()
    render.update_index()
    print(f"[evaluate] {len(names)} names placed in a universe of {len(all_cands)} ({src}) → {out / 'index.html'}")
    for r in rows:
        c, p = r["c"], r["place"]
        sc = r["sector_call"]
        print(f"  {c.symbol:<6} strength {c.idea_strength if c.idea_strength is not None else float('nan'):5.1f}  {c.action:<14} rank {p['rank']}/{p['of']}"
              f"  sector {c.theme_sector} ({sc.stance if sc else '–'}, #{p['sector_rank']}/{p['sector_of']})  would-be-chosen {'yes' if p['would_be_chosen'] else 'no'}"
              f"  kelly {((r['weight'] or 0)*100):4.1f}%" + (f"  verdict {r['verdict']['overall']}" if r["verdict"] else ""))
        if sc and sc.bet:
            print(f"         sector bet: {sc.bet['summary'][:150]}")
    return {"run_id": run_id, "path": out, "rows": rows, "placement": place, "sizing": sizing, "sector_calls": calls}
