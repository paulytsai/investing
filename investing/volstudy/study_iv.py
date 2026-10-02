"""Part 3: test against actual option prices (CBOE single-stock vol indices).

CBOE's VXAPL / VXAZN / VXGOG / VXGS / VXIBM are VIX-methodology 30-day
implied vols, i.e. one-month variance-swap rates. For each month-end we
short one month of variance at that strike and hold it 21 trading days:

    P&L (vega-notional units, vol pts) = (K^2 - RV^2) / (2K),   K = IV

and ask whether the decomposition tells us *when* the short is rich.

Implied multiple vol: strip the expected earnings jump out of the implied
variance (the TTM fundamental is constant except at announcements):

    IVm^2 = IV^2 - 1{earnings within 21d} * J^2 / 21

and compare it with what the multiple has actually been doing / is forecast
to do. Forecast models are refit each year on the full S&P 100 panel using
only data that was available before that year.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from investing.volstudy import data
from investing.volstudy import features as fe
from investing.volstudy import study_forecast as sf

OUT = data.CACHE / "out"
H = 21
SPLIT_D = ["dv21", "dv63", "dv252"]  # model for forward *multiple* vol


def _yearly_models(df: pd.DataFrame) -> dict:
    """Per test year: (coef, resid var) for total-vol SPLIT and multiple-vol model."""
    allf = pd.read_pickle(OUT / "features.pkl")
    a = allf.rename_axis("date").reset_index()
    me = a.groupby(["sym", a["date"].dt.to_period("M")]).tail(1).set_index("date")
    df = df.copy()
    df["yd"] = np.log(me[f"yd{H}"].clip(lower=1e-3)).values
    models = {}
    for yr in range(2011, 2027):
        tr = df[df["y_end"] < f"{yr}-01-01"]
        out = {}
        for name, xs, y in (("tot", sf.MODELS["SPLIT"], "y"), ("mult", SPLIT_D, "yd")):
            t = tr.dropna(subset=xs + [y])
            b = sf._ols(t[xs].values, t[y].values)
            res = t[y].values - (b[0] + t[xs].values @ b[1:])
            out[name] = (b, res.var())
        models[yr] = out
    return models


def _apply(b, s2, X):
    return np.exp(b[0] + X @ b[1:] + 0.5 * s2)  # lognormal mean correction


def build() -> pd.DataFrame:
    panel = sf.panel(H)
    models = _yearly_models(panel)
    rows = []
    for idx, sym in data.CBOE_IV.items():
        f = fe.build(sym, horizons=(H,))
        f["iv"] = data.cboe_iv(idx).reindex(f.index)
        a = f.reset_index()
        me = a.groupby(a["date"].dt.to_period("M")).tail(1).set_index("date")
        me = me[me.index >= "2011-01-31"].dropna(subset=["iv", f"y{H}", "dv252", "jv"])
        lg = lambda s: np.log(s.clip(lower=1e-3))
        X = pd.DataFrame({c: lg(me[c]) for c in ("dv21", "dv63", "dv252")})
        X["earn"] = me[f"earn{H}"]
        X["struct"] = 0.5 * np.log(me["dv63"] ** 2 + me[f"earn{H}"] * me["jv"] ** 2 / H)
        for d, x in X.iterrows():
            m = models[d.year]
            r = me.loc[d]
            jump2 = r[f"earn{H}"] * r["jv"] ** 2 / H
            f_tot = _apply(*m["tot"], x[sf.MODELS["SPLIT"]].values)
            f_mult = _apply(*m["mult"], x[SPLIT_D].values)
            iv = r["iv"]
            rows.append({
                "date": d, "sym": sym, "iv": iv, "rv_fwd": r[f"y{H}"],
                "earn": r[f"earn{H}"], "jump_vol": np.sqrt(jump2),
                "f_tot": f_tot, "f_mult": f_mult, "dv63": r["dv63"],
                "iv_mult": np.sqrt(max(iv**2 - jump2, 1e-4)),
                "sf_rev": r["sf_rev"], "sm_rev": r["sm_rev"],
            })
    d = pd.DataFrame(rows)
    d["pnl"] = (d["iv"] ** 2 - d["rv_fwd"] ** 2) / (2 * d["iv"])  # short var, vega units
    d["sig_naive"] = d["iv"] / d["dv63"] - 1           # IV vs trailing RV
    d["sig_simple"] = d["iv"] / np.sqrt(d["dv63"] ** 2 + d["jump_vol"] ** 2) - 1  # no model, no split
    d["sig_model"] = d["iv"] / d["f_tot"] - 1          # IV vs SPLIT forecast
    d["sig_mult"] = d["iv_mult"] / d["f_mult"] - 1     # implied vs forecast multiple vol
    d["fair_iv"] = np.sqrt(d["f_mult"] ** 2 + d["jump_vol"] ** 2)
    return d


def _t(x: pd.Series) -> float:
    return x.mean() / x.std() * np.sqrt(len(x)) if len(x) > 2 else np.nan


def evaluate(d: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Signal terciles (expanding, per-name, no look-ahead) and simple rules."""
    d = d.sort_values("date").copy()
    rules = []
    rules.append(("always short", d["pnl"]))
    for sig in ("sig_naive", "sig_model", "sig_mult"):
        # expanding per-name tercile rank using only prior observations
        rk = d.groupby("sym")[sig].transform(
            lambda s: s.expanding().apply(lambda w: (w[:-1] < w[-1]).mean() if len(w) > 12 else np.nan, raw=True)
        )
        d[f"{sig}_rk"] = rk
        rules.append((f"{sig}: top tercile", d.loc[rk > 2 / 3, "pnl"]))
        rules.append((f"{sig}: bottom tercile", d.loc[rk < 1 / 3, "pnl"]))
        rules.append((f"{sig} > 0 (absolute)", d.loc[d[sig] > 0, "pnl"]))
        rules.append((f"{sig} <= 0 (absolute)", d.loc[d[sig] <= 0, "pnl"]))
    tab = pd.DataFrame(
        [{"rule": n, "n": len(x), "mean_pnl_volpts": 100 * x.mean(), "t": _t(x),
          "hit": (x > 0).mean(), "sharpe_ann": x.mean() / x.std() * np.sqrt(12)} for n, x in rules]
    ).set_index("rule")
    # predictive regressions: pnl on each signal, pooled
    reg = []
    for sig in ("sig_naive", "sig_model", "sig_mult"):
        x = d[[sig, "pnl"]].dropna()
        b = np.polyfit(x[sig], x["pnl"], 1)
        corr = x[sig].corr(x["pnl"])
        reg.append({"signal": sig, "slope": b[0], "corr": corr, "t_corr": corr * np.sqrt((len(x) - 2) / (1 - corr**2))})
    return tab, pd.DataFrame(reg).set_index("signal")


