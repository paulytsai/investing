"""Part 6: redo the decomposition with street EPS; measure earnings response.

Outputs ``street_decomp_by_sector.csv`` and ``erc_by_sector.csv``.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import statsmodels.api as sm

from investing.volstudy import consensus as cs
from investing.volstudy import data
from investing.volstudy import decompose as dc

OUT = data.CACHE / "out"
SINCE = "2000-01-01"
CLIP = 0.2  # winsorize EPS surprises at +/-20%


def decomp() -> pd.DataFrame:
    rows = []
    for sym in data.SP100:
        p = cs.street_panel(sym)
        for h, (freq, ppy) in {"Q": ("QE", 4), "A": ("YE", 1)}.items():
            lv = p[["v", "m_st", "f_st"]].groupby(pd.Grouper(freq=freq)).last().diff()
            lv = lv[lv.index >= SINCE].rename(columns={"m_st": "m_street", "f_st": "f_street"})
            r = dc.variance_decomp(lv, "street", ppy)
            if r:
                rows.append({"sym": sym, "sector": data.sector(sym), "horizon": h, **r})
    return pd.DataFrame(rows)


def erc(rx: pd.DataFrame) -> pd.DataFrame:
    """Price move per 1% EPS surprise, by sector, and how much it explains."""
    d = rx.dropna(subset=["surprise_pct", "react"]).copy()
    d = d[d["date"] >= SINCE]
    d["s"] = d["surprise_pct"].clip(-CLIP, CLIP)
    out = []
    for grp, g in [("ALL", d), *d.groupby("sector")]:
        X = sm.add_constant(g["s"])
        groups = g["sym"].factorize()[0]
        fit = (sm.OLS(g["react"], X).fit(cov_type="cluster", cov_kwds={"groups": groups})
               if groups.max() > 0 else sm.OLS(g["react"], X).fit(cov_type="HC1"))
        out.append({
            "group": grp, "n": len(g),
            "move_per_1pct_beat": fit.params["s"],  # stock move (%) per 1% EPS surprise
            "t": fit.tvalues["s"], "r2": fit.rsquared,
            "avg_move_beat_pct": 100 * g.loc[g["s"] > 0.01, "react"].mean(),
            "avg_move_miss_pct": 100 * g.loc[g["s"] < -0.01, "react"].mean(),
            "abs_move_pct": 100 * g["react"].abs().mean(),
            "surprise_sd_pct": 100 * g["s"].std(), "median_abs_surprise_pct": 100 * g["s"].abs().median(),
            "react_sd_pct": 100 * g["react"].std(), "beat_rate": (g["s"] > 0).mean(),
        })
    return pd.DataFrame(out).set_index("group")


def run():
    dec = decomp()
    gaap = pd.read_csv(OUT / "decomp_by_stock.csv")
    num = ["vol_v", "vol_m", "vol_f", "rho_mf", "r2_f"]
    t = dec.groupby(["horizon", "sector"])[num].median()
    g = gaap[gaap["fund"] == "ni"].groupby(["horizon", "sector"])[["vol_f", "rho_mf", "r2_f"]].median()
    t = t.join(g.add_suffix("_gaap"))
    allrow = dec.groupby("horizon")[num].median().join(gaap[gaap["fund"] == "ni"].groupby("horizon")[["vol_f", "rho_mf", "r2_f"]].median().add_suffix("_gaap"))
    spy = data.prices("SPY")
    rx = pd.concat([cs.reactions(s, spy).assign(sector=data.sector(s)) for s in data.SP100])
    e = erc(rx)
    OUT.mkdir(parents=True, exist_ok=True)
    dec.to_csv(OUT / "street_decomp_by_stock.csv", index=False)
    t.to_csv(OUT / "street_decomp_by_sector.csv")
    allrow.to_csv(OUT / "street_decomp_all.csv")
    rx.to_csv(OUT / "earnings_reactions.csv", index=False)
    e.to_csv(OUT / "erc_by_sector.csv")
    return allrow, t, e


if __name__ == "__main__":
    pd.set_option("display.width", 220)
    a, t, e = run()
    print(a.round(3).to_string()); print(t.round(2).to_string()); print(e.round(3).to_string())
