"""Part 4: does a multiple-vol shock fade faster when fundamentals are stable?

The arbitrage thesis needs this: if implied vol tracks recent realized vol,
and multiple-vol spikes in stable-earnings names revert faster, options on
those names are systematically rich right after a spike.

At each month-end, regress the subsequent change in multiple (ex-earnings)
vol on the current shock:

    log(dv_fwd21 / dv21) = a + b * log(dv21 / dv252) + e

b = -1 is full reversion to the 1-year level within a month, b = 0 is a
random walk. Grouped by sector and by terciles of trailing revenue vol.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import statsmodels.api as sm

from investing.volstudy import data

OUT = data.CACHE / "out"


def panel() -> pd.DataFrame:
    allf = pd.read_pickle(OUT / "features.pkl")
    a = allf.rename_axis("date").reset_index()
    me = a.groupby(["sym", a["date"].dt.to_period("M")]).tail(1)
    d = pd.DataFrame({
        "date": me["date"], "sym": me["sym"], "sector": me["sector"],
        "shock": np.log(me["dv21"] / me["dv252"]),
        "fwd": np.log(me["yd21"] / me["dv21"]),
        "sf_rev": me["sf_rev"], "sf_oi": me["sf_oi"],
    }).replace([np.inf, -np.inf], np.nan).dropna()
    d = d[d["date"] >= "2002-01-01"]
    # stability terciles by month, cross-sectionally (no look-ahead)
    d["rev_stab"] = d.groupby("date")["sf_rev"].transform(lambda s: pd.qcut(s.rank(method="first"), 3, labels=["stable", "mid", "volatile"]))
    return d


def _fit(g: pd.DataFrame) -> dict:
    X = sm.add_constant(g["shock"])
    r = sm.OLS(g["fwd"], X).fit(cov_type="cluster", cov_kwds={"groups": g["date"].factorize()[0]})
    sp = g[g["shock"] > np.log(1.5)]  # spikes: 21d multiple vol > 1.5x its 1y level
    return {"n": len(g), "b": r.params["shock"], "t_b": r.tvalues["shock"],
            "half_gap_left": float(np.exp(r.params["shock"] * np.log(2))),  # after a 2x spike, fraction of log gap left
            "spike_n": len(sp), "spike_fwd_change": float(np.exp(sp["fwd"].mean()) - 1) if len(sp) else np.nan}


def run() -> pd.DataFrame:
    d = panel()
    rows = [{"group": "ALL", **_fit(d)}]
    rows += [{"group": f"sector: {s}", **_fit(g)} for s, g in d.groupby("sector") if len(g) > 300]
    rows += [{"group": f"revenue vol: {s}", **_fit(g)} for s, g in d.groupby("rev_stab", observed=True)]
    out = pd.DataFrame(rows).set_index("group")
    out.to_csv(OUT / "reversion.csv")
    return out


if __name__ == "__main__":
    pd.set_option("display.width", 200)
    print(run().round(3).to_string())
