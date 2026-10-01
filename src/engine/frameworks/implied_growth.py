"""What the price assumes — earnings growth solved backwards from today's multiple (F-16 "priced-in growth", F-91,
R-24 plausibility). Pure functions; every threshold is a hypothesis carried in by the caller (INV-5).

The question Paul asks of every name: "what must earnings do for this price to earn the hurdle?"
  P/E_now = (1+g)^N · P/E_exit / (1+r)^N   →   g = ((P/E_now / P/E_exit) · (1+r)^N)^(1/N) − 1
Buying at P/E_now, holding N years while earnings grow at g, and selling at P/E_exit returns exactly r a year. The
exit multiple is the company's own 10-year median P/E (what the market has normally paid for it), the required return
is the 10-year UST plus Paul's hurdle margin (D-47), and N is the horizon (D-24).

Names with no earnings (TTM EPS ≤ 0) get the same question on revenue: the revenue growth that, with margins reaching a
mature level (D-25) and the stock exiting at P/E_exit, earns r. For them Paul's rule is explicit — no earnings means the
growth must be very rapid, and the pitch must say so (hypergrowth_ok)."""
from __future__ import annotations

import math

VERDICTS = ("priced for less than it has delivered", "priced for about what it has delivered", "priced for more than it has delivered")


def implied_eps_growth(pe_now: float | None, pe_exit: float | None, required_return_pct: float, years: int = 5) -> float | None:
    """Annual EPS growth (percent) the price implies; None when the inputs cannot support the question."""
    if not pe_now or not pe_exit or pe_now <= 0 or pe_exit <= 0 or years <= 0:
        return None
    r = required_return_pct / 100.0
    g = ((pe_now / pe_exit) * (1 + r) ** years) ** (1.0 / years) - 1.0
    return g * 100.0


def implied_revenue_growth(ps_now: float | None, target_margin_pct: float | None, pe_exit: float | None, required_return_pct: float,
                           years: int = 5) -> float | None:
    """Annual revenue growth (percent) the price implies for a company with no earnings yet: price = N-year-forward
    revenue × mature net margin × exit P/E, discounted at r. ps_now is market cap ÷ TTM revenue."""
    if not ps_now or not target_margin_pct or not pe_exit or ps_now <= 0 or target_margin_pct <= 0 or pe_exit <= 0 or years <= 0:
        return None
    r = required_return_pct / 100.0
    # ps_now = (1+g)^N · margin · pe_exit / (1+r)^N
    ratio = ps_now / (target_margin_pct / 100.0 * pe_exit)
    g = (ratio * (1 + r) ** years) ** (1.0 / years) - 1.0
    return g * 100.0


def verdict_for(gap_pp: float | None, tolerance_pp: float = 3.0) -> str | None:
    if gap_pp is None:
        return None
    if gap_pp > tolerance_pp:
        return VERDICTS[0]
    if gap_pp < -tolerance_pp:
        return VERDICTS[2]
    return VERDICTS[1]


