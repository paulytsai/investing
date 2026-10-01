"""The pitch: the case for a sector call and for each stock, written as a presenter would make it to Paul — a story
that tries to convince, with the statistics behind it as back-up. Claude writes it from the engine's own numbers,
the filings and the transcript (the same context as the thesis record, plus the story, the valuation cycle and the
implied-growth record); every figure must trace back to that context (§8.7). Without a key or budget, a deterministic
pitch assembled from the same records takes its place, so the report always reads as prose."""
from __future__ import annotations

import copy
import json
import re

from ..frameworks.implied_growth import plain_sentence
from ..reports.plain import STANCE, plain_sector_line, summary_parts, why_cheap
from .context import SYSTEM, _doc, build_context, financial_read
from .llm import NarrativeUnavailable, parse_structured
from .schemas import SectorPitch, StockPitch
from .verify import NUM_RE, doc_ids, verify_claim

PITCH_RULES = """Write as a portfolio manager presenting one idea to a single investor (Paul) and trying to convince him — a story, in
plain English, in full sentences and paragraphs. No rule ids, no factor names, no bullet points inside a field, no headings. Use the
company's own words from the transcript where they carry the story. Every number you use must come from the documents above (quote
it as it appears; never do arithmetic) and must be listed in numbers_used with its period and source (a <doc id> or FinancialRead.<key>).
Keep the whole pitch under 450 words. The investor already knows the industry; do not explain basics. Be honest about the weak
points — the pitch is only credible if the bear case is real."""

STOCK_INSTR = """Produce the StockPitch for {symbol} as of {as_of}.
opening: two sentences — the one idea and why now. the_business: what it sells, why customers cannot do without it, whether it is the
indispensable number one. why_now: what changed in the numbers, the demand, the last price move and what management said.
valuation_in_cycle: where the multiple sits in the company's own history (use the ValuationCycle document) and the most likely reason
it is there (use the WhyCheap document). what_the_price_assumes: state the implied growth figure from the ImpliedGrowth document
exactly, against the growth the company has delivered, and say whether the price asks for more or less than it has shown; for a company
without earnings say plainly whether its growth is rapid enough to justify a price on no earnings. three_reasons: exactly three
sentences in this order — the strongest reason, the weakest of the three, the second-strongest. what_breaks_it: the honest bear case
and the sign that would end the thesis. closing: the ask — what the engine proposes (use the Action document), how big (the Kelly
weight if given) and the one thing to watch."""

SECTOR_INSTR = """Produce the SectorPitch for the {label} sector as of {as_of}.
where_we_are: where the sector is in its cycle (use the SectorCall, CycleRead and Breadth documents) and how the stocks have moved
over the window. the_case: why the engine's stance is {stance} — the numbers that argue for it and the ones that argue against.
the_bet: the recommended weight against market weight in plain terms, and what it means for the barbell (oil at one end, AI at the
other) if this sector is part of it. names: one sentence on each chosen name and why it carries the sector (use the Members document).
what_would_change_the_call: the sign that would flip the stance."""


def _num_tokens(text: str) -> set[str]:
    toks = set()
    for m in NUM_RE.finditer(text or ""):
        t = m.group(0).strip().rstrip(".").lstrip("$€¥")
        t = re.sub(r"[,\s]", "", t)
        t = re.sub(r"(%|x|bn|B|M|T|億|兆|pp|bp)$", "", t)
        if t and not re.match(r"^(19|20)\d{2}$", t):
            toks.add(t)
    return toks


def _context_numbers(messages: list[dict]) -> set[str]:
    nums = set()
    for m in messages:
        blocks = m.get("content") if isinstance(m.get("content"), list) else [{"type": "text", "text": m.get("content", "")}]
        for b in blocks:
            if b.get("type") == "text":
                nums |= _num_tokens(b["text"])
    return nums


def _close(tok: str, pool: set[str]) -> bool:
    """A prose figure is traceable if it appears in the context verbatim or rounds to a figure that does (1 pp / 1%)."""
    if tok in pool:
        return True
    try:
        v = float(tok)
    except ValueError:
        return False
    for p in pool:
        try:
            w = float(p)
        except ValueError:
            continue
        if abs(v - w) <= max(0.6, 0.01 * abs(w)) or (w != 0 and abs(v - w * 100) <= 0.6) or (v != 0 and abs(v * 100 - w) <= 0.6):
            return True
    return False


