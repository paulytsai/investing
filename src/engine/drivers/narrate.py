"""Optional LLM explanation per price phase, citing only the attached events and documents."""
from __future__ import annotations

import json

from ..research.llm import NarrativeUnavailable, parse_structured
from ..research.schemas import PhaseExplanations
from ..research.verify import mark_free_text

SYSTEM = ("You explain past price phases of a stock for Paul Tsai's engine (F-105: explain every rise and fall; F-12: EPS change vs multiple change). "
          "Use only the phase table and attached events given. For each phase write ≤120 words: what drove it, citing the event texts; classify the driver; "
          "for down-phases say temporary vs structural and demand_death vs position_clearing when the evidence allows, else 'na'. Do not invent numbers or events.")


def narrate_phases(symbol: str, security_id: str, phases: list[dict]) -> dict[int, dict] | None:
    slim = [{k: p.get(k) for k in ("idx", "start", "end", "ret_pct", "label", "f_eps", "f_mult", "eps0", "eps1", "bench_ret_pct", "events", "max_dd_within")} for p in phases[-12:]]
    msgs = [{"role": "user", "content": [{"type": "text", "text": f'<doc id="PricePhases {symbol}" period="history" source="engine">\n{json.dumps(slim, default=str)}\n</doc>\n'
                                                                  f"Return PhaseExplanations for these {len(slim)} phases of {symbol}."}]}]
    try:
        out: PhaseExplanations = parse_structured(SYSTEM, msgs, PhaseExplanations, cache_key=f"phases:{symbol}:{slim[-1]['end'] if slim else ''}")
    except NarrativeUnavailable as e:
        print(f"[drivers] narration skipped: {e}")
        return None
    res = {}
    for pe in out.phases:
        text, n = mark_free_text(pe.explanation)
        res[pe.phase_idx] = {"explanation": text, "cited_sources": pe.cited_sources, "cited_events": pe.cited_events, "driver": pe.driver_label_llm,
                             "shock_type": pe.shock_type, "shock_kind": pe.shock_kind, "unverified": n}
    return res
