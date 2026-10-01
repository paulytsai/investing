"""Part 5: today's cross-section, live IBKR 30-day implied vol vs. the model.

Input: ``investing/volstudy/snapshots/ibkr_iv_snapshot_<date>.csv`` (sym, iv, hv30), collected
from the IBKR connector's ``implied_vol_underlying`` field. For each name:

  fair_iv  = sqrt(forecast multiple vol^2 + scheduled earnings jump^2)
  iv_mult  = implied vol with the expected earnings jump stripped out
  sig_mult = iv_mult / forecast multiple vol - 1   (> 0: options look rich)

Forecast models are fit on the whole S&P 100 history (same specs as Part 3).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from investing.volstudy import data
from investing.volstudy import study_forecast as sf
from investing.volstudy import study_iv as si

OUT = data.CACHE / "out"
SNAPSHOTS = Path(__file__).resolve().parent / "snapshots"
H = si.H


def next_earnings(sym: str, asof: pd.Timestamp) -> pd.Timestamp | None:
    rows = json.loads((data.CACHE / f"earn_{sym}.json").read_text())
    future = sorted(pd.Timestamp(r["date"]) for r in rows if pd.Timestamp(r["date"]) > asof)
    return future[0] if future else None


def run(snapshot: str) -> pd.DataFrame:
    snap = pd.read_csv(snapshot)
    asof = pd.Timestamp(snap["asof"].iloc[0])
    models = si._yearly_models(sf.panel(H))
    m = models[max(models)]
    allf = pd.read_pickle(OUT / "features.pkl")
    rows = []
    for _, s in snap.iterrows():
        f = allf[allf["sym"] == s["sym"]].dropna(subset=["dv21", "dv63", "dv252", "jv"])
        if f.empty or not np.isfinite(s["iv"]):
            continue
        last = f.iloc[-1]
        ne = next_earnings(s["sym"], asof)
        # 21 trading days ~ 30 calendar days, matching a 30-day implied vol
        earn = float(ne is not None and (ne - asof).days <= 30)
        jump2 = earn * last["jv"] ** 2 / H
        x = np.log(last[["dv21", "dv63", "dv252"]].astype(float).values)
        struct = 0.5 * np.log(last["dv63"] ** 2 + jump2 * 1.0)
        f_tot = si._apply(*m["tot"], np.r_[x, struct, earn])
        f_mult = si._apply(*m["mult"], x)
        iv_mult = np.sqrt(max(s["iv"] ** 2 - jump2, 1e-4))
        rows.append({
            "sym": s["sym"], "sector": last["sector"], "iv": s["iv"], "hv30_ibkr": s["hv30"],
            "next_earn": ne.date() if ne is not None else None, "earn_in_30d": earn,
            "jump_vol": np.sqrt(jump2), "f_mult": f_mult, "fair_iv": np.sqrt(f_mult**2 + jump2),
            "f_tot": f_tot, "iv_mult": iv_mult, "sig_mult": iv_mult / f_mult - 1,
            "iv_minus_fair": s["iv"] - np.sqrt(f_mult**2 + jump2),
            "sf_rev": last["sf_rev"], "data_through": f.index[-1].date(),
        })
    out = pd.DataFrame(rows).sort_values("sig_mult", ascending=False)
    out.to_csv(OUT / f"live_{asof.date()}.csv", index=False)
    return out


if __name__ == "__main__":
    pd.set_option("display.width", 220)
    snap = sys.argv[1] if len(sys.argv) > 1 else str(sorted(SNAPSHOTS.glob("ibkr_iv_snapshot_*.csv"))[-1])
    out = run(snap)
    cols = ["sym", "sector", "iv", "fair_iv", "iv_mult", "f_mult", "sig_mult", "earn_in_30d", "sf_rev"]
    print(out[cols].round(3).to_string(index=False))
    print(out.groupby("sector")[["iv", "fair_iv", "sig_mult", "iv_minus_fair"]].median().round(3))