def _check_prose(pitch, fields: list[str], messages: list[dict], fr: dict) -> int:
    """Count prose figures that trace to nothing in the context; verify numbers_used claims. Prose is left untouched."""
    ids = doc_ids(messages)
    pool = _context_numbers(messages)
    for cl in pitch.numbers_used:
        verify_claim(cl, ids, fr)
        if cl.verified and cl.value is not None:
            pool.add(str(cl.value).rstrip("0").rstrip("."))
    misses = 0
    for f in fields:
        v = getattr(pitch, f)
        texts = v if isinstance(v, list) else [v]
        for t in texts:
            for tok in _num_tokens(t):
                if not _close(tok, pool):
                    misses += 1
    pitch.unverified_count = misses
    return misses


def _extra_docs(c, story, sector_call, kelly_weight, phases) -> list[str]:
    m = c.metrics
    docs = []
    if story:
        docs.append(_doc(f"Story {c.symbol}", str(c.as_of), "engine (filings, FMP profile, transcripts)",
                         json.dumps({k: story.get(k) for k in ("what", "earnings", "earnings_rows", "driving", "quality", "risks", "pay")}, default=str), 7000))
        if story.get("danoff"):
            docs.append(_doc(f"Danoff {c.symbol}", str(c.as_of), "engine", json.dumps({k: story["danoff"].get(k) for k in ("verdict", "score", "lines", "years_to_double")}, default=str), 2000))
    vc = m.get("valuation_cycle") or {}
    docs.append(_doc(f"ValuationCycle {c.symbol}", str(c.as_of), "engine (FMP prices, point-in-time EPS)", json.dumps(vc, default=str), 1500))
    ig = m.get("implied_growth") or {}
    docs.append(_doc(f"ImpliedGrowth {c.symbol}", str(c.as_of), "engine (F-16)", json.dumps({**ig, "sentence": plain_sentence(ig)}, default=str), 2000))
    wc = why_cheap(c, sector_call, phases)
    docs.append(_doc(f"WhyCheap {c.symbol}", str(c.as_of), "engine", json.dumps(wc, default=str), 2000))
    sp = summary_parts(c, sector_call, kelly_weight)
    docs.append(_doc(f"Action {c.symbol}", str(c.as_of), "engine", json.dumps({"action": c.action, "reason": c.action_reason, "verdict": sp["verdict"],
                     "kelly_weight_pct": round(kelly_weight * 100, 1) if kelly_weight else None, "engine_summary": sp["thesis"], "engine_reasons": sp["reasons"]}, default=str), 2500))
    if sector_call is not None:
        sc = sector_call if isinstance(sector_call, dict) else sector_call.model_dump()
        docs.append(_doc(f"SectorCall {sc.get('label')}", str(c.as_of), "engine", json.dumps({"stance": sc.get("stance"), "bet": (sc.get("bet") or {}).get("summary"),
                         "rationale": [plain_sector_line(x) for x in sc.get("rationale", [])[:6]], "cycle_read": (sc.get("cycle_read") or {}).get("verdict")}, default=str), 2500))
    return docs


def stock_pitch(c, story=None, sector_call=None, kelly_weight=None, phases=None, *, use_llm: bool = True) -> dict:
    """The pitch for one stock → dict of the StockPitch fields plus source ('claude' | 'engine'), unverified_count, numbers."""
    if use_llm:
        try:
            msgs = build_context(c, phases)
            m = copy.deepcopy(msgs)
            m[0]["content"][0]["text"] += "\n\n" + "\n\n".join(_extra_docs(c, story, sector_call, kelly_weight, phases))
            m[0]["content"].append({"type": "text", "text": PITCH_RULES + "\n\n" + STOCK_INSTR.format(symbol=c.symbol, as_of=c.as_of)})
            p = parse_structured(SYSTEM, m, StockPitch, cache_key=f"pitch:{c.symbol}:{c.as_of}", max_tokens=6000)
            _check_prose(p, ["opening", "the_business", "why_now", "valuation_in_cycle", "what_the_price_assumes", "three_reasons", "what_breaks_it", "closing"], m, financial_read(c))
            d = p.model_dump(mode="json")
            d["source"] = "claude"
            return d
        except NarrativeUnavailable as e:
            note = str(e)
        except Exception as e:  # noqa: BLE001 — the page must still render
            note = f"pitch failed: {str(e)[:120]}"
    else:
        note = "narrative layer off"
    d = deterministic_stock_pitch(c, story, sector_call, kelly_weight, phases)
    d["note"] = note
    return d


