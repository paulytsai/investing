from engine.frameworks.danoff import danoff_read, danoff_sector, smile, years_to_double


def test_years_to_double():
    assert abs(years_to_double(0.15) - 4.96) < 0.05 and years_to_double(0.0) is None and years_to_double(None) is None


def test_smile_and_frown():
    face, why = smile({"eps_growth_ttm": 0.4, "rev_accel": 0.05, "beat_streak": 6, "llm_guidance": 1.5})
    assert face == "smile" and any("guidance is going up" in w for w in why)
    face2, _ = smile({"eps_growth_ttm": -0.2, "rev_accel": -0.1, "beat_streak": 1, "text_guidance": -1.0})
    assert face2 == "frown"


def test_danoff_read_owns_the_compounder_and_passes_on_the_ex_growth():
    r = danoff_read({"eps_cagr_3y": 0.30, "eps_growth_ttm": 0.35, "rev_accel": 0.03, "beat_streak": 7, "llm_guidance": 1.0, "roic_ttm": 0.4, "gross_margin": 0.7,
                     "llm_is_number_one": True, "pe_ttm": 35, "peg": 1.1, "run_up_12m": 0.9})
    assert r["score"] >= 70 and r["face"] == "smile" and r["years_to_double"] < 3 and "not missed" in " ".join(r["lines"])
    assert r["verdict"].startswith("Danoff would own")
    r2 = danoff_read({"eps_cagr_3y": -0.05, "eps_growth_ttm": -0.1, "rev_accel": -0.08, "beat_streak": 2, "roic_ttm": 0.05, "gross_margin": 0.2, "pe_ttm": 12})
    assert r2["face"] == "frown" and "sell or swap" in r2["verdict"]
    r3 = danoff_read({"eps_cagr_3y": 2.5, "eps_growth_ttm": 0.10})          # a 250% CAGR off a trough is capped to a run-rate
    assert r3["growth_used"] < 0.3


def test_danoff_sector_aggregates():
    reads = [danoff_read({"eps_cagr_3y": 0.3, "eps_growth_ttm": 0.3, "rev_accel": 0.05, "beat_streak": 6, "roic_ttm": 0.3, "gross_margin": 0.6}),
             danoff_read({"eps_cagr_3y": 0.02, "eps_growth_ttm": -0.2, "rev_accel": -0.1, "beat_streak": 1})]
    s = danoff_sector(reads, ["AAA", "BBB"])
    assert s["best_of_breed"] == "AAA" and abs(s["share_smiling"] - 0.5) < 1e-9 and "Danoff view" in s["verdict"]
