"""The fundamentals narrative, built for every idea without a model call: what the company does, how its earnings have
grown, what is driving that (in management's own words), how good the business is, what could break it, and what you
pay. The Claude thesis record (when enabled) sits on top of this; it never replaces it. Every number comes from the
point-in-time snapshot and the screen's metrics, with its period."""
from __future__ import annotations

import gzip
import json

import pandas as pd

from ..config import DATA_DIR
from ..frameworks.danoff import danoff_read


def profile(symbol: str) -> dict:
    """Company description from the cached FMP profile (raw pull, never re-fetched)."""
    d = DATA_DIR / "raw" / "fmp" / "stable_profile"
    if not d.exists():
        return {}
    hits = sorted(d.glob(f"{symbol}__*.json.gz"))
    if not hits:
        return {}
    try:
        data = json.loads(gzip.decompress(hits[-1].read_bytes()).decode("utf-8"))
        if isinstance(data, dict) and "data" in data:
            data = data["data"]
        row = data[0] if isinstance(data, list) and data else (data if isinstance(data, dict) else {})
        return {"description": row.get("description"), "ceo": row.get("ceo"), "employees": row.get("fullTimeEmployees"), "website": row.get("website"), "ipo": row.get("ipoDate")}
    except Exception:  # noqa: BLE001
        return {}


def _pct(x, digits=0):
    return "–" if x is None else f"{x*100:.{digits}f}%"


def _money(x, cur="USD"):
    if x is None:
        return "–"
    a = abs(x)
    s = f"{x/1e9:.1f}B" if a >= 1e9 else (f"{x/1e6:.0f}M" if a >= 1e6 else f"{x:,.0f}")
    return s + (" " + cur if cur != "USD" else "")


def earnings_table(fy: pd.DataFrame | None, currency: str = "USD", years: int = 6) -> list[dict]:
    """Fiscal-year rows: revenue, growth, operating margin, EPS, free cash flow."""
    if fy is None or fy.empty:
        return []
    f = fy.tail(years)
    rows, prev_rev, prev_eps = [], None, None
    for pe, r in f.iterrows():
        rev, oi, eps = r.get("revenue"), r.get("operating_income"), r.get("eps_diluted")
        fcf = r.get("fcf") if "fcf" in r.index and pd.notna(r.get("fcf")) else None
        rows.append({"fy": str(pd.Timestamp(pe).date()), "revenue": _money(rev, currency), "rev_growth": (f"{(rev/prev_rev-1)*100:+.0f}%" if prev_rev and rev else "–"),
                     "op_margin": (f"{oi/rev*100:.0f}%" if rev and oi is not None and pd.notna(oi) else "–"), "eps": (f"{eps:.2f}" if eps is not None and pd.notna(eps) else "–"),
                     "eps_growth": (f"{(eps/prev_eps-1)*100:+.0f}%" if prev_eps and eps and prev_eps > 0 and pd.notna(eps) else "–"), "fcf": _money(fcf, currency)})
        prev_rev, prev_eps = (rev if rev and pd.notna(rev) else prev_rev), (eps if eps is not None and pd.notna(eps) else prev_eps)
    return rows


