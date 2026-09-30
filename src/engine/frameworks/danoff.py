"""Will Danoff's method as a separate lens (The Smiley Fund, Contrafund): stock prices follow earnings per share; own the
very best companies; earnings growing with the story getting better is a smile (keep owning), deteriorating fundamentals a
frown (sell, or swap for a better idea); quality over price ("the price is forgotten, the quality remains"); write the
thesis down; a stock that has doubled is not a missed stock — ask whether it is a good investment today. Pure functions
over the metrics the screen already computes; the score is a lens beside Idea Strength, never blended into it."""
from __future__ import annotations

import math


def years_to_double(cagr: float | None) -> float | None:
    """Years for earnings to double at a compound growth rate (Danoff: double in four or five years → the stock should too)."""
    if cagr is None or cagr <= 0:
        return None
    return math.log(2.0) / math.log(1.0 + cagr)


def smile(m: dict) -> tuple[str, list[str]]:
    """Smile / flat / frown from the direction of the fundamentals: EPS growth, acceleration, beats, guidance language."""
    pts, why = 0, []
    eg = m.get("eps_growth_ttm")
    if eg is not None:
        if eg > 0.15:
            pts += 2
            why.append(f"earnings per share up {eg*100:.0f}% over the last 12 months")
        elif eg < 0:
            pts -= 2
            why.append(f"earnings per share down {abs(eg)*100:.0f}%")
    acc = m.get("rev_accel")
    if acc is not None:
        if acc > 0.02:
            pts += 1
            why.append("revenue growth is accelerating")
        elif acc < -0.05:
            pts -= 1
            why.append("revenue growth is slowing")
    bs = m.get("beat_streak")
    if bs is not None:
        if bs >= 5:
            pts += 1
            why.append(f"beat estimates in {bs:.0f} of the last 8 quarters")
        elif bs <= 2:
            pts -= 1
            why.append(f"beat estimates in only {bs:.0f} of the last 8 quarters")
    g = m.get("llm_guidance") if m.get("llm_guidance") is not None else m.get("text_guidance")
    if g is not None:
        if g > 0.5:
            pts += 1
            why.append("guidance is going up")
        elif g < -0.5:
            pts -= 1
            why.append("guidance is coming down")
    if m.get("llm_red_flags") and m["llm_red_flags"] >= 3:
        pts -= 1
        why.append("red flags in the latest documents")
    face = "smile" if pts >= 2 else ("frown" if pts <= -2 else "flat")
    return face, why


def best_of_breed(m: dict) -> tuple[float, list[str]]:
    """Is it one of the very best? ROIC, gross margin, leadership language, the indispensable-#1 read (0–1)."""
    s, why = 0.0, []
    roic = m.get("roic_ttm")
    if roic is not None and roic > 0.20:
        s += 0.3
        why.append(f"earns {roic*100:.0f}% on invested capital")
    gm = m.get("gross_margin")
    if gm is not None and gm > 0.5:
        s += 0.2
        why.append(f"{gm*100:.0f}% gross margin")
    if m.get("llm_is_number_one"):
        s += 0.3
        why.append("read as the indispensable #1 in its niche")
    elif (m.get("text_leadership") or 0) > 1.0:
        s += 0.2
        why.append("management talks like the leader (share gains, sole supplier)")
    if (m.get("gm_trend_3y") or 0) > 0.02:
        s += 0.1
        why.append("margins have risen over three years")
    if (m.get("ocf_ni_ratio") or 1) >= 0.9:
        s += 0.1
        why.append("profits are cash")
    return min(s, 1.0), why


