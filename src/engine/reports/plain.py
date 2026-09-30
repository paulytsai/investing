"""Plain-English layer for every page: each reason, gate, action, sector rationale and label rendered as a sentence a
reader without the spec can follow. The rule ids stay beside the sentence as small tags for audit; the numbers are
unchanged. Pure functions over the same ReasonComponent / gate / sector-call data the templates already receive."""
from __future__ import annotations

import re

STANCE = {"overweight": "Overweight — own more of this sector than the market does", "neutral": "Neutral — hold the market's weight",
          "underweight": "Underweight — own less than the market", "avoid": "Avoid — members are losing money and shrinking", "thin": "Too few members to judge — treated as neutral"}
ACTION = {"buy-in-stages": "Buy in stages", "watch": "Watch", "pass": "Pass", "excluded": "Excluded", "insufficient_data": "Not enough data"}
ASSET = {"non_commodity": "operating business", "commodity_cyclical": "commodity / cyclical business", "miner_resource": "miner or resource producer",
         "real_estate": "real-estate vehicle", "pre_profit": "not yet profitable", "japanese_equity": "Japanese equity"}
LAYER = {"upstream": "upstream of AI (energy, power, uranium)", "midstream_receipts": "AI midstream with contracted demand (receipts in hand)",
         "midstream_reseller": "AI midstream renting out compute (no receipts)", "commodity_midstream": "AI midstream selling a commodity part",
         "downstream_tollbooth": "AI application toll booth (the layer customers cannot route around)", "none": "not in the AI supply chain"}
GATE = {"G1": "Management alignment", "G2": "Value trap", "G3": "Balance sheet and earnings quality", "G4": "Speculation", "G5": "Trust and complexity", "G6": "Access"}
GATE_OUT = {"pass": "passes", "size_cap": "passes, but with a size cap", "checkpoint": "open question to check before buying", "avoid": "fails — avoid",
            "veto": "fails — vetoed", "exclude_from_core": "not core-eligible (speculative sizing only)", "size_as_non_core": "size as non-core"}


def _ord(n: str) -> str:
    i = int(n)
    return f"{i}{'th' if 10 <= i % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(i % 10, 'th')}"


def _get(obj, k):
    return obj.get(k) if isinstance(obj, dict) else getattr(obj, k, None)


def _num(v, unit: str | None, value_fmt: str | None) -> str:
    if value_fmt and value_fmt != "–":
        return value_fmt
    if v is None:
        return "–"
    if unit in ("%", "pp"):
        return f"{v:+.0f}{unit}" if unit == "pp" else f"{v:.0f}%"
    return f"{v:.2f}"


def _better(rank_pct, direction) -> str:
    if rank_pct is None:
        return ""
    p = float(rank_pct)
    if direction == "lower_better":
        p = 100.0 - p
    if p >= 50:
        return f"better than {p:.0f}% of the universe"
    return f"worse than {100 - p:.0f}% of the universe"


