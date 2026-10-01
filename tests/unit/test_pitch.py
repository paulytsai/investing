"""The pitch layer: deterministic prose without a model call; the Claude path from a canned structured answer (no API)."""
import pandas as pd

from engine.reports.charts import build_rebased_chart, build_valuation_chart
from engine.research import pitch as P
from engine.research.schemas import Claim, SectorPitch, StockPitch
from engine.screen.models import IdeaCandidate, ReasonComponent
from engine.screen.sector_index import equal_weight_index, member_table, rebased


def _cand(**kw):
    m = {"pe_ttm": 20.0, "eps_ttm": 5.0, "pe_own_pctile": 12.0, "pe_band_median": 30.0, "pe_band_n": 2000, "rev_cagr_3y": 0.25, "rev_growth_ttm": 0.2,
         "eps_cagr_3y": 0.30, "pe_history": [["2024-01-31", 25.0], ["2024-02-29", 22.0], ["2024-03-31", 20.0]],
         "valuation_cycle": {"basis": "pe", "current": 20.0, "percentile": 12.0, "low": 18.0, "median": 30.0, "high": 45.0, "n_years": 10.0, "phase": "trough",
                             "sentence": "At 20.0x trailing earnings the stock is near the bottom of its own range."},
         "implied_growth": {"basis": "eps", "implied_pct": 11.0, "implied_pct_norm": -2.0, "years": 5, "pe_exit": 16.0, "pe_norm": 30.0, "pe_exit_source": "long-run market multiple of 16x",
                            "required_return_pct": 7.0, "trailing_pct": 30.0, "trailing_label": "EPS growth", "gap_pp": 19.0, "verdict": "priced for less than it has delivered",
                            "hypergrowth_ok": None, "note": "At 20.0x trailing earnings..."}}
    rs = [ReasonComponent(rule_id="P-24", factor_key="rev_cagr_3y", label="3y revenue CAGR", kind="factor", angle="story_growth", value=0.25, unit="pct", contribution=1.2, rank_pct=90),
          ReasonComponent(rule_id="F-13", factor_key="pe_own_pctile", label="own P/E percentile", kind="factor", angle="on_sale", value=12.0, unit="pct", contribution=0.9, rank_pct=88),
          ReasonComponent(rule_id="F-07", factor_key="roic_ttm", label="ROIC", kind="factor", angle="quality", value=0.3, unit="pct", contribution=0.5, rank_pct=80),
          ReasonComponent(rule_id="F-09", factor_key="insider_net_buy", label="insider selling", kind="factor", angle="alignment", value=-0.1, unit="pct", contribution=-0.4, rank_pct=20)]
    d = dict(security_id="US:1", symbol="ACME", name="Acme Corp", region="US", as_of=pd.Timestamp("2026-09-25").date(), sector="Technology", industry="Software",
             theme_sector="tech_other", asset_type="non_commodity", ai_layer="none", market_cap=5e10, price=100.0, currency="USD", metrics=m, reasons=rs,
             idea_strength=76.0, rank=3, action="buy-in-stages", action_reason="Idea Strength 76 ≥ 70 and on-sale angle 80 ≥ 50; no avoid gate", eligible=True)
    d.update(kw)
    return IdeaCandidate(**d)


def test_deterministic_stock_pitch_has_every_section_and_the_implied_growth():
    c = _cand()
    story = {"what": "Acme sells widgets to everyone.", "earnings": "Revenue grew 25% a year.", "driving": ["Claude's reading of the latest call: demand strong", "“Backlog is at a record.” (transcript)"],
             "quality": "Good.", "risks": ["pricing pressure", "a big customer leaving"], "pay": "20x."}
    d = P.stock_pitch(c, story, None, 0.08, None, use_llm=False)
    assert d["source"] == "engine"
    for k in ("opening", "the_business", "why_now", "valuation_in_cycle", "what_the_price_assumes", "three_reasons", "what_breaks_it", "closing"):
        assert d[k]
    assert "11% a year" in d["what_the_price_assumes"] and "usual 30x" in d["what_the_price_assumes"]
    assert len(d["three_reasons"]) == 3
    assert "The latest call, in short: demand strong" in d["why_now"] and "“Backlog is at a record.”" in d["why_now"]
    assert d["what_breaks_it"] == "Pricing pressure. A big customer leaving."
    assert "near the bottom" in d["valuation_in_cycle"]