def danoff_read(m: dict) -> dict:
    """The Danoff lens for one name: follow earnings (years to double), smile or frown, best of breed, price vs growth,
    the doubled-stock rule. Score 0–100 and plain-English lines; every input is a metric the screen already has."""
    eps_cagr = m.get("eps_cagr_3y")
    eps_ttm = m.get("eps_growth_ttm")
    growth = eps_cagr if eps_cagr is not None else eps_ttm
    if growth is not None and eps_ttm is not None and eps_cagr is not None:
        growth = min(eps_cagr, eps_ttm) if eps_ttm > 0 else eps_ttm   # the slower of the three-year rate and the last year: a spike off a trough is not a run-rate
    if growth is not None:
        growth = min(growth, 0.60)                                     # no business doubles earnings every 14 months for long; 60% is the ceiling used for the test
    ytd = years_to_double(growth)
    face, face_why = smile(m)
    bob, bob_why = best_of_breed(m)
    pe, peg = m.get("pe_ttm"), m.get("peg")
    lines = []
    # 1. follow earnings
    if ytd is not None:
        lines.append(f"Follow earnings: at the recent {growth*100:.0f}% a year, earnings per share double in {ytd:.1f} years"
                     + (" — inside Danoff's four-to-five-year test." if ytd <= 5 else " — too slow for the four-to-five-year test."))
    elif growth is not None:
        lines.append("Follow earnings: earnings are not growing, so there is nothing for the price to follow.")
    else:
        lines.append("Follow earnings: not enough earnings history to judge.")
    # 2. smile or frown
    lines.append(f"Smile or frown: {face}" + (" — " + "; ".join(face_why) + "." if face_why else "."))
    # 3. quality over price
    q = "the very best" if bob >= 0.7 else ("good, not best of breed" if bob >= 0.4 else "not a best-of-breed business on these numbers")
    lines.append(f"Quality: {q}" + (" — " + "; ".join(bob_why) + "." if bob_why else "."))
    if pe and growth and growth > 0:
        lines.append(f"Price vs growth: {pe:.0f}× earnings against {growth*100:.0f}% growth"
                     + (f" (PEG {peg:.1f})" if peg is not None else "")
                     + (". Danoff: the price is forgotten if the growth is there — it is." if ytd is not None and ytd <= 5 else ". Growth does not carry this price on its own."))
    # 6. ignore the past price
    ru = m.get("run_up_12m")
    if ru is not None and ru > 0.5:
        lines.append(f"The stock is up {ru*100:.0f}% in a year. Danoff: you have not missed it — the only question is whether earnings can double from here"
                     + (", and on these numbers they can." if ytd is not None and ytd <= 5 else ", and on these numbers that is not shown."))
    score = 0.0
    score += 40 * (1.0 if ytd is not None and ytd <= 4 else (0.7 if ytd is not None and ytd <= 5 else (0.35 if ytd is not None and ytd <= 8 else 0.0)))
    score += 30 * {"smile": 1.0, "flat": 0.5, "frown": 0.0}[face]
    score += 30 * bob
    verdict = ("Danoff would own it" if score >= 70 else ("Danoff would look closer" if score >= 45 else "Danoff would pass"))
    if face == "frown":
        verdict = "Danoff would sell or swap: fundamentals are deteriorating"
    return {"score": round(score, 1), "verdict": verdict, "face": face, "years_to_double": ytd, "growth_used": growth, "best_of_breed": bob,
            "lines": lines, "rule_ids": ["F-114", "F-17", "R-31"]}


def danoff_sector(reads: list[dict], symbols: list[str]) -> dict:
    """Sector through Danoff's eyes: share of members smiling, median years to double, the best-of-breed name."""
    if not reads:
        return {}
    faces = [r["face"] for r in reads]
    ytds = sorted([r["years_to_double"] for r in reads if r.get("years_to_double") is not None])
    med = ytds[len(ytds) // 2] if ytds else None
    best = max(zip(reads, symbols), key=lambda t: t[0]["score"])
    smiling = faces.count("smile") / len(faces)
    frowning = faces.count("frown") / len(faces)
    verdict = ("earnings are growing and stories are getting better across the sector" if smiling >= 0.5 else
               ("fundamentals are deteriorating across the sector" if frowning >= 0.4 else "mixed: no sector-wide smile or frown"))
    return {"share_smiling": smiling, "share_frowning": frowning, "median_years_to_double": med, "best_of_breed": best[1], "best_score": best[0]["score"],
            "n": len(reads), "verdict": f"Danoff view: {verdict}; {smiling*100:.0f}% of members smiling, {frowning*100:.0f}% frowning"
            + (f"; median earnings double in {med:.1f} years" if med else "") + f"; best of breed {best[1]} ({best[0]['score']:.0f}/100)."}