def plain_reason(r) -> str:
    """One sentence for a ReasonComponent (object or dict from the page views)."""
    def g(k):
        return _get(r, k)
    key, v, unit, pct, d, vf = g("factor_key"), g("value"), g("unit"), g("rank_pct"), g("direction"), g("value_fmt")
    if v is None:
        return f"{g('label')}: no data."
    n = _num(v, unit, vf)
    b = _better(pct, d)
    x = float(v)
    T = {
        "rev_growth_ttm": f"Revenue grew {n} over the last 12 months ({b}).",
        "rev_cagr_3y": f"Revenue has compounded at {n} a year over three years ({b}).",
        "rev_accel": f"Revenue growth is {'speeding up' if x > 0 else 'slowing'}: {n} versus the prior 12 months.",
        "ip_pattern": ("Fits the IP-asset pattern: heavy R&D, rising gross margin, light capital spending." if x > 0 else "Does not fit the IP-asset pattern (heavy R&D, rising margins, light capex)."),
        "text_demand": (f"Its calls and filings talk about strong demand, backlog and sold-out capacity ({n} net mentions per 10k words; {b})." if x > 0 else f"Its calls and filings talk about weak demand, destocking or push-outs ({n} per 10k words)."),
        "text_ai_receipts": f"The documents cite committed AI spend, backlog or GPU/token demand ({n} per 10k words; {b}).",
        "llm_demand": f"Claude's reading of the latest call: demand signal {n} on a −2 to +2 scale.",
        "theme_exposure": f"It talks about themes that are spreading across the market's earnings calls ({n} mentions per 10k words; {b}).",
        "theme_new_entrant": ("An expanding theme reached this company: mentioned for the first time in its last two calls." if x > 0 else "No newly arriving theme in its last two calls."),
        "gross_margin": f"Gross margin {n} ({b}).",
        "gm_trend_3y": f"Gross margin has {'risen' if x > 0 else 'fallen'} by {n} over three years — {'evidence of pricing power' if x > 0 else 'a sign of pricing pressure'}.",
        "incremental_margin": f"Each extra dollar of revenue added {n} of operating profit ({b}).",
        "ai_layer_score": f"Position in the AI supply chain: {_layer(x)}.",
        "text_pricing": (f"The documents say price increases are sticking ({b})." if x > 0 else "The documents report price erosion or discounting."),
        "text_leadership": f"Management speaks like a leader — share gains, #1 position, sole supplier, switching costs ({n} per 10k words; {b}).",
        "llm_position": f"Claude's reading: competitive position {n} on −2 to +2 (is it the indispensable #1?).",
        "llm_pricing": f"Claude's reading: pricing power {n} on −2 to +2.",
        "roic_ttm": f"It earns {n} on the capital it invests, against a hurdle of the 10-year Treasury yield ({b}).",
        "ocf_ni_ratio": f"Operating cash flow is {n} of reported profit — {'profits are backed by cash' if x >= 1 else 'profits are only partly backed by cash'}.",
        "fcf_margin": f"Free cash flow is {n} of revenue — {'it earns while it invests' if x > 0 else 'it burns cash'}.",
        "net_debt_ebitda": (f"It holds net cash ({n} times EBITDA)." if x < 0 else f"Net debt is {n} times EBITDA{' — high' if x > 3 else ''}."),
        "text_red_flags": ("No red-flag language in its filings (going concern, restatement, material weakness, covenant, investigation)." if x == 0 else f"Red-flag language in its filings: {n} mentions (going concern, restatement, material weakness, covenant, investigation)."),
        "llm_red_flags": (f"Claude's reading found {n} red flags in the latest documents." if x > 0 else "Claude's reading found no red flags in the latest documents."),
        "pe_own_pctile": f"Its P/E sits at the {_ord(str(int(round(x))))} percentile of its own 10-year range — {'cheaper than usual' if x < 40 else ('about normal' if x < 60 else 'dearer than usual')} for this company.",
        "peg": f"PEG ratio {n} (P/E divided by earnings growth; around 1 or below is reasonable).",
        "multiple_led_drawdown": (f"Down {n} from its 3-year high while earnings held — the fall is in the multiple, not the business." if x > 0 else "No multiple-only drawdown: any price fall tracks weaker earnings."),
        "implied_growth_gap": (f"Trailing growth exceeds what the price implies by {n} points — the market underprices its growth." if x > 0 else f"The price implies faster growth than it has delivered ({n} points)."),
        "p_fcf_avg": f"Price is {n} times its 3-year average free cash flow ({b}).",
        "p_ocf": f"Price is {n} times operating cash flow ({b}).",
        "upside_to_peak": f"{n} below its 3-year peak — that much room back to the old high.",
        "net_cash_to_cap": (f"Net cash equals {n} of its market value — a floor under the price." if x > 0 else f"Net debt equals {n} of its market value."),
        "fcf_yield": f"Free-cash-flow yield {n} (cash earnings per dollar of price).",
        "insider_net_buy_12m": (f"Officers were net buyers of stock in the open market over 12 months ({n} of market value)." if x > 0 else ("No officer open-market buying or selling in 12 months." if x == 0 else f"Officers were net sellers in the open market over 12 months ({n} of market value).")),
        "shareholder_yield": f"Buybacks plus dividends return {n} of its market value a year.",
        "beat_streak": f"Beat earnings estimates in {x:.0f} of the last 8 quarters.",
        "text_guidance": (f"Guidance language in calls and filings leans toward raised ({n})." if x > 0 else ("Guidance language is neutral." if x == 0 else f"Guidance language leans toward cut ({n}).")),
        "llm_guidance": f"Claude's reading: guidance direction {n} on −2 to +2.",
        "llm_tone": f"Claude's reading: management tone {n} on −2 to +2.",
        "eps_growth_ttm": f"Earnings per share grew {n} over the last 12 months ({b}).",
        "fit_score": f"Fit with the current portfolio (barbell sleeve, overlap with holdings, region): {n} on a 0–1 scale.",
    }
    return T.get(key, f"{g('label')}: {n}{(' (' + b + ')') if b else ''}.")