def deterministic_stock_pitch(c, story=None, sector_call=None, kelly_weight=None, phases=None) -> dict:
    """The same eight sections assembled from the engine's own prose builders — no model call."""
    m = c.metrics if not isinstance(c, dict) else c.get("metrics", {})
    sym = c.symbol if not isinstance(c, dict) else c["symbol"]
    sp = summary_parts(c, sector_call, kelly_weight)
    story = story or {}
    vc = m.get("valuation_cycle") or {}
    wc = why_cheap(c, sector_call, phases)
    ig = plain_sentence(m.get("implied_growth"))
    opening = sp["thesis"]
    business = story.get("what") or f"{sym} is filed by the engine under {getattr(c, 'theme_sector', None) or c.get('theme_sector')}."
    driving = story.get("driving") or []
    reading = next((d.split(": ", 1)[1] for d in driving if d.startswith("Claude's reading")), None)
    quotes = [d for d in driving if not d.startswith("Claude's reading")][:2]
    why_now = " ".join(x for x in [story.get("earnings"), (f"The latest call, in short: {reading}" if reading else None),
                                   ("In management's words: " + " ".join(quotes)) if quotes else None] if x)
    val = " ".join(x for x in [vc.get("sentence"), wc.get("sentence")] if x) or "No usable valuation history."
    assumes = ig or "The price cannot be tied to a growth rate from the data visible today."
    risks = [r.strip().rstrip(".") for r in story.get("risks", [])[:3] if r and r.strip()]
    breaks = (". ".join(r[0].upper() + r[1:] for r in risks) + ".") if risks else "No specific break condition shows in the filings; the general one is a thesis that stops showing up in the numbers."
    closing = " ".join(sp.get("recap_parts", [sp["recap"]])[:4])    # bottom line, main risk, price, sector — the rest is said above
    return {"opening": opening, "the_business": business, "why_now": why_now or "Nothing in the recent numbers changes the picture.", "valuation_in_cycle": val,
            "what_the_price_assumes": assumes, "three_reasons": sp["reasons"][:3] + [""] * max(0, 3 - len(sp["reasons"])), "what_breaks_it": breaks,
            "closing": closing, "numbers_used": [], "unverified_count": 0, "source": "engine"}


def _bet_doc(bet: dict) -> dict:
    out = {k: v for k, v in bet.items() if k not in ("market_weight", "recommended_weight", "kelly_implied_weight", "active_bet_pp")}
    for k in ("market_weight", "recommended_weight", "kelly_implied_weight"):
        if bet.get(k) is not None:
            out[k] = f"{bet[k]*100:.1f}% of the book"
    if bet.get("active_bet_pp") is not None:
        out["active_bet"] = f"{bet['active_bet_pp']:+.1f} percentage points vs market weight"
    return out


def _member_doc_row(r: dict) -> dict:
    """A member row as the presenter should quote it: whole-number strength, percent returns, one-decimal P/E, percent weights."""
    return {"symbol": r.get("symbol"), "name": r.get("name"), "strength": (f"{r['strength']:.0f} of 100" if r.get("strength") is not None else None), "call": r.get("action"),
            "return_over_window": (f"{r['ret_window']*100:+.0f}%" if r.get("ret_window") is not None else None),
            "pe": (f"{r['pe']:.1f}x" if r.get("pe") else "no earnings"), "pe_own_history_percentile": (f"{r['pe_pctile']:.0f}th" if r.get("pe_pctile") is not None else None),
            "valuation_cycle": r.get("cycle_phase"), "weight_in_book": (f"{r['weight']*100:.1f}%" if r.get("weight") else None), "eligible": r.get("eligible")}


