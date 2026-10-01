"""Part 1: how much of each stock's variance is multiple vs fundamental?

Writes ``data/volstudy/out/decomp_by_stock.csv`` and ``decomp_by_sector.csv``.
"""

from __future__ import annotations

import pandas as pd

from investing.volstudy import data
from investing.volstudy import decompose as dc

OUT = data.CACHE / "out"
SINCE = "2000-01-01"
HORIZONS = {"Q": ("QE", 4), "A": ("YE", 1)}


def run() -> tuple[pd.DataFrame, pd.DataFrame]:
    rows = []
    for sym in data.SP100:
        panel = dc.daily_panel(sym)
        for h, (freq, ppy) in HORIZONS.items():
            ch = dc.period_changes(panel, freq)
            ch = ch[ch.index >= SINCE]
            for key in dc.FUNDAMENTALS:
                r = dc.variance_decomp(ch, key, ppy)
                if r:
                    rows.append({"sym": sym, "sector": data.sector(sym), "horizon": h, "fund": key, **r})
    by_stock = pd.DataFrame(rows)
    num = ["vol_v", "vol_m", "vol_f", "rho_mf", "beta_f", "r2_f", "m_gt_f"]
    by_sector = by_stock.groupby(["horizon", "fund", "sector"])[num].median()
    by_sector["n_stocks"] = by_stock.groupby(["horizon", "fund", "sector"]).size()
    OUT.mkdir(parents=True, exist_ok=True)
    by_stock.to_csv(OUT / "decomp_by_stock.csv", index=False)
    by_sector.to_csv(OUT / "decomp_by_sector.csv")
    return by_stock, by_sector


if __name__ == "__main__":
    _, sec = run()
    pd.set_option("display.width", 200)
    print(sec.round(2).to_string())