def spreads(d: pd.DataFrame) -> pd.DataFrame:
    """Same-month top-minus-bottom tercile P&L per signal, with sub-periods."""
    d = d.sort_values("date").copy()
    out = []
    for sig in ("sig_naive", "sig_simple", "sig_model", "sig_mult"):
        rk = d.groupby("sym")[sig].transform(
            lambda s: s.expanding().apply(lambda w: (w[:-1] < w[-1]).mean() if len(w) > 12 else np.nan, raw=True)
        )
        for label, keep in (("all", d["date"].dt.year > 0), ("ex-2020", d["date"].dt.year != 2020)):
            g = d[keep]
            top = g[rk[keep] > 2 / 3].groupby("date")["pnl"].mean()
            bot = g[rk[keep] < 1 / 3].groupby("date")["pnl"].mean()
            ls = (top - bot).dropna()
            pooled = g.loc[rk[keep] > 2 / 3, "pnl"].mean() - g.loc[rk[keep] < 1 / 3, "pnl"].mean()
            out.append({"signal": sig, "sample": label, "months": len(ls), "top_minus_bottom_volpts": 100 * ls.mean(),
                        "t": _t(ls), "pooled_top_minus_bottom_volpts": 100 * pooled, "spearman_signal_pnl": g[sig].corr(g["pnl"], method="spearman")})
    return pd.DataFrame(out).set_index(["signal", "sample"])


def run():
    d = build()
    tab, reg = evaluate(d)
    reg = reg.join(spreads(d).xs("all", level="sample"))
    spreads(d).to_csv(OUT / "iv_backtest_spreads.csv")
    per_name = d.groupby("sym").agg(
        n=("pnl", "size"), iv=("iv", "mean"), rv=("rv_fwd", "mean"), fair_iv=("fair_iv", "mean"),
        pnl_volpts=("pnl", lambda x: 100 * x.mean()), sf_rev=("sf_rev", "median"), sm_rev=("sm_rev", "median"),
    )
    d.to_csv(OUT / "iv_backtest_rows.csv", index=False)
    tab.to_csv(OUT / "iv_backtest_rules.csv")
    reg.to_csv(OUT / "iv_backtest_regs.csv")
    per_name.to_csv(OUT / "iv_backtest_by_name.csv")
    return d, tab, reg, per_name


if __name__ == "__main__":
    pd.set_option("display.width", 200)
    d, tab, reg, per = run()
    print(per.round(3).to_string()); print(tab.round(3).to_string()); print(reg.round(3).to_string())