def sector_pitch(sc, rows: list[dict], chosen: list[str], as_of, *, window_text: str = "", barbell: str = "", use_llm: bool = True) -> dict:
    """The pitch for one sector call. rows: member_table rows (symbol, strength, action, ret_window, pe_pctile, cycle_phase, weight)."""
    s = sc if isinstance(sc, dict) else sc.model_dump()
    if use_llm:
        try:
            docs = [_doc(f"SectorCall {s['label']}", str(as_of), "engine", json.dumps({k: s.get(k) for k in ("label", "stance", "score", "n_members", "n_eligible", "slots", "inputs")}, default=str), 4000),
                    _doc(f"Rationale {s['label']}", str(as_of), "engine", "\n".join(plain_sector_line(x) for x in s.get("rationale", [])), 3000),
                    _doc(f"Bet {s['label']}", str(as_of), "engine", json.dumps(_bet_doc(s.get("bet") or {}), default=str), 2500)]
            if s.get("cycle_read"):
                docs.append(_doc(f"CycleRead {s['label']}", str(as_of), "engine (commodity cycle, D-04)", json.dumps(s["cycle_read"], default=str), 3000))
            if (s.get("bet") or {}).get("cycle"):
                docs.append(_doc(f"Breadth {s['label']}", str(as_of), "engine (transcript theme breadth)", json.dumps(s["bet"]["cycle"], default=str), 1500))
            if s.get("danoff"):
                docs.append(_doc(f"Danoff {s['label']}", str(as_of), "engine", json.dumps(s["danoff"], default=str), 2000))
            docs.append(_doc(f"Members {s['label']}", str(as_of), "engine", json.dumps({"chosen": chosen, "window": window_text,
                             "members": [_member_doc_row(r) for r in rows[:40]]}, default=str), 9000))
            if barbell:
                docs.append(_doc("Barbell", str(as_of), "Paul", barbell, 800))
            msgs = [{"role": "user", "content": [{"type": "text", "text": "\n\n".join(docs)},
                                                 {"type": "text", "text": PITCH_RULES + "\n\n" + SECTOR_INSTR.format(label=s["label"], as_of=as_of, stance=STANCE.get(s["stance"], s["stance"]))}]}]
            p = parse_structured(SYSTEM, msgs, SectorPitch, cache_key=f"pitch:sector:{s['sector']}:{as_of}", max_tokens=5000)
            _check_prose(p, ["where_we_are", "the_case", "the_bet", "names", "what_would_change_the_call"], msgs, {})
            d = p.model_dump(mode="json")
            d["source"] = "claude"
            return d
        except NarrativeUnavailable as e:
            note = str(e)
        except Exception as e:  # noqa: BLE001
            note = f"pitch failed: {str(e)[:120]}"
    else:
        note = "narrative layer off"
    d = deterministic_sector_pitch(s, rows, chosen, window_text)
    d["note"] = note
    return d


def deterministic_sector_pitch(s: dict, rows: list[dict], chosen: list[str], window_text: str = "") -> dict:
    stance_words = STANCE.get(s.get("stance"), s.get("stance"))
    stance = stance_words[0].lower() + stance_words[1:] if stance_words else s.get("stance")
    bet = s.get("bet") or {}
    cyc = bet.get("cycle") or {}
    cr = s.get("cycle_read") or {}
    where = []
    if cr.get("verdict"):
        where.append(cr["verdict"])
    if cyc.get("phase"):
        where.append(f"The theme shows up in {cyc.get('breadth_now', 0):.0f}% of earnings calls against a peak of {cyc.get('breadth_peak', 0):.0f}%, which the engine reads as {cyc['phase']}.")
    rets = [r["ret_window"] for r in rows if r.get("ret_window") is not None]
    if rets:
        import statistics
        where.append(f"Over {window_text or 'the window'} the typical member is {'up' if statistics.median(rets) >= 0 else 'down'} {abs(statistics.median(rets))*100:.0f}%, "
                     f"with {sum(1 for r in rets if r > 0)} of {len(rets)} names higher.")
    lines = [plain_sector_line(x) for x in s.get("rationale", [])[:5]]
    case = f"The engine's stance is {stance}. " + " ".join(lines)
    if bet.get("recommended_weight") is not None:
        pp = bet.get("active_bet_pp") or 0.0
        the_bet = (f"The engine would put {bet['recommended_weight']*100:.1f}% of the book here against a market weight of {bet['market_weight']*100:.1f}%"
                   + (f" — an active bet of {pp:+.1f} points." if abs(pp) >= 0.05 else " — no active bet either way."))
        if bet.get("kelly_implied_weight"):
            the_bet += f" The chosen names' Kelly sizes alone would put {bet['kelly_implied_weight']*100:.0f}% here."
    else:
        the_bet = "No bet computed."
    names = " ".join(f"{r['symbol']} carries it with a strength of {r['strength']:.0f} and the engine's call is {r['action']}." for r in rows if r["symbol"] in chosen and r.get("strength") is not None) or "No name from this sector is in the book."
    change = "A reversal of the call — the stance falling two levels, or the theme's breadth in earnings calls dropping a quarter from its peak for two quarters — is the exit signal (D-24)."
    return {"where_we_are": " ".join(where) or "No cycle read for this sector.", "the_case": case, "the_bet": the_bet, "names": names,
            "what_would_change_the_call": change, "numbers_used": [], "unverified_count": 0, "source": "engine"}