def _layer(score: float) -> str:
    for k, s in (("downstream_tollbooth", 1.0), ("midstream_receipts", 0.9), ("upstream", 0.8), ("none", 0.5), ("commodity_midstream", 0.2), ("midstream_reseller", 0.1)):
        if abs(score - s) < 0.05:
            return LAYER[k]
    return "not in the AI supply chain"


def plain_penalty(p) -> str:
    def g(k):
        return _get(p, k)
    key = g("factor_key") or g("key") or ""
    T = {"run_up_penalty": "Penalty: a sharp recent run-up — the rule is not to chase.", "cyclical_high_margin_penalty": "Penalty: a cyclical business earning near-peak margins.",
         "geopolitical_penalty_china": "Penalty: China / Hong Kong domicile (geopolitical and governance risk).", "geopolitical_penalty_em": "Penalty: emerging-market domicile (currency, governance, access)."}
    return T.get(key, f"Penalty: {g('label')}.")


def plain_gate(gt) -> str:
    def g(k):
        return _get(gt, k)
    gid, out, ev = g("gate_id"), g("outcome"), g("evidence") or ""
    return f"{GATE.get(gid, gid)} gate {GATE_OUT.get(out, out)} ({ev})."


def plain_action(action: str, reason: str | None) -> str:
    head = ACTION.get(action, action)
    r = reason or ""
    m = re.search(r"Idea Strength (\d+) ≥ (\d+) and on-sale angle (\d+) ≥ (\d+)", r)
    if m:
        return f"{head}: strong enough ({m.group(1)} of 100, above {m.group(2)}) and priced reasonably (on-sale score {m.group(3)}, above {m.group(4)}); no gate says avoid."
    m = re.search(r"not on sale \(angle (\d+) < (\d+)", r)
    if m:
        tail = re.search(r"strength (\d+) < (\d+)", r)
        return f"{head}: not on sale (on-sale score {m.group(1)}, needs {m.group(2)}) — the rule is not to chase" + (f"; strength {tail.group(1)} is also below the {tail.group(2)} needed." if tail else ".")
    m = re.search(r"open gate checkpoint; strength (\d+) < (\d+)", r)
    if m:
        return f"{head}: a gate question is still open, and strength {m.group(1)} is below the {m.group(2)} needed to buy."
    m = re.search(r"Idea Strength (\d+) < (\d+)", r)
    if m:
        return f"{head}: strength {m.group(1)} is below the {m.group(2)} needed."
    m = re.search(r"strength (\d+) < (\d+)", r)
    if m:
        return f"{head}: strength {m.group(1)} is below the {m.group(2)} needed to buy."
    return f"{head}: {r}" if r else head


