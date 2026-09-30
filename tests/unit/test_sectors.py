"""Stage 1 (sector call) before stage 2 (stocks): classification into theme sectors with point-in-time AI membership,
slot allocation by stance, and selection inside sectors."""
from datetime import date

import pandas as pd

from engine.config import Hypotheses
from engine.screen.models import IdeaCandidate
from engine.screen.scoring import score_universe, select_top
from engine.screen.sectors import SectorCall, allocate_slots, classify, evaluate_sectors


def _c(sym, sector, industry, ai=0.0, **m):
    base = {"revenue_ttm": 5e10, "net_income_ttm": 5e9, "eps_ttm": 2.0, "fcf_ttm": 6e9, "ocf_ttm": 8e9, "rev_growth_ttm": 0.15, "rev_cagr_3y": 0.12, "gross_margin": 0.6,
            "roic_ttm": 0.2, "ocf_ni_ratio": 1.4, "fcf_margin": 0.12, "net_debt_ebitda": 0.5, "pe_ttm": 25.0, "pe_own_pctile": 40.0, "peg": 1.5, "multiple_led_drawdown": 0.0,
            "upside_to_peak": 0.1, "net_cash_to_cap": 0.02, "fcf_yield": 0.03, "beat_streak": 3.0, "eps_growth_ttm": 0.2, "market_cap": 2e11, "price": 50.0, "listing_days": 5000,
            "run_up_12m": 0.1, "drawdown_3y": -0.1, "ai_theme_intensity": ai}
    base.update(m)
    return IdeaCandidate(security_id=f"US:{sym}", symbol=sym, region="US", as_of=date(2026, 9, 26), sector=sector, industry=industry, metrics=base)


def test_classify_ai_layers_and_point_in_time_membership():
    assert classify(_c("NVDA", "Technology", "Semiconductors"))[0] == "ai_chips"                          # core industry: in from the start
    assert classify(_c("XEL", "Utilities", "Regulated Electric", ai=0.0))[0] == "utilities"     # not yet talking AI/data-center power
    assert classify(_c("XEL", "Utilities", "Regulated Electric", ai=5.0))[0] == "ai_energy"     # joined the energy layer when its calls did
    assert classify(_c("MSFT", "Technology", "Software - Infrastructure"))[0] == "ai_infrastructure"       # hyperscaler = AI factory
    assert classify(_c("GOOGL", "Communication Services", "Internet Content & Information"))[0] == "ai_models"
    assert classify(_c("DUOL", "Technology", "Software - Application", ai=0.5))[0] == "tech_other"
    assert classify(_c("DUOL", "Technology", "Software - Application", ai=4.0))[0] == "ai_applications"
    assert classify(_c("XOM", "Energy", "Oil & Gas Integrated"))[0] == "energy"


def test_sector_calls_then_slots_then_selection():
    hyp = Hypotheses.load()
    cands = []
    for i in range(12):   # a strong AI upstream sector and a weak, shrinking, loss-making sector
        cands.append(_c(f"A{i}", "Technology", "Semiconductors", rev_growth_ttm=0.4 + 0.01 * i, eps_growth_ttm=0.5, roic_ttm=0.3, pe_own_pctile=30 + i))
        cands.append(_c(f"E{i}", "Energy", "Oil & Gas E&P", rev_growth_ttm=-0.2, eps_growth_ttm=-0.4, fcf_margin=-0.05, roic_ttm=0.02, pe_own_pctile=80 - i))
        cands.append(_c(f"H{i}", "Healthcare", "Biotechnology", rev_growth_ttm=0.1, eps_growth_ttm=0.05, roic_ttm=0.1, pe_own_pctile=50 + i))
    score_universe(cands, hyp)
    calls = evaluate_sectors(cands, pd.Timestamp("2026-09-26"), hyp)
    assert calls["ai_chips"].stance == "overweight" and calls["energy"].stance == "avoid"
    assert any("median revenue growth" in r for r in calls["ai_chips"].rationale) and calls["ai_chips"].inputs["rev_growth_med"] > 0.4
    slots = allocate_slots(calls, 10, 6)
    assert slots["energy"] == 0 and slots["ai_chips"] >= 1
    picks = select_top(cands, 10, 6, calls)
    assert picks and all(p.theme_sector != "energy" for p in picks) and sum(p.theme_sector == "ai_chips" for p in picks) >= 1
    assert isinstance(calls["ai_chips"], SectorCall) and calls["ai_chips"].slots == slots["ai_chips"]
