import pandas as pd

from engine.evaluate.run import parse_thesis, placement
from engine.screen.models import IdeaCandidate


def test_parse_thesis_sections_and_plain_text(tmp_path):
    assert parse_thesis(None) == {}
    assert parse_thesis("NVDA is the toll booth of AI compute") == {"*": "NVDA is the toll booth of AI compute"}
    f = tmp_path / "t.md"
    f.write_text("General view.\n\n## NVDA\nToll booth.\n\n## orcl\nAI factories financed by debt.\n")
    t = parse_thesis(str(f))
    assert t["*"] == "General view." and t["NVDA"] == "Toll booth." and t["ORCL"] == "AI factories financed by debt."


def _c(sid, sector, strength, eligible=True):
    return IdeaCandidate(security_id=sid, symbol=sid, region="US", as_of=pd.Timestamp("2026-09-25").date(), asset_type="non_commodity",
                         theme_sector=sector, idea_strength=strength, eligible=eligible, market_cap=1e10, metrics={})


def test_placement_reports_rank_sector_rank_and_choice():
    uni = [_c("A", "ai_chips", 90), _c("B", "ai_chips", 80), _c("C", "energy", 70), _c("D", "energy", 60), _c("E", "energy", 50, eligible=False)]
    p = placement(uni, [uni[1], uni[4]], top=2, max_sector=None, calls=None)
    assert p["B"]["rank"] == 2 and p["B"]["of"] == 5 and p["B"]["sector_rank"] == 2 and p["B"]["sector_of"] == 2 and p["B"]["would_be_chosen"]
    assert p["E"]["rank"] == 5 and not p["E"]["would_be_chosen"] and not p["E"]["eligible"]


def test_pack_and_unpack_roundtrip(tmp_path, monkeypatch):
    import engine.data_sync as ds

    src = tmp_path / "data"
    (src / "pit").mkdir(parents=True)
    (src / "pit" / "prices.parquet").write_bytes(b"x" * 10)
    (src / "raw").mkdir()
    (src / "raw" / "big.json").write_bytes(b"y" * 10)
    monkeypatch.setattr(ds, "DATA_DIR", src)
    arc = ds.pack(tmp_path / "snap.tar.gz")
    dest = tmp_path / "data2"
    monkeypatch.setattr(ds, "DATA_DIR", dest)
    ds.unpack(arc)
    assert (dest / "pit" / "prices.parquet").read_bytes() == b"x" * 10 and not (dest / "raw").exists()


def test_ledger_diff_reports_moves(tmp_path, monkeypatch):
    from engine.evaluate import ledger

    monkeypatch.setattr(ledger, "PATH", tmp_path / "ev.jsonl")
    a = {"symbol": "NVDA", "as_of": "2026-06-30", "strength": 80.0, "rank": 9, "action": "watch", "stance": "neutral", "kelly_weight": 0.05,
         "would_be_chosen": False, "verdict": "mixed", "claims": {"toll booth": "supported", "pricing power": "mixed"}}
    ledger.append([a])
    b = {**a, "as_of": "2026-09-25", "strength": 85.0, "rank": 4, "action": "buy-in-stages", "kelly_weight": 0.15, "would_be_chosen": True,
         "verdict": "supported", "claims": {"toll booth": "supported", "pricing power": "supported", "sovereign demand": "unverifiable"}}
    d = ledger.diff(ledger.previous("NVDA"), b)
    text = " | ".join(d["changes"])
    assert "rank: 9 → 4" in text and "Kelly weight: 5.0% → 15.0%" in text and "'pricing power': mixed → supported" in text and "new claim 'sovereign demand'" in text
    assert ledger.diff(None, b) is None and ledger.history("NVDA")[0]["rank"] == 9


def test_paul_scenarios_override_the_engine_scenarios():
    from engine.backtest.sizing import scenario_block

    class C:
        symbol = "X"
        coverage = 0.95
        metrics = {"rev_cagr_3y": 0.30, "pe_ttm": 28.0, "pe_band_low": 32.0, "pe_band_median": 54.0, "pe_band_high": 91.0, "pe_band_n": 2400}
    ov = {"bull": {"prob": 0.25, "return": 0.80}, "base": {"prob": 0.50, "return": 0.25}, "bear": {"prob": 0.25, "return": -0.40}}
    b = scenario_block(C(), 0.10, 3.0, 0.5, 0.15, override=ov)
    assert abs(b["expected_return"] - 0.225) < 1e-9 and b["scenario_table"][0]["source"] == "Paul's scenario" and "Paul" in b["assumptions"][0]


def test_diff_runs_reports_entries_exits_and_stance_flips(tmp_path):
    import json

    from engine.screen.diff import diff_runs

    def run(name, as_of, cands, chosen, sectors):
        d = tmp_path / name
        d.mkdir()
        (d / "run.json").write_text(json.dumps({"as_of": as_of, "n_scored": 2000}))
        (d / "candidates.json").write_text(json.dumps(cands))
        (d / "sizing.json").write_text(json.dumps({"weights": {c: 0.1 for c in chosen}}))
        (d / "sectors.json").write_text(json.dumps(sectors))
        return d
    a = run("a", "2026-06-30", [{"security_id": "A", "symbol": "AAA", "idea_strength": 80, "action": "watch", "rank": 3}, {"security_id": "B", "symbol": "BBB", "idea_strength": 70, "action": "buy-in-stages", "rank": 5}],
            ["A", "B"], {"ai_chips": {"label": "AI 2 · Chips — x", "stance": "overweight", "bet": {"cycle": {"phase": "expanding"}}}})
    b = run("b", "2026-09-25", [{"security_id": "A", "symbol": "AAA", "idea_strength": 88, "action": "buy-in-stages", "rank": 1}, {"security_id": "C", "symbol": "CCC", "idea_strength": 75, "action": "buy-in-stages", "rank": 4}],
            ["A", "C"], {"ai_chips": {"label": "AI 2 · Chips — x", "stance": "neutral", "bet": {"cycle": {"phase": "off its peak"}}}})
    d = diff_runs(a, b)
    assert d["entered"] == ["CCC"] and d["left"] == ["BBB"] and d["actions"] == ["AAA: watch → buy-in-stages"]
    assert d["stances"] == ["AI 2 · Chips: overweight → neutral"] and d["cycles"] == ["AI 2 · Chips: expanding → off its peak"]
    assert d["moves"][0].startswith("AAA 80 → 88") and not d["unchanged"]