_SECTOR_LINE = [
    (r"median revenue growth TTM ([+\-]?\d+%) \(rank (\d+)/(\d+)\)", "Members' revenue grew {0} in the last 12 months — {1} of {2} sectors"),
    (r"median revenue acceleration ([+\-]?\d+%) \(rank (\d+)/(\d+)\)", "Revenue growth is {dir} ({0} vs a year earlier) — {1} of {2}"),
    (r"median EPS growth TTM ([+\-]?\d+%) \(rank (\d+)/(\d+)\)", "Earnings per share grew {0} — {1} of {2}"),
    (r"share of members growing EPS (\d+%) \(rank (\d+)/(\d+)\)", "{0} of members are growing earnings — {1} of {2}"),
    (r"median EPS beat streak \(of 8\) ([\d.]+) \(rank (\d+)/(\d+)\)", "Members beat estimates in {0} of the last 8 quarters — {1} of {2}"),
    (r"guidance raised − cut language \(calls\) ([\-\d.]+) \(rank (\d+)/(\d+)\)", "Guidance language net {0} (raised minus cut) — {1} of {2}"),
    (r"demand/backlog language \(calls\) ([\-\d.]+) \(rank (\d+)/(\d+)\)", "Demand and backlog language {0} per 10k words — {1} of {2}"),
    (r"median ROIC ([+\-]?\d+%) \(rank (\d+)/(\d+)\)", "Return on invested capital {0} — {1} of {2}"),
    (r"median FCF margin ([+\-]?\d+%) \(rank (\d+)/(\d+)\)", "Free cash flow {0} of revenue — {1} of {2}"),
    (r"median own-band P/E percentile ([\d.]+) \(rank (\d+)/(\d+)\)", "Valuation: P/E at the {0}th percentile of members' own history — {1} of {2} (lower is cheaper)"),
    (r"median price / 3y-avg FCF ([\d.]+) \(rank (\d+)/(\d+)\)", "Price is {0} times 3-year average free cash flow — {1} of {2} (lower is cheaper)"),
    (r"median 12-month price change ([+\-]?\d+%) \(rank (\d+)/(\d+)\)", "Members' shares moved {0} over 12 months — {1} of {2}"),
]


def plain_sector_line(line: str) -> str:
    for pat, tpl in _SECTOR_LINE:
        m = re.search(pat, line)
        if m:
            g = list(m.groups())
            out = tpl.format(*g, dir=("speeding up" if not g[0].startswith("-") else "slowing"))
            return re.sub(r"— (\d+) of (\d+)", lambda k: f"— {_ord(k.group(1))} of {k.group(2)}", out)
    m = re.match(r"(Overweight|Neutral|Underweight|Avoid[^:]*|Thin[^:]*): sector score (\d+)/100 across (\d+) theme sectors", line)
    if m:
        return f"Sector score {m.group(2)} of 100 across {m.group(3)} theme sectors."
    m = re.search(r"theme '(\w+)' in (\d+)% of calls \((\w+)\), ([\d.]+)× four quarters earlier, (\d+) new mentioners", line)
    if m:
        return f"The '{m.group(1).replace('_', ' ')}' theme came up in {m.group(2)}% of earnings calls in {m.group(3)}, {m.group(4)} times its level a year earlier, with {m.group(5)} companies mentioning it for the first time."
    return line


