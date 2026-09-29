"""Prompt-context assembly: stable system prompt first (cached), then <doc> blocks (FinancialRead numbers, reasons,
10-K Items 1/1A/7, latest 10-Q Item 2, latest 8-K Ex-99.1 / press release, latest transcript), stage instruction last."""
from __future__ import annotations

import json

from ..connectors.edgar import EDGAR, split_items
from ..connectors.fmp import FMP
from ..screen.models import IdeaCandidate

SYSTEM = """You are the research agent inside Paul Tsai's investment engine (Fidelity-trained PM; philosophy: buy the indispensable #1 (主役企業) with a good investment story when everyone is pessimistic; hold while the thesis is intact; sell only when it breaks; survival first; asymmetry by sizing).
Answer the three questions (R-09): 「この会社の投資ストーリーは何か」「そのストーリーを信じる根拠は何か」「そのストーリーはいつ崩れるか」.
Frameworks: F-104 story before valuation; F-105 explain the chart; F-107 drivers = price × quantity / demand × distribution; F-01 toll booth (関所): chokepoint asset, replaceability, accumulating vs re-earned, pricing evidence; F-39/F-43 intelligence supply chain (upstream energy/uranium; midstream receipts-holders vs rented-compute resellers; downstream toll booths); F-40 領収書付きCapEx (backlog/RPO as receipts); F-114 four lenses — Buffett: moat durability and margins; Danoff: accelerating earnings, upward revisions, beating every time, the daily re-buy test; Tillinghast: low debt, real cash flow, reasonable P/E, verifiable from outside; Lynch: a 2-minute story, a buyable price, runway left.
Source discipline (spec §8.7): every number carries (period, source) where source is a <doc id> from this context or FinancialRead.<key>. If you cannot cite it, write "(unverified)". Never do arithmetic — quote FinancialRead values. Never fabricate quotes, estimates or price moves. English. Numeric checkpoint thresholds are TBD(Paul) unless stated; you may propose suggested_bull/suggested_bear separately.
Output must be the requested JSON object only."""


def _doc(doc_id: str, period: str, source: str, text: str, cap: int) -> str:
    t = text.strip()
    if len(t) > cap:
        t = t[:cap] + "\n[truncated — do not cite beyond this point]"
    return f'<doc id="{doc_id}" period="{period}" source="{source}">\n{t}\n</doc>'


def financial_read(c: IdeaCandidate) -> dict:
    m = c.metrics
    keys = ["revenue_ttm", "net_income_ttm", "eps_ttm", "fcf_ttm", "ocf_ttm", "rev_growth_ttm", "rev_cagr_3y", "gross_margin", "operating_margin",
            "incremental_margin", "roic_ttm", "ocf_ni_ratio", "fcf_margin", "net_debt", "net_debt_ebitda", "pe_ttm", "pe_own_pctile", "pe_band_low",
            "pe_band_median", "pe_band_high", "peg", "drawdown_3y", "upside_to_peak", "net_cash_to_cap", "fcf_yield", "shareholder_yield", "dividend_yield",
            "beat_streak", "eps_growth_ttm", "insider_buy_usd_12m", "insider_sell_usd_12m", "market_cap", "price", "rd_pct"]
    fr = {k: m.get(k) for k in keys if m.get(k) is not None}
    fr["basis"], fr["period_end"] = c.basis, str(c.period_end)
    if m.get("dcf"):
        fr["dcf_summary"] = m["dcf"].get("summary")
    return fr


def build_context(c: IdeaCandidate, phases: list[dict] | None = None, want_transcript: bool = True) -> list[dict]:
    blocks: list[str] = []
    blocks.append(_doc(f"FinancialRead {c.symbol} {c.basis} to {c.period_end}", str(c.period_end), "engine (FMP, point-in-time)",
                       json.dumps(financial_read(c), indent=0, default=str), 6000))
    reasons = [{"rule": r.rule_id, "label": r.label, "value": r.value, "unit": r.unit, "pct_rank": r.rank_pct} for r in c.reasons if r.kind == "factor" and r.value is not None]
    blocks.append(_doc(f"ReasonComponents {c.symbol}", str(c.as_of), "engine", json.dumps(reasons, default=str), 6000))
    gates = [{"gate": g.gate_id, "outcome": g.outcome, "evidence": g.evidence} for g in c.gates]
    blocks.append(_doc(f"Gates {c.symbol}", str(c.as_of), "engine", json.dumps(gates), 2000))
    master = None
    try:
        from ..store import read_df

        master = read_df("security_master", f"security_id = '{c.security_id}'").iloc[0]
    except Exception:  # noqa: BLE001
        master = None
    cik = master["cik"] if master is not None and master["cik"] else None
    if cik:
        try:
            ed = EDGAR()
            idx = ed.filing_index(cik, forms=("10-K", "10-Q", "8-K", "20-F"))
            tenk = next((f for f in idx if f["form"] in ("10-K", "20-F")), None)
            if tenk and tenk["primary_doc"]:
                text = ed.document_text(cik, tenk["accession"], tenk["primary_doc"])
                items = split_items(text)
                for it, cap in (("1", 15000), ("1A", 8000), ("7", 15000)):
                    if it in items:
                        blocks.append(_doc(f"{tenk['form']} filed {tenk['filed']} Item {it}", f"FY{tenk['report_date'][:4] if tenk['report_date'] else ''}", "EDGAR", items[it], cap))
            tenq = next((f for f in idx if f["form"] == "10-Q"), None)
            if tenq and tenq["primary_doc"]:
                text = ed.document_text(cik, tenq["accession"], tenq["primary_doc"])
                items = split_items(text)
                if "2" in items:
                    blocks.append(_doc(f"10-Q filed {tenq['filed']} Item 2 (MD&A)", f"quarter ended {tenq['report_date']}", "EDGAR", items["2"], 8000))
        except Exception as e:  # noqa: BLE001
            blocks.append(_doc("EDGAR note", "", "engine", f"filings unavailable: {str(e)[:100]}", 200))
    if want_transcript:
        try:
            fmp = FMP()
            dates = fmp.transcript_dates(c.symbol)
            if dates:
                d0 = sorted(dates, key=lambda d: d.get("date", ""), reverse=True)[0]
                tr = fmp.transcript(c.symbol, int(d0["fiscalYear"]), int(d0["quarter"]))
                if tr and tr.get("content"):
                    blocks.append(_doc(f"Earnings call transcript Q{d0['quarter']} FY{d0['fiscalYear']} ({tr.get('date')})", f"Q{d0['quarter']} FY{d0['fiscalYear']}", "FMP transcript", tr["content"], 20000))
        except Exception:  # noqa: BLE001
            pass
    if phases:
        blocks.append(_doc(f"PricePhases {c.symbol}", "history", "engine drivers module", json.dumps(phases, default=str), 8000))
    return [{"role": "user", "content": [{"type": "text", "text": "\n\n".join(blocks)}]}]
