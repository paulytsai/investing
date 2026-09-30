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