THESIS_HOOK = {   # the strongest reason → the one-line story (what kind of idea this is)
    "rev_growth_ttm": "growth is the story", "rev_cagr_3y": "a multi-year compounder", "rev_accel": "growth is re-accelerating",
    "ip_pattern": "an IP business that scales without capital", "text_demand": "demand is running ahead of capacity", "text_ai_receipts": "AI demand with receipts in hand",
    "llm_demand": "the latest call points to strengthening demand", "theme_exposure": "sits in a theme that is spreading across the market",
    "theme_new_entrant": "a theme has just reached this company", "gross_margin": "a high-margin toll booth", "gm_trend_3y": "pricing power is showing up in margins",
    "incremental_margin": "operating leverage is kicking in", "ai_layer_score": "holds a layer of the AI supply chain customers cannot route around",
    "text_pricing": "price increases are sticking", "text_leadership": "management talks like the leader, and the numbers back it",
    "llm_position": "the indispensable #1 in its niche", "llm_pricing": "pricing power confirmed in the documents", "roic_ttm": "it compounds capital at exceptional returns",
    "ocf_ni_ratio": "profits are real cash", "fcf_margin": "it earns while it invests", "net_debt_ebitda": "a fortress balance sheet",
    "pe_own_pctile": "a good business on sale against its own history", "peg": "growth at a reasonable price", "multiple_led_drawdown": "the price fell while the business did not",
    "implied_growth_gap": "the market underprices its growth", "p_fcf_avg": "cheap on cash flow", "p_ocf": "cheap on cash flow", "upside_to_peak": "room to recover to the old high",
    "net_cash_to_cap": "a cash floor under the price", "fcf_yield": "a high cash yield", "insider_net_buy_12m": "insiders are buying", "shareholder_yield": "cash is coming back to shareholders",
    "beat_streak": "it keeps beating expectations", "text_guidance": "guidance keeps going up", "llm_guidance": "guidance is rising", "llm_tone": "management tone is confident",
    "eps_growth_ttm": "earnings are growing fast", "fit_score": "fits the portfolio",
}
VERDICT = {"buy-in-stages": "Buy in stages", "watch": "Watch, not yet a buy", "pass": "Not a buy", "excluded": "Excluded by a hard rule", "insufficient_data": "Not enough data to judge"}


def summary_parts(c, sector_call=None, kelly_weight=None) -> dict:
    """The one-minute summary Paul asked for: main thesis, three reasons with the strongest first, the weakest in the
    middle and the second-strongest last, then a recap with the main risk, the price and the size. For a name that is not
    a buy the three reasons are the reasons against."""
    d = c if isinstance(c, dict) else c.model_dump()
    reasons = [r for r in d.get("reasons", []) if r.get("kind") == "factor" and r.get("contribution") is not None]
    pos = sorted([r for r in reasons if r["contribution"] > 0], key=lambda r: -r["contribution"])
    neg = sorted([r for r in reasons if r["contribution"] < 0], key=lambda r: r["contribution"])
    action = d.get("action", "")
    verdict = VERDICT.get(action, action)
    is_buy = action in ("buy-in-stages", "watch")
    top3 = (pos if is_buy else neg)[:3]
    ordered = [top3[0], top3[2], top3[1]] if len(top3) == 3 else top3      # strongest · weakest · second-strongest
    sc = None
    if sector_call is not None:
        sc = sector_call if isinstance(sector_call, dict) else sector_call.model_dump()
    label = ((sc or {}).get("label") or d.get("theme_sector") or d.get("sector") or "").split(" — ")[0]
    art = "an" if label[:1].upper() in "AEIOU" else "a"
    hook = THESIS_HOOK.get((top3[0] or {}).get("factor_key"), "") if top3 else ""
    strength = d.get("idea_strength")
    if is_buy:
        thesis = f"{d.get('symbol')} — {verdict}. {art.capitalize()} {label} name rated {strength:.0f} of 100: {hook or 'the numbers line up'}."
    else:
        thesis = f"{d.get('symbol')} — {verdict}. Rated {strength:.0f} of 100 in {label}: {('the case fails on ' + (hook or 'the fundamentals')) if hook else 'the case does not hold up'}."
    m = d.get("metrics") or {}
    recap = [f"Bottom line: {verdict.lower()}"]
    if is_buy and kelly_weight is not None:
        recap[0] += f", {kelly_weight*100:.1f}% of the book at half Kelly" if kelly_weight > 0 else ", but no size yet: no positive edge after correlation with the other names"
    recap[0] += "."
    if is_buy and neg:
        recap.append("Main risk: " + plain_reason(neg[0]))
    elif not is_buy and pos:
        recap.append("In its favour: " + plain_reason(pos[0]))
    if m.get("pe_ttm"):
        px = f"Price: {m['pe_ttm']:.0f}× earnings"
        if m.get("pe_own_pctile") is not None:
            px += f", the {_ord(str(int(round(m['pe_own_pctile']))))} percentile of its own 10-year range"
        recap.append(px + ".")
    if sc:
        bet = sc.get("bet") or {}
        recap.append(f"Sector: {label} is {sc.get('stance')}" + (f", {bet.get('active_bet_pp', 0):+.1f} pp vs market weight." if bet else "."))
    cc = m.get("commodity_cycle") or {}
    if cc.get("verdict"):
        recap.append("Commodity cycle: " + cc["verdict"])
    wc = why_cheap(d, sc)
    if wc.get("cheap"):
        recap.append(wc["sentence"])
    return {"thesis": thesis, "reasons": [plain_reason(r) for r in ordered], "recap": " ".join(recap), "verdict": verdict}


