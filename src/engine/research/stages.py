"""Research stages: three structured calls over one shared (cached) context — ThesisRecord v0; MoatLite + LensVerdicts;
Checkpoints + the tension (one call with the whole bundle exceeds the structured-output grammar limit);
verification marks unverified claims; HTML rendering for the idea page."""
from __future__ import annotations

import copy
import html

from ..screen.models import IdeaCandidate
from .context import SYSTEM, build_context, financial_read
from .llm import NarrativeUnavailable, parse_structured
from .schemas import CheckpointSet, MoatAndLenses, ResearchBundle, ThesisRecordV0
from .verify import doc_ids, mark_free_text, verify_claim

PREAMBLE = "Using only the documents above, for {symbol} as of {as_of}. Cite every number as (period, source).\n"
STAGES = {
    "thesis": (ThesisRecordV0, "Produce the ThesisRecordV0: the three questions, main character (is it the indispensable #1?), drivers "
               "(price × quantity), why_bought in one line, break conditions, edge statement, horizon (years), confidence, "
               "role/asset_type/ai_layer proposals, weaknesses (the bear case, honestly)."),
    "moat_lenses": (MoatAndLenses, "Produce MoatAndLenses: the toll-booth scorecard (F-01/F-02/F-03) and the Buffett / Danoff / "
                    "Tillinghast / Lynch verdicts with reasons and cited claims; list split items."),
    "checkpoints": (CheckpointSet, "Produce CheckpointSet: 3–6 dated 点検材料 premises with KPI and source; thresholds TBD(Paul) "
                    "unless stated in the philosophy; propose suggested_bull/suggested_bear separately; the_tension = the one "
                    "question that decides the idea."),
}


def _stage(msgs: list[dict], c: IdeaCandidate, name: str):
    schema, instr = STAGES[name]
    m = copy.deepcopy(msgs)
    m[0]["content"].append({"type": "text", "text": PREAMBLE.format(symbol=c.symbol, as_of=c.as_of) + instr})
    return parse_structured(SYSTEM, m, schema, cache_key=f"research:{c.symbol}:{c.as_of}:{name}")


def research_bundle(c: IdeaCandidate, phases: list[dict] | None = None) -> ResearchBundle:
    msgs = build_context(c, phases)
    last = msgs[0]["content"][-1]
    if isinstance(last, dict) and last.get("type") == "text":
        last["cache_control"] = {"type": "ephemeral"}   # the context is shared by the three stage calls
    thesis = _stage(msgs, c, "thesis")
    ml = _stage(msgs, c, "moat_lenses")
    cp = _stage(msgs, c, "checkpoints")
    b = ResearchBundle(thesis=thesis, moat=ml.moat, lenses=ml.lenses, checkpoints=cp.checkpoints, the_tension=cp.the_tension)
    ids = doc_ids(msgs)
    fr = financial_read(c)
    unv = 0
    for cl in b.thesis.q_evidence:
        verify_claim(cl, ids, fr)
        unv += 0 if cl.verified else 1
    for lens in (b.lenses.buffett, b.lenses.danoff, b.lenses.tillinghast, b.lenses.lynch):
        for cl in lens.claims:
            verify_claim(cl, ids, fr)
            unv += 0 if cl.verified else 1
        lens.reason, k = mark_free_text(lens.reason)
        unv += k
    for cl in b.moat.pricing_evidence:
        verify_claim(cl, ids, fr)
        unv += 0 if cl.verified else 1
    b.thesis.story_one_line, k = mark_free_text(b.thesis.story_one_line)
    unv += k
    b.thesis.q_story, k = mark_free_text(b.thesis.q_story)
    unv += k
    b.thesis.why_bought, k = mark_free_text(b.thesis.why_bought)
    unv += k
    b.thesis.unverified_count = unv
    return b