def implied_growth(m: dict, *, rf_pct: float, hurdle_margin_pct: float, years: int, exit_pe_fallback: float, mature_margin_pct: float,
                   hypergrowth_min_rev_growth_pct: float, min_band_days: int = 750) -> dict:
    """Build the implied-growth record for one name from its metrics dict.

    m keys used: pe_ttm, eps_ttm, pe_band_median, pe_band_n, ps_ttm, eps_cagr_3y, rev_cagr_3y, rev_growth_ttm, gm_trend_3y, gross_margin.
    Returns {basis, implied_pct, years, pe_exit, pe_exit_source, required_return_pct, trailing_pct, trailing_label, gap_pp,
             verdict, hypergrowth_ok, note, rule_ids}.
    """
    r = rf_pct + hurdle_margin_pct
    band_ok = (m.get("pe_band_n") or 0) >= min_band_days and (m.get("pe_band_median") or 0) > 0
    pe_norm = float(m["pe_band_median"]) if band_ok else None
    # the headline exit multiple is the demanding one: the market's long-run multiple, or the company's own norm if that is
    # lower; "if it keeps its usual multiple" is shown beside it (a re-rating back to a rich norm is hope, not a plan)
    pe_exit = min(pe_norm, float(exit_pe_fallback)) if pe_norm else float(exit_pe_fallback)
    pe_exit_src = ("own 10-year median P/E" if pe_norm and pe_norm <= exit_pe_fallback else
                   f"long-run market multiple of {exit_pe_fallback:.0f}x" + ("" if pe_norm else "; too little own history"))
    out: dict = {"basis": None, "implied_pct": None, "implied_pct_norm": None, "years": years, "pe_exit": pe_exit, "pe_exit_source": pe_exit_src,
                 "pe_norm": pe_norm, "required_return_pct": r, "trailing_pct": None, "trailing_label": None, "gap_pp": None, "verdict": None,
                 "hypergrowth_ok": None, "note": "", "rule_ids": ["F-16", "F-91", "R-24", "D-24", "D-25", "D-47"]}
    pe = m.get("pe_ttm")
    eps = m.get("eps_ttm")
    if pe and pe > 0 and (eps is None or eps > 0):
        out["basis"] = "eps"
        out["implied_pct"] = implied_eps_growth(pe, pe_exit, r, years)
        out["implied_pct_norm"] = implied_eps_growth(pe, pe_norm, r, years) if pe_norm else None
        tr = m.get("eps_cagr_3y")
        out["trailing_pct"] = tr * 100 if tr is not None else None
        out["trailing_label"] = "EPS growth, last 3 years a year"
        if out["trailing_pct"] is None and m.get("rev_cagr_3y") is not None:
            out["trailing_pct"] = m["rev_cagr_3y"] * 100
            out["trailing_label"] = "revenue growth, last 3 years a year (no 3-year EPS record)"
        out["note"] = (f"At {pe:.1f}x trailing earnings, the price pays off at {r:.1f}% a year only if earnings grow "
                       f"{out['implied_pct']:.0f}% a year for {years} years and the stock then sells at {pe_exit:.0f}x ({pe_exit_src}).")
        if out["implied_pct_norm"] is not None and pe_norm and abs(pe_norm - pe_exit) > 0.5:
            out["note"] += f" If the market keeps paying its usual {pe_norm:.0f}x, {out['implied_pct_norm']:.0f}% a year is enough."
    else:
        ps = m.get("ps_ttm")
        out["basis"] = "revenue"
        out["implied_pct"] = implied_revenue_growth(ps, mature_margin_pct, pe_exit, r, years)
        out["implied_pct_norm"] = implied_revenue_growth(ps, mature_margin_pct, pe_norm, r, years) if pe_norm else None
        tr = m.get("rev_cagr_3y")
        out["trailing_pct"] = tr * 100 if tr is not None else None
        out["trailing_label"] = "revenue growth, last 3 years a year"
        rg = m.get("rev_growth_ttm")
        rapid = (rg is not None and rg * 100 >= hypergrowth_min_rev_growth_pct) and (tr is None or tr * 100 >= hypergrowth_min_rev_growth_pct * 0.75)
        margins_ok = (m.get("gm_trend_3y") or 0) >= 0 or (m.get("gross_margin") or 0) >= 0.5
        out["hypergrowth_ok"] = bool(rapid and margins_ok)
        if out["implied_pct"] is not None and ps:
            out["note"] = (f"No earnings yet. At {ps:.1f}x sales, the price pays off at {r:.1f}% a year only if revenue grows "
                           f"{out['implied_pct']:.0f}% a year for {years} years, margins reach {mature_margin_pct:.0f}% and the stock then sells at {pe_exit:.0f}x.")
        else:
            out["note"] = "No earnings and no usable sales multiple: the price cannot be tied to a growth rate."
        out["note"] += (" Paul's rule for a company without earnings: growth must be very rapid — "
                        + ("it is." if out["hypergrowth_ok"] else f"it is not (needs ≥{hypergrowth_min_rev_growth_pct:.0f}% a year with margins holding)."))
    if out["implied_pct"] is not None and out["trailing_pct"] is not None:
        out["gap_pp"] = out["trailing_pct"] - out["implied_pct"]
        out["verdict"] = verdict_for(out["gap_pp"])
    return out


def plain_sentence(ig: dict | None) -> str | None:
    """One sentence for the thesis summary: what the price assumes, against what the company has delivered."""
    if not ig or ig.get("implied_pct") is None:
        return None
    what = "earnings" if ig.get("basis") == "eps" else "revenue"
    s = f"The price assumes {what} grow about {ig['implied_pct']:.0f}% a year for the next {ig['years']} years"
    s += f" (selling at {ig['pe_exit']:.0f}x at the end"
    if ig.get("implied_pct_norm") is not None and ig.get("pe_norm") and abs(ig["pe_norm"] - ig["pe_exit"]) > 0.5:
        s += f"; {ig['implied_pct_norm']:.0f}% a year if it keeps its usual {ig['pe_norm']:.0f}x)"
    else:
        s += ")"
    if ig.get("trailing_pct") is not None:
        s += f". It has delivered {ig['trailing_pct']:.0f}% a year over the last three years, so it is {ig['verdict']}."
    else:
        s += ". There is no three-year growth record to compare it with."
    if ig.get("basis") == "revenue":
        s += " It has no earnings yet, so " + ("rapid growth is doing the work — and it is rapid." if ig.get("hypergrowth_ok") else "rapid growth is mandatory, and it is not rapid enough.")
    return s


def __math_check() -> None:   # pragma: no cover — documents the identity used above
    assert abs(implied_eps_growth(16, 16, 9, 5) - 9.0) < 1e-9
    assert math.isclose(implied_eps_growth(32, 16, 9, 5), ((2 * 1.09**5) ** 0.2 - 1) * 100)
