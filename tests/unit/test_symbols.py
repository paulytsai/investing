from engine.symbols import read_symbols, split_regions


def test_tickers_and_files_in_any_mix(tmp_path):
    f = tmp_path / "watch.csv"
    f.write_text("Name,Ticker,Weight\nNVIDIA,nvda,0.1\nOracle,NASDAQ:ORCL,0.2\nToyota,7203.T,0.1\n,,\n")
    g = tmp_path / "plain.txt"
    g.write_text("AVGO\nnvda\n")
    assert read_symbols(f"MSFT,{f} @{g}") == ["MSFT", "NVDA", "ORCL", "7203", "AVGO"]
    assert read_symbols(["META", str(g)]) == ["META", "AVGO", "NVDA"]
    assert read_symbols("") == []


def test_first_column_when_no_header_and_tsv(tmp_path):
    f = tmp_path / "codes.tsv"
    f.write_text("AMD\t1\nMU\t2\n")
    assert read_symbols(str(f)) == ["AMD", "MU"]
    h = tmp_path / "hdr.csv"
    h.write_text("code,name\n6758,Sony\nTSM,Taiwan Semi\n")
    assert read_symbols(str(h)) == ["6758", "TSM"]
    assert split_regions(["6758", "TSM", "7203"]) == {"US": ["TSM"], "JP": ["6758", "7203"]}