def build_story(c, fy: pd.DataFrame | None = None, sector_call=None) -> dict:
    """Sections of prose plus the earnings table and the Danoff read. `c` is an IdeaCandidate or its dict."""
    d = c if isinstance(c, dict) else c.model_dump()
    m = d.get("metrics") or {}
    sym, name, cur = d.get("symbol"), d.get("name") or d.get("symbol"), d.get("currency") or "USD"
    pr = profile(sym)
    sc = sector_call if (sector_call is None or isinstance(sector_call, dict)) else sector_call.model_dump()
    # what it does
    desc = (pr.get("description") or "").strip()
    if len(desc) > 700:
        desc = desc[:700].rsplit(". ", 1)[0] + "."
    what = f"{name} — {d.get('industry') or ''}, {d.get('sector') or ''}." + (f" {desc}" if desc else "")
    if sc:
        what += f" The engine files it under {sc.get('label', '').split(' — ')[0]}."
    # how the earnings have grown
    rows = earnings_table(fy, cur)
    grow = []
    if m.get("rev_cagr_3y") is not None:
        grow.append(f"Revenue has compounded at {_pct(m['rev_cagr_3y'])} a year over three years")
    if m.get("rev_growth_ttm") is not None:
        grow.append(f"{'and ' if grow else ''}grew {_pct(m['rev_growth_ttm'])} over the last 12 months")
    if m.get("rev_accel") is not None:
        grow.append(f"({'accelerating' if m['rev_accel'] > 0.02 else ('slowing' if m['rev_accel'] < -0.02 else 'steady')}, {m['rev_accel']*100:+.0f} pp vs the prior year)")
    eps_bits = []
    if m.get("eps_cagr_3y") is not None:
        eps_bits.append(f"earnings per share {_pct(m['eps_cagr_3y'])} a year over three years")
    if m.get("eps_growth_ttm") is not None:
        eps_bits.append(f"{_pct(m['eps_growth_ttm'])} over the last 12 months")
    if m.get("beat_streak") is not None:
        eps_bits.append(f"beating estimates in {m['beat_streak']:.0f} of the last 8 quarters")
    earnings = (" ".join(grow) + ". " if grow else "") + ("Earnings: " + ", ".join(eps_bits) + "." if eps_bits else "")
    if m.get("operating_margin") is not None:
        earnings += f" Operating margin {_pct(m['operating_margin'])}" + (f", incremental margin {_pct(m['incremental_margin'])} on new revenue" if m.get("incremental_margin") is not None else "") + "."
    # what is driving it — management's words
    quotes = [q for q in (m.get("text_quotes") or []) if q.get("quote") and "?" not in q["quote"] and len(q["quote"]) <= 300]   # management's statements, not analysts' questions
    order = {"demand_up": 0, "ai_receipts": 1, "guidance_up": 2, "pricing_up": 3, "leadership": 4}
    quotes = sorted(quotes, key=lambda q: order.get(q.get("category"), 9))[:4]
    driving = []
    if m.get("llm_one_line"):
        driving.append(f"Claude's reading of the latest call: {m['llm_one_line']}")
    if m.get("theme_quote"):
        driving.append(f"On the theme reaching it: “{m['theme_quote']}”")
    for q in quotes:
        driving.append(f"“{q['quote']}” ({q.get('doc')})")
    # quality
    qual = []
    if m.get("roic_ttm") is not None:
        qual.append(f"returns {_pct(m['roic_ttm'])} on invested capital")
    if m.get("gross_margin") is not None:
        qual.append(f"gross margin {_pct(m['gross_margin'])}" + (f" ({'up' if m['gm_trend_3y'] > 0 else 'down'} {abs(m['gm_trend_3y'])*100:.0f} pp in three years)" if m.get("gm_trend_3y") is not None else ""))
    if m.get("fcf_margin") is not None:
        qual.append(f"free cash flow {_pct(m['fcf_margin'])} of revenue")
    if m.get("ocf_ni_ratio") is not None:
        qual.append(f"cash conversion {m['ocf_ni_ratio']:.2f}× reported profit")
    if m.get("net_debt_ebitda") is not None:
        qual.append("net cash" if m["net_debt_ebitda"] < 0 else f"net debt {m['net_debt_ebitda']:.1f}× EBITDA")
    if m.get("rd_pct") is not None:
        qual.append(f"R&D {_pct(m['rd_pct'])} of sales")
    quality = ("The business " + ", ".join(qual) + "." if qual else "")
    # what could break it
    risks = []
    if m.get("rev_accel") is not None and m["rev_accel"] < -0.1:
        risks.append(f"growth is slowing sharply ({m['rev_accel']*100:+.0f} pp vs the prior year)")
    if (m.get("llm_red_flags") or 0) >= 2 or (m.get("text_red_flags") or 0) > 0:
        risks.append("red-flag language in the documents")
    if m.get("net_debt_ebitda") is not None and m["net_debt_ebitda"] > 3:
        risks.append(f"leverage at {m['net_debt_ebitda']:.1f}× EBITDA")
    if m.get("ocf_ni_ratio") is not None and m["ocf_ni_ratio"] < 0.7:
        risks.append("profits not fully backed by cash")
    if (m.get("text_concentration") or 0) > 0.5 or m.get("customer_concentration"):
        risks.append("customer concentration")
    if m.get("gm_trend_3y") is not None and m["gm_trend_3y"] < -0.03:
        risks.append("margins falling")
    if m.get("pe_own_pctile") is not None and m["pe_own_pctile"] > 85:
        risks.append("the multiple is near the top of its own range")
    cc = m.get("commodity_cycle") or {}
    if cc.get("phase", "").startswith("peak"):
        risks.append(f"its commodity group is at a cycle peak ({cc.get('label')})")
    for q in (m.get("text_quotes") or []):
        if q.get("category") in ("demand_down", "guidance_down", "pricing_down") and q.get("quote") and len(q["quote"]) < 240:
            risks.append(f"“{q['quote']}” ({q.get('doc')})")
            break
    # what you pay
    pay = []
    if m.get("pe_ttm"):
        pay.append(f"{m['pe_ttm']:.0f}× trailing earnings" + (f", the {m['pe_own_pctile']:.0f}th percentile of its own 10-year range" if m.get("pe_own_pctile") is not None else ""))
    if m.get("p_fcf_avg"):
        pay.append(f"{m['p_fcf_avg']:.0f}× three-year average free cash flow")
    if m.get("peg") is not None:
        pay.append(f"PEG {m['peg']:.1f}")
    if m.get("implied_growth_gap") is not None:
        pay.append(("the price implies slower growth than delivered" if m["implied_growth_gap"] > 0 else "the price implies faster growth than delivered") + f" ({m['implied_growth_gap']:+.0f} pp)")
    pay_s = ("You pay " + "; ".join(pay) + "." if pay else "")
    dan = m.get("danoff") or danoff_read(m)
    return {"what": what, "earnings": earnings, "earnings_rows": rows, "driving": driving, "quality": quality, "risks": risks, "pay": pay_s, "danoff": dan, "profile": pr}