def narrative_html(c: IdeaCandidate, snap=None, phases: list[dict] | None = None) -> str | None:
    try:
        b = research_bundle(c, phases)
    except NarrativeUnavailable as e:
        return f'<div class="muted">Narrative not generated ({html.escape(str(e))}).</div>'
    except Exception as e:  # noqa: BLE001
        return f'<div class="muted">Narrative failed: {html.escape(str(e)[:160])}</div>'
    t = b.thesis
    e = html.escape

    def li(items):
        return "".join(f"<li>{e(str(x))}</li>" for x in items)

    def claims(cs):
        return "".join(f"<li>{e(cl.text)} <span class='muted small'>({e(cl.period)}, {e(cl.source)}){'' if cl.verified else ' ⚠'}</span></li>" for cl in cs)

    parts = [
        f"<p><b>Story:</b> {e(t.story_one_line)} <span class='badge'>{e(t.confidence_label)} confidence</span> <span class='badge'>{e(t.role)}</span> <span class='badge'>{e(t.ai_layer)}</span> <span class='badge alert'>{t.unverified_count} unverified</span></p>",
        f"<p><b>Q1 この会社の投資ストーリーは何か:</b> {e(t.q_story)}</p>",
        f"<p><b>Q2 そのストーリーを信じる根拠は何か:</b></p><ul>{claims(t.q_evidence)}</ul>",
        f"<p><b>Q3 そのストーリーはいつ崩れるか:</b></p><ul>{li(t.q_breaks_when)}</ul>",
        f"<p><b>主役企業?</b> {'Yes' if t.main_character.is_number_one else 'No'} — {e(t.main_character.rationale)} (rivals: {e(', '.join(t.main_character.rivals))})</p>",
        f"<p><b>Drivers (F-107):</b> {e('; '.join(t.drivers))} · <b>Why bought:</b> {e(t.why_bought)} · <b>Edge:</b> {e(t.edge_statement)} · <b>Horizon:</b> {t.horizon_years}y{' ⚠ <5y (R-10)' if t.horizon_years < 5 else ''}</p>",
        f"<p><b>Weaknesses / bear case:</b></p><ul>{li(t.weaknesses)}</ul>",
        f"<h3>Toll booth (F-01)</h3><p>chokepoints: {e(', '.join(b.moat.chokepoint_assets))} · replaceability <b>{e(b.moat.replaceability)}</b> · moat {e(b.moat.moat_kind)} · data {e(b.moat.data_position)} — {e(b.moat.verdict)}</p><ul>{claims(b.moat.pricing_evidence)}</ul>",
        "<h3>Four lenses (F-114)</h3><table><thead><tr><th>Lens</th><th>Verdict</th><th>Reason</th></tr></thead><tbody>"
        + "".join(f"<tr><td>{n}</td><td><span class='badge {'gate' if v.verdict != 'pass' else ''}'>{v.verdict}</span></td><td class='small'>{e(v.reason)}</td></tr>"
                  for n, v in (("Buffett", b.lenses.buffett), ("Danoff", b.lenses.danoff), ("Tillinghast", b.lenses.tillinghast), ("Lynch", b.lenses.lynch)))
        + "</tbody></table>" + (f"<p class='small'>Split items: {e('; '.join(b.lenses.split_items))}</p>" if b.lenses.split_items else ""),
        "<h3>点検材料 (checkpoints)</h3><table><thead><tr><th>Premise</th><th>KPI</th><th>Source</th><th>Next</th><th>Bull</th><th>Bear</th></tr></thead><tbody>"
        + "".join(f"<tr><td>{e(cp.premise)}</td><td>{e(cp.kpi)}</td><td class='small'>{e(cp.source)}</td><td>{cp.next_date or '–'}</td>"
                  f"<td>{e(cp.bull_threshold)}{(' <span class=small muted>(suggested: ' + e(cp.suggested_bull) + ')</span>') if cp.suggested_bull else ''}</td>"
                  f"<td>{e(cp.bear_threshold)}{(' <span class=small muted>(suggested: ' + e(cp.suggested_bear) + ')</span>') if cp.suggested_bear else ''}</td></tr>" for cp in b.checkpoints)
        + "</tbody></table>",
        f"<p><b>The tension:</b> {e(b.the_tension)}</p>",
        "<p class='small muted'>Draft by the research agent from filings and transcripts in context; ⚠ = claim not traceable to a document in context. Needs Paul's judgment (R-09, INV-2).</p>",
    ]
    return "\n".join(parts)
