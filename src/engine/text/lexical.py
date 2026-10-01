"""Tier 1 — deterministic lexical signals over transcripts and filing items. Pure functions, no network, no LLM.
Every hit keeps the sentence it came from so a reason can quote it (spec §8.7: numbers and claims carry their source).

Categories (rule ids are the spec's): demand_up / demand_down (F-42 capacity, F-40 backlog/RPO), pricing_up (F-08 price
increases sticking), guidance_up / guidance_down (F-17), leadership (F-01 / R-09 主役 — share gains, "number one"),
concentration (R-18 customer concentration), red_flag (X-19 / R-18 — going concern, restatement, material weakness,
covenant, SEC investigation), ai_receipts (F-45 dial 1: backlog/RPO/committed spend tied to AI)."""
from __future__ import annotations

import re
from dataclasses import dataclass

# (category, rule_id, direction(+1 good / -1 bad / 0 informational), patterns)
SIGNALS: list[tuple[str, str, int, list[str]]] = [
    ("demand_up", "F-42/F-40", +1, [
        r"\bsold[- ]out\b", r"\bcapacity[- ]constrained\b", r"\bsupply[- ]constrained\b", r"\bdemand (?:continues to |still )?(?:exceed|outstrip|outpace)s?\b",
        r"\b(?:record|all[- ]time high) (?:backlog|bookings|orders|book[- ]to[- ]bill)\b", r"\bbacklog (?:grew|increased|rose|expanded|is up|was up)\b",
        r"\b(?:RPO|remaining performance obligations?) (?:grew|increased|rose|was up|is up|of \$)", r"\bbook[- ]to[- ]bill (?:above|over|greater than|exceed(?:ed|s)?) (?:1|one)\b",
        r"\bwait(?:ing)? ?list\b", r"\blead times? (?:extended|lengthened|are extending|remain extended)\b", r"\bfull(?:y)? (?:booked|utilized|subscribed)\b",
    ]),
    ("demand_down", "F-42/F-40", -1, [
        r"\bbacklog (?:declined|decreased|fell|is down|was down|contracted)\b", r"\bdestocking\b", r"\binventory (?:correction|digestion|build[- ]?up)\b",
        r"\b(?:soft(?:er|ening)?|weak(?:er|ening)?|slow(?:er|ing)?) (?:demand|orders|bookings)\b", r"\bpush[- ]?outs?\b", r"\border (?:cancellations?|delays?)\b",
        r"\bexcess (?:capacity|inventory)\b", r"\bbook[- ]to[- ]bill (?:below|under|less than) (?:1|one)\b",
    ]),
    ("pricing_up", "F-08", +1, [
        r"\bprice increases? (?:stuck|held|are sticking|have stuck|took hold|were accepted)\b", r"\b(?:raised|increased|higher) (?:our |average )?(?:prices|pricing|ASPs?)\b",
        r"\bpricing (?:power|discipline|tailwinds?)\b", r"\bpositive (?:price|pricing|price[/ ]mix)\b", r"\bprice (?:realization|realisation)\b",
        r"\bpass(?:ed|ing)? (?:through|on|along) (?:higher |the )?(?:costs?|inflation)\b", r"\bpricing (?:remains|was|is) (?:strong|firm|favorable|favourable)\b",
    ]),
    ("pricing_down", "F-08", -1, [
        r"\bprice (?:cuts?|reductions?|erosion|pressure|declines?|concessions?)\b", r"\bpricing (?:pressure|headwinds?|erosion)\b", r"\bdiscount(?:ing)? (?:increased|intensified|environment)\b",
        r"\bASPs? (?:declined|fell|decreased|down)\b", r"\bprice war\b",
    ]),
    ("guidance_up", "F-17", +1, [
        r"\brais(?:e|ed|ing) (?:our )?(?:full[- ]year |fiscal[- ]year |annual |20\d\d |FY ?\d\d )?(?:guidance|outlook|forecast|expectations?|targets?)\b",
        r"\b(?:guidance|outlook) (?:is |was |has been )?(?:raised|increased|revised (?:up|upward|higher))\b", r"\bahead of (?:our )?(?:plan|expectations|guidance)\b",
        r"\bincreas(?:e|ed|ing) (?:our )?(?:full[- ]year |fiscal[- ]year )?(?:guidance|outlook)\b", r"\bexceed(?:ed|ing)? (?:the high end of )?(?:our )?guidance\b",
    ]),
    ("guidance_down", "F-17", -1, [
        r"\b(?:lower(?:ed|ing)?|reduc(?:e|ed|ing)|cut(?:ting)?|trim(?:med|ming)?) (?:our )?(?:full[- ]year |fiscal[- ]year |annual |20\d\d )?(?:guidance|outlook|forecast|expectations?|targets?)\b",
        r"\b(?:guidance|outlook) (?:is |was |has been )?(?:lowered|reduced|cut|revised (?:down|downward|lower))\b", r"\bbelow (?:our )?(?:plan|expectations|guidance)\b",
        r"\bwithdr(?:ew|aw|awing|awn) (?:our )?(?:guidance|outlook)\b",
    ]),
    ("leadership", "F-01/R-09", +1, [
        r"\b(?:market|share) leader(?:ship)?\b", r"\b(?:number|no\.?|#) ?(?:one|1) (?:position|player|provider|supplier|share|in the market)\b", r"\b(?:gain(?:ed|ing)?|took|taking|winning) (?:market )?share\b",
        r"\bshare gains?\b", r"\bleading (?:market )?(?:position|share)\b", r"\b(?:only|sole) (?:supplier|provider|source)\b", r"\bde facto standard\b", r"\bmission[- ]critical\b",
        r"\bswitching costs?\b", r"\bnet (?:revenue|dollar) retention (?:of |was |is )?(?:1[1-9]\d|[1-9]\d{3})\s?%", r"\bpricing power\b",
    ]),
    ("concentration", "R-18", 0, [
        r"\b(?:one|two|three|single|largest) customers? (?:accounted for|represented|comprised) (?:approximately |about )?\d{2}\s?%", r"\b\d{2}\s?% of (?:our |total )?(?:net )?(?:revenue|sales) (?:was|were|came) from (?:one|a single|our largest)\b",
        r"\bloss of (?:this|that|any) (?:major |significant |key )?customer\b", r"\bdepend(?:s|ent|ence)? (?:heavily |substantially )?on (?:a|one|two|three|a limited number of) (?:major |key |large )?customers?\b",
    ]),
    ("red_flag", "X-19/R-18", -1, [
        r"\bgoing concern\b", r"\bsubstantial doubt\b", r"\bmaterial weakness(?:es)?\b", r"\brestate(?:d|ment)\b", r"\bcovenant (?:breach|violation|waiver|default)\b",
        r"\bSEC (?:investigation|subpoena|inquiry|enforcement)\b", r"\bDOJ (?:investigation|subpoena)\b", r"\bdelisting notice\b", r"\bchapter 11\b", r"\bliquidity (?:concerns?|crisis)\b",
        r"\bimpairment (?:charge|of goodwill)\b", r"\bauditor (?:resigned|resignation|dismissed)\b", r"\bcustomer (?:loss|churn) (?:increased|accelerated)\b",
    ]),
    # product-company lens (BCG Project Tiger: price realization vs the "fictitious price gap"; Mars & Co: push vs pull)
    ("full_price", "F-08/P-LENS", +1, [
        r"\bfull[- ]price (?:realization|realisation|sell[- ]through|sales|mix) (?:improved|increased|rose|grew|is up|was up|higher)\b", r"\b(?:less|lower|reduced|fewer) (?:promotional|promotions|markdowns?|discounting|closeouts?)\b",
        r"\bmarkdowns? (?:declined|decreased|fell|were lower|are lower|down)\b", r"\b(?:healthy|clean|lean) (?:channel |retail )?inventor(?:y|ies)\b", r"\bsell[- ]through (?:improved|accelerated|strong|outpaced sell[- ]in)\b",
        r"\b(?:pull|pull[- ]based) (?:model|strategy|market(?:place)?)\b", r"\boff[- ]price (?:was |is )?down\b", r"\bimprov(?:ed|ing|ement in) (?:full[- ]price|price) realization\b",
    ]),
    ("promo_push", "F-08/P-LENS", -1, [
        r"\b(?:elevated|higher|increased|heavier|more) (?:promotional|promotions|markdowns?|discounting|closeouts?|clearance)\b", r"\bpromotional (?:environment|activity|intensity|pressure)\b",
        r"\bmarkdowns? (?:increased|rose|were higher|are higher|up)\b", r"\b(?:elevated|excess|high) (?:channel |retail |wholesale )?inventor(?:y|ies)\b", r"\bclose[- ]?out (?:mix|sales|product)\b",
        r"\boff[- ]price (?:channel|sales|mix|was up|increased)\b", r"\bsell[- ]in (?:ahead of|exceeded|outpaced|above) sell[- ]through\b", r"\bextended (?:payment )?terms\b", r"\bload(?:ing|ed) the channel\b",
        r"\bdiscount mentality\b", r"\bliquidat(?:e|ing|ion of) (?:excess |aged )?inventory\b",
    ]),
    ("ai_receipts", "F-45/F-40", +1, [
        r"\bAI[- ]related (?:revenue|bookings|backlog|orders|demand)\b", r"\b(?:GPU|accelerator|AI (?:server|infrastructure|data ?center)) (?:demand|orders|backlog|bookings|revenue)\b",
        r"\b(?:token|inference|training) (?:volumes?|demand|revenue|workloads?) (?:grew|increased|rose|doubled|tripled|up)\b", r"\b(?:sovereign|hyperscaler|neocloud) (?:demand|orders|commitments?|customers?)\b",
        r"\bmulti[- ]year (?:agreements?|commitments?|contracts?) (?:for|with|covering)\b", r"\bcommitted (?:spend|capacity|purchases?)\b",
    ]),
]
_COMPILED = [(cat, rid, d, [re.compile(p, re.I) for p in pats]) for cat, rid, d, pats in SIGNALS]
_SENT = re.compile(r"(?<=[.!?])\s+(?=[A-Z])")