def plain_summary(c, sector_call=None, kelly_weight=None) -> str:
    p = summary_parts(c, sector_call, kelly_weight)
    return " ".join([p["thesis"], *[f"({i + 1}) {r}" for i, r in enumerate(p["reasons"])], p["recap"]])


def why_cheap(c, sector_call=None, phases=None) -> dict:
    """Is the name cheap, and why: market pessimism (the multiple fell while earnings held), a growth scare, fallen earnings, a sector out
    of favour, a commodity peak the market expects to fade, a theme that has faded, or something the documents say — or cheap for no visible
    reason, which is the case worth verifying (F-83: a good company falling on good results). Deterministic, from the same metrics."""
    d = c if isinstance(c, dict) else c.model_dump()
    m = d.get("metrics") or {}
    sc = sector_call if (sector_call is None or isinstance(sector_call, dict)) else sector_call.model_dump()
    pct, mld, dd = m.get("pe_own_pctile"), m.get("multiple_led_drawdown"), m.get("drawdown_3y")
    eps, acc = m.get("eps_growth_ttm"), m.get("rev_accel")
    cheap_signals = []
    if pct is not None and pct <= 30:
        cheap_signals.append(f"P/E at the {_ord(int(round(pct)))} percentile of its own 10-year range")
    if mld is not None and mld > 0.15:
        cheap_signals.append(f"{mld*100:.0f}% below its 3-year high with earnings intact")
    if m.get("p_fcf_avg") is not None and 0 < m["p_fcf_avg"] < 12:
        cheap_signals.append(f"{m['p_fcf_avg']:.0f}× three-year average free cash flow")
    if not cheap_signals:
        if pct is not None:
            return {"cheap": False, "sentence": f"Not cheap: P/E at the {_ord(int(round(pct)))} percentile of its own range" + (f", {dd*100:.0f}% below its 3-year high" if dd else "") + ".", "causes": []}
        return {"cheap": False, "sentence": "No own-history valuation band yet (less than three years of meaningful earnings), so cheapness cannot be judged against its past.", "causes": []}
    causes = []
    if mld is not None and mld > 0.15 and (eps is None or eps >= 0):
        causes.append(("market pessimism", f"the multiple fell while earnings held — the price is {mld*100:.0f}% off its high" + (f" with EPS {eps*100:+.0f}%" if eps is not None else "")))
    if eps is not None and eps < 0:
        causes.append(("earnings fell", f"earnings per share fell {abs(eps)*100:.0f}%, so the low multiple sits on depressed earnings — cheap on P/E is not cheap if they keep falling"))
    if acc is not None and acc < -0.1:
        causes.append(("growth scare", f"revenue growth slowed by {abs(acc)*100:.0f} pp against the prior year — the market is paying less for a slower story"))
    smed = ((sc or {}).get("inputs") or {}).get("pe_pctile_med")
    if smed is not None and smed <= 35:
        causes.append(("sector out of favour", f"its whole sector trades at the {_ord(int(round(smed)))} percentile of members' own ranges — this is a sector de-rating, not a company-specific one"))
    cc = m.get("commodity_cycle") or {}
    if str(cc.get("phase", "")).startswith("peak"):
        causes.append(("cycle peak priced in", f"its commodity group is at a margin peak ({cc.get('label')}) — the market expects earnings to fall, which is why the multiple looks low"))
    cyc = ((sc or {}).get("bet") or {}).get("cycle") or {}
    if cyc.get("phase") in ("faded",) or str(cyc.get("phase", "")).startswith("off its peak"):
        causes.append(("theme has faded", f"the sector's theme has {cyc.get('phase')} in earnings-call breadth"))
    neg = [q for q in (m.get("text_quotes") or []) if q.get("category") in ("demand_down", "guidance_down", "pricing_down") and q.get("quote") and "?" not in q["quote"]]
    if neg:
        causes.append(("what the company said", f"“{neg[0]['quote'][:180]}” ({neg[0].get('doc')})"))
    if (m.get("llm_red_flags") or 0) >= 3 or (m.get("text_red_flags") or 0) > 0:
        causes.append(("red flags", "red-flag language in the documents (going concern, restatement, material weakness, covenant, investigation)"))
    if phases:
        last = phases[-1] if isinstance(phases, list) else None
        if isinstance(last, dict) and (last.get("ret") or last.get("return") or 0) < -0.15:
            lab = last.get("label") or last.get("driver") or ""
            ev = ", ".join(str(e.get("label") or e.get("type") or e) for e in (last.get("events") or [])[:3])
            causes.append(("the last move", f"the last price phase was {(last.get('ret') or last.get('return'))*100:.0f}%, read as {lab}" + (f" ({ev})" if ev else "")))
    if causes:
        sentence = "Cheap because: " + "; ".join(f"{k} — {v}" for k, v in causes) + "."
    else:
        sentence = ("Cheap without a visible reason in the numbers: " + "; ".join(cheap_signals) + ". That is the case worth verifying in the filings — a good company falling on good results (F-83).")
    return {"cheap": True, "signals": cheap_signals, "causes": causes, "sentence": sentence, "kind": (causes[0][0] if causes else "no visible reason")}