def test_claude_stock_pitch_counts_untraceable_numbers(monkeypatch):
    c = _cand()
    canned = StockPitch(opening="Acme at 20x is the cheapest it has been in a decade.", the_business="It sells widgets.", why_now="Revenue grew 25% a year; backlog is at a record.",
                        valuation_in_cycle="At 20x it sits at the 12th percentile of ten years.", what_the_price_assumes="The price assumes 11% a year; it has delivered 30%.",
                        three_reasons=["Growth of 25% a year.", "Insiders sold a little.", "Returns on capital of 30%."], what_breaks_it="A lost customer.",
                        closing="Buy in stages, 8% of the book. Also, 999 widgets were sold last year.",
                        numbers_used=[Claim(text="revenue CAGR 25%", value=0.25, period="FY2025", source="FinancialRead.rev_cagr_3y"),
                                      Claim(text="made up", value=999, period="", source="nowhere")])
    monkeypatch.setattr(P, "parse_structured", lambda *a, **k: canned)
    monkeypatch.setattr(P, "build_context", lambda c, phases=None, want_transcript=True: [{"role": "user", "content": [{"type": "text", "text": '<doc id="FinancialRead ACME" period="x" source="engine">\n{"rev_cagr_3y": 0.25, "pe_ttm": 20.0, "pe_own_pctile": 12.0}\n</doc>'}]}])
    d = P.stock_pitch(c, {"what": "x"}, None, 0.08, None, use_llm=True)
    assert d["source"] == "claude"
    assert d["numbers_used"][0]["verified"] is True and d["numbers_used"][1]["verified"] is False
    assert d["unverified_count"] >= 1          # the 999 traces to nothing; 20x, 25%, 12th, 11%, 30%, 8% all trace to the context docs


def test_sector_pitch_fallback_and_claude(monkeypatch):
    sc = {"sector": "energy", "label": "Energy — oil, gas, services", "stance": "overweight", "score": 70.0, "n_members": 3, "n_eligible": 3, "slots": 2,
          "rationale": ["median revenue growth TTM +13%"], "bet": {"market_weight": 0.05, "recommended_weight": 0.075, "active_bet_pp": 2.5, "kelly_implied_weight": 0.1, "summary": "s",
                                                                     "cycle": {"phase": "expanding", "theme": "capex_discipline", "breadth_now": 12.0, "breadth_peak": 15.0}},
          "cycle_read": {"verdict": "Oil & gas: mid-cycle, margins rising."}, "danoff": {}, "inputs": {}}
    rows = [{"symbol": "XOM", "name": "Exxon", "strength": 70.0, "action": "buy-in-stages", "ret_window": 0.3, "pe_pctile": 40.0, "pe": 15.0, "weight": 0.1, "cycle_phase": "normal"},
            {"symbol": "CVX", "name": "Chevron", "strength": 60.0, "action": "watch", "ret_window": -0.1, "pe_pctile": 50.0, "pe": 14.0, "weight": None, "cycle_phase": "normal"}]
    d = P.sector_pitch(sc, rows, ["XOM"], "2026-09-25", window_text="the last 3 years", use_llm=False)
    assert d["source"] == "engine" and "7.5% of the book" in d["the_bet"] and "+2.5 points" in d["the_bet"] and "XOM carries it" in d["names"]
    assert "mid-cycle" in d["where_we_are"] and "overweight" in d["the_case"].lower()
    canned = SectorPitch(where_we_are="Mid-cycle.", the_case="Margins are rising.", the_bet="7.5% against 5%.", names="XOM leads.", what_would_change_the_call="A capex binge.")
    monkeypatch.setattr(P, "parse_structured", lambda *a, **k: canned)
    d2 = P.sector_pitch(sc, rows, ["XOM"], "2026-09-25", use_llm=True)
    assert d2["source"] == "claude" and d2["unverified_count"] == 0


def test_equal_weight_index_and_rebased_chart():
    idx = pd.bdate_range("2024-01-01", periods=300)
    a = pd.Series(100 * (1.001 ** pd.RangeIndex(300)).astype(float), index=idx)
    b = pd.Series(100 * (0.999 ** pd.RangeIndex(300)).astype(float), index=idx)
    tr = pd.DataFrame({"US:A": a, "US:B": b})
    ew = equal_weight_index(tr)
    assert abs(ew.iloc[0] - 100 * (1 + (0.001 - 0.001) / 2)) < 1e-6          # first day's mean return ≈ 0
    # daily-rebalanced equal weight of a +0.1%/day and a −0.1%/day name: ≈ flat (slightly below 100 from volatility drag)
    assert 99 < ew.iloc[-1] < 100.5
    assert abs(rebased(a).iloc[0] - 100) < 1e-9
    spec = build_rebased_chart("t", "T", {"Index": ew, "S&P": rebased(b), "A": rebased(a)}, bold={"Index", "A"}, dashed={"S&P"})
    assert not spec["empty"] and [t["name"] for t in spec["traces"]] == ["S&P", "Index", "A"] and spec["panels"][0]["log"] is True
    rows = member_table([{"security_id": "US:A", "symbol": "A", "name": "A co", "idea_strength": 50, "action": "watch", "rank": 1, "metrics": {}, "market_cap": 1, "eligible": True}],
                        {"A": rebased(a)}, {"US:A": 0.1})
    assert rows[0]["weight"] == 0.1 and rows[0]["ret_window"] > 0.3


def test_valuation_chart_spec():
    spec = build_valuation_chart("v-X", "X", [["2024-01-31", 25.0], ["2024-02-29", 22.0]], {"basis": "pe", "current": 22.0, "percentile": 10.0, "low": 18.0, "median": 30.0, "high": 45.0, "n_years": 10})
    assert not spec["empty"] and spec["traces"][1]["name"] == "now" and any(s["type"] == "rect" for s in spec["shapes"]) and "10th percentile" in spec["subtitle"]
    assert build_valuation_chart("v-Y", "Y", [], None)["empty"]