@dataclass
class Hit:
    category: str
    rule_id: str
    direction: int
    quote: str
    pos: int


def sentence_around(text: str, pos: int, width: int = 320) -> str:
    lo = max(0, text.rfind(". ", 0, pos) + 2 if text.rfind(". ", 0, pos) >= 0 else max(0, pos - width // 2))
    hi = text.find(". ", pos)
    hi = len(text) if hi < 0 else hi + 1
    q = text[lo:hi].strip()
    return q if len(q) <= width else q[:width - 1] + "…"


def extract(text: str, max_hits_per_category: int = 12) -> list[Hit]:
    """All lexical hits in `text`, at most `max_hits_per_category` per category, with the sentence around each."""
    if not text:
        return []
    out: list[Hit] = []
    for cat, rid, d, pats in _COMPILED:
        n = 0
        seen: set[int] = set()
        for p in pats:
            for m in p.finditer(text):
                key = m.start() // 200          # one hit per ~sentence
                if key in seen:
                    continue
                seen.add(key)
                out.append(Hit(cat, rid, d, sentence_around(text, m.start()), m.start()))
                n += 1
                if n >= max_hits_per_category:
                    break
            if n >= max_hits_per_category:
                break
    return out


def counts(hits: list[Hit]) -> dict[str, int]:
    c: dict[str, int] = {cat: 0 for cat, *_ in SIGNALS}
    for h in hits:
        c[h.category] += 1
    return c


def net_scores(cnt: dict[str, int], words: int) -> dict[str, float]:
    """Per-document signal scores, per 10k words so long 10-Ks and short calls compare (counts are capped upstream)."""
    k = 10_000.0 / max(words, 2_000)
    return {
        "text_demand": (cnt.get("demand_up", 0) - cnt.get("demand_down", 0)) * k,
        "text_pricing": (cnt.get("pricing_up", 0) - cnt.get("pricing_down", 0)) * k,
        "text_guidance": (cnt.get("guidance_up", 0) - cnt.get("guidance_down", 0)) * k,
        "text_leadership": cnt.get("leadership", 0) * k,
        "text_red_flags": cnt.get("red_flag", 0) * k,
        "text_concentration": cnt.get("concentration", 0) * k,
        "text_ai_receipts": cnt.get("ai_receipts", 0) * k,
    }
