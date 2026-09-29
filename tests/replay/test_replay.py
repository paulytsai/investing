"""Spec §8.9 decision-replay starter cases, frozen as evidence snapshots (no network, no LLM).
Each case asserts the engine's classification/action on the evidence Paul had."""
from datetime import date

import pytest

from engine.config import Hypotheses
from engine.screen.models import IdeaCandidate
from engine.screen.scoring import score_universe


def _cand(symbol, **metrics):
    base = {"revenue_ttm": 5e10, "net_income_ttm": 5e9, "eps_ttm": 2.0, "fcf_ttm": 6e9, "ocf_ttm": 8e9, "rev_growth_ttm": 0.15, "rev_cagr_3y": 0.12,
            "gross_margin": 0.6, "gm_trend_3y": 0.02, "incremental_margin": 0.3, "ai_layer_score": 0.9, "roic_ttm": 0.2, "ocf_ni_ratio": 1.4, "fcf_margin": 0.12,
            "net_debt_ebitda": 0.5, "pe_ttm": 25.0, "pe_own_pctile": 40.0, "peg": 1.5, "multiple_led_drawdown": 0.0, "upside_to_peak": 0.1, "net_cash_to_cap": 0.02,
            "fcf_yield": 0.03, "insider_net_buy_12m": 0.0, "shareholder_yield": 0.02, "beat_streak": 3.0, "eps_growth_ttm": 0.2, "market_cap": 2e11, "price": 50.0,
            "insider_buy_usd_12m": 0.0, "insider_sell_usd_12m": 0.0, "dividend_yield": 0.0, "pbr": 5.0, "required_cagr_pct": 25.0, "loss_making": False,
            "debt_funded_negative_fcf": False, "op_margin_pctile": 50.0, "listing_days": 5000, "run_up_12m": 0.1, "drawdown_3y": -0.1}
    base.update(metrics)
    return IdeaCandidate(security_id=f"US:{symbol}", symbol=symbol, region="US", as_of=date(2026, 9, 26), sector="Technology", industry="Software", metrics=base)


@pytest.fixture
def hyp():
    return Hypotheses.load()


def _universe(*extra):
    # a filler universe so z-scores are defined
    fill = [_cand(f"F{i}", rev_growth_ttm=0.05 + 0.01 * i, pe_own_pctile=50 + i, roic_ttm=0.1 + 0.01 * i, multiple_led_drawdown=0.0) for i in range(12)]
    return list(extra) + fill


def test_orcl_dec_2025_balance_sheet_goes_to_checkpoint_not_buy(hyp):
    """ORCL Dec 2025 (−40%, RPO doubts, stretched balance sheet): research → monitor/inspection with balance-sheet checkpoints,
    not a mechanical buy: G3 must flag debt-funded negative FCF."""
    orcl = _cand("ORCL", fcf_ttm=-5e9, fcf_margin=-0.08, net_debt_ebitda=4.5, debt_funded_negative_fcf=True, multiple_led_drawdown=0.4, pe_own_pctile=10.0)
    cands = score_universe(_universe(orcl), hyp)
    c = next(x for x in cands if x.symbol == "ORCL")
    g3 = next(g for g in c.gates if g.gate_id == "G3")
    assert g3.outcome in ("avoid", "size_cap") and c.action != "buy-in-stages"


def test_app_small_miss_multiple_led_drawdown_scores_on_sale(hyp):
    """APP Aug 2026: <1% revenue miss, −20% — a multiple-led drawdown with earnings intact scores as 'on sale' (F-12/F-83),
    never as a sell signal (R-44 suppression)."""
    app = _cand("APP", multiple_led_drawdown=0.5, pe_own_pctile=2.0, rev_growth_ttm=0.45, roic_ttm=0.9)
    cands = score_universe(_universe(app), hyp)
    c = next(x for x in cands if x.symbol == "APP")
    on_sale = next(a.score for a in c.angles if a.key == "on_sale")
    assert on_sale >= 80 and c.eligible


def test_price_only_drawdown_is_not_on_sale_when_earnings_fell(hyp):
    """INV-3: a drawdown where EPS fell as much as price is not 'on sale' (multiple_led_drawdown = 0)."""
    x = _cand("XYZ", drawdown_3y=-0.5, multiple_led_drawdown=0.0, eps_growth_ttm=-0.5, rev_growth_ttm=-0.2)
    cands = score_universe(_universe(x), hyp)
    c = next(a for a in cands if a.symbol == "XYZ")
    comp = next(r for r in c.reasons if r.factor_key == "multiple_led_drawdown")
    assert comp.value == 0.0 and (comp.contribution or 0) <= 0


def test_memory_cyclical_at_peak_margins_is_blocked(hyp):
    """Memory names 2026: commodity_cyclical at peak margins (R-15 / X-22) → HARD block, whatever the P/E."""
    mu = _cand("MU", pe_ttm=4.0, pe_own_pctile=1.0, op_margin_pctile=95.0)
    mu.asset_type = "commodity_cyclical"
    cands = score_universe(_universe(mu), hyp)
    c = next(x for x in cands if x.symbol == "MU")
    assert "X-22/R-15" in c.excluded_by and c.action == "excluded"


def test_tbd_threshold_never_vetoes_silently(hyp):
    """INV-5: every hypothesis threshold that touched a candidate is listed as a decision id."""
    cands = score_universe(_universe(_cand("AAA")), hyp)
    assert any(d.startswith("D-") for d in cands[0].decisions_touched)


def test_yield_trap_gate(hyp):
    """X-23 / R-16: a 9% yield without FCF coverage is avoided (G5)."""
    t = _cand("HIY", dividend_yield=0.09, dividend_coverage=0.6)
    cands = score_universe(_universe(t), hyp)
    c = next(x for x in cands if x.symbol == "HIY")
    assert next(g for g in c.gates if g.gate_id == "G5").outcome == "avoid" and not c.eligible


def test_china_adr_gets_soft_geopolitical_penalty_not_exclusion(hyp):
    """X-27 / R-06: a China-domiciled ADR is scored (never excluded) with a SOFT penalty that is visible as a reason."""
    baba = _cand("BABA")
    baba.country = "CN"
    cands = score_universe(_universe(baba), hyp)
    c = next(x for x in cands if x.symbol == "BABA")
    pen = [p for p in c.penalties if p.factor_key == "geopolitical_penalty_china"]
    assert c.action != "excluded" and pen and pen[0].contribution == -10 and "X-27" in pen[0].rule_id