GLOSSARY = [
    ("Idea Strength", "0–100 blend of eight angles (story & growth, moat, quality & cash, on sale, asymmetry, alignment, fundamental momentum, portfolio fit), each a percentile among all names on the date."),
    ("On sale", "How cheap the name is against its own history and its cash flows, not against the market."),
    ("Sector call / stance", "The engine judges each theme sector first (overweight / neutral / underweight / avoid) from its members' growth, momentum, quality, valuation and how widely its theme is spreading in earnings calls; stocks are picked inside the sectors that get slots."),
    ("Recommended bet", "The sector's share of market value × 1.5 for overweight, 1 for neutral, 0.5 for underweight, 0 for avoid, rescaled to 100%; the bet is the difference to the market weight."),
    ("Cycle", "Where the sector's theme stands in the share of earnings calls that mention it: a cycle is live from 10% of calls; 25% below its peak for two quarters is the exit signal."),
    ("Kelly", "The position size that maximises long-run growth given bull/base/bear outcomes; shown at full, half and quarter. The practical size is half Kelly × confidence, capped at 15%, and names that move together share one budget."),
    ("Gates G1–G6", "Hard checks before ranking: management alignment, value trap, balance sheet and earnings quality, speculation, trust and complexity, access."),
    ("TTM", "Trailing twelve months — the last four reported quarters added up."),
    ("Own-history P/E percentile", "Where today's P/E sits inside the company's own 10-year range: 10 means cheaper than 90% of its own history."),
    ("Buy in stages", "The action when strength and on-sale both clear their thresholds and no gate says avoid; entry is staged in tranches, never all at once."),
    ("Rule ids (F-07, R-23, D-24…)", "References to Paul's written investment philosophy; every number on the page can be traced to one. D-ids mark decisions Paul has not yet made, running on labelled stand-in values."),
]
