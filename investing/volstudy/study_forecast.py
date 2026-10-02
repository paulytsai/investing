"""Part 2: does the multiple/fundamental split help forecast forward vol?

Pooled log-vol regressions on month-end samples across the S&P 100,
evaluated out of sample with an expanding window (train on targets that end
before the test year begins, test on that year).

Models (h = forecast horizon in trading days):
  HAR   log RV_fwd ~ log rv21 + log rv63 + log rv252           (total vol)
  HAR_EARN  HAR + earn_h + log sqrt(rv63^2 + earn_h * J^2 / h)   (calendar only)
  SPLIT log RV_fwd ~ log dv21 + log dv63 + log dv252            (multiple vol)
                     + log sqrt(dv63^2 + earn_h * J^2 / h)      (+ scheduled
                     + earn_h                                     earnings jump)
  FUND  SPLIT + log sf_rev + log sf_oi + log sm_rev + mz         (accounting
                                                                 fundamentals)
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from investing.volstudy import data
from investing.volstudy import features as fe

OUT = data.CACHE / "out"
TEST_YEARS = range(2008, 2027)


def panel(h: int) -> pd.DataFrame:
    path = OUT / "features.pkl"
    if path.exists():
        allf = pd.read_pickle(path)
    else:
        allf = pd.concat([fe.build(s) for s in data.SP100])
        OUT.mkdir(parents=True, exist_ok=True)
        allf.to_pickle(path)
    a = allf.rename_axis("date").reset_index()
    me = a.groupby(["sym", a["date"].dt.to_period("M")]).tail(1).set_index("date")
    df = pd.DataFrame({"sym": me["sym"], "sector": me["sector"], "date": me.index})
    lg = lambda s: np.log(s.clip(lower=1e-3))
    for c in ("rv21", "rv63", "rv252", "dv21", "dv63", "dv252", "sf_rev", "sf_oi", "sm_rev"):
        df[c] = lg(me[c])
    df["earn"] = me[f"earn{h}"]
    df["struct"] = 0.5 * np.log(me["dv63"] ** 2 + me[f"earn{h}"] * me["jv"] ** 2 / h)
    # same jump term built from total vol, i.e. earnings calendar without the split
    df["struct_tot"] = 0.5 * np.log(me["rv63"] ** 2 + me[f"earn{h}"] * me["jv"] ** 2 / h)
    df["mz"] = me["mz"].clip(-4, 4)
    df["y"] = lg(me[f"y{h}"])
    # date the target window ends (for leakage-free training sets)
    df["y_end"] = df["date"] + pd.Timedelta(days=int(h * 1.5))
    return df.replace([np.inf, -np.inf], np.nan)


MODELS = {
    "HAR": ["rv21", "rv63", "rv252"],
    # control: HAR plus the earnings calendar and typical jump size, no split
    "HAR_EARN": ["rv21", "rv63", "rv252", "earn", "struct_tot"],
    "SPLIT": ["dv21", "dv63", "dv252", "struct", "earn"],
    "FUND": ["dv21", "dv63", "dv252", "struct", "earn", "sf_rev", "sf_oi", "sm_rev", "mz"],
}


def _ols(X: np.ndarray, y: np.ndarray) -> np.ndarray:
    X1 = np.column_stack([np.ones(len(X)), X])
    return np.linalg.lstsq(X1, y, rcond=None)[0]


def oos(df: pd.DataFrame) -> pd.DataFrame:
    cols = sorted({c for v in MODELS.values() for c in v})
    d = df.dropna(subset=cols + ["y"]).copy()
    for name, xs in MODELS.items():
        d[f"p_{name}"] = np.nan
        for yr in TEST_YEARS:
            tr = d[d["y_end"] < f"{yr}-01-01"]
            te = d["date"].dt.year == yr
            if len(tr) < 500 or not te.any():
                continue
            b = _ols(tr[xs].values, tr["y"].values)
            d.loc[te, f"p_{name}"] = b[0] + d.loc[te, xs].values @ b[1:]
    return d.dropna(subset=[f"p_{m}" for m in MODELS])


def r2(y, p):
    return 1 - ((y - p) ** 2).sum() / ((y - y.mean()) ** 2).sum()


def summarize(d: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for grp, g in [("ALL", d), *d.groupby("sector")]:
        row = {"sector": grp, "n": len(g), "stocks": g["sym"].nunique()}
        for m in MODELS:
            row[f"R2_{m}"] = r2(g["y"], g[f"p_{m}"])
            row[f"RMSE_{m}"] = np.sqrt(((g["y"] - g[f"p_{m}"]) ** 2).mean())
        rows.append(row)
    return pd.DataFrame(rows).set_index("sector")


def coefficients(df: pd.DataFrame) -> pd.DataFrame:
    """Full-sample FUND coefficients, pooled and by sector (in-sample, descriptive)."""
    xs = MODELS["FUND"]
    d = df.dropna(subset=xs + ["y"])
    out = {"ALL": _ols(d[xs].values, d["y"].values)}
    for s, g in d.groupby("sector"):
        if len(g) > 300:
            out[s] = _ols(g[xs].values, g["y"].values)
    return pd.DataFrame(out, index=["const", *xs]).T


def run(h: int):
    df = panel(h)
    d = oos(df)
    s = summarize(d)
    c = coefficients(df)
    s.to_csv(OUT / f"forecast_oos_h{h}.csv")
    c.to_csv(OUT / f"forecast_coefs_h{h}.csv")
    d.to_pickle(OUT / f"forecast_preds_h{h}.pkl")
    return s, c


if __name__ == "__main__":
    pd.set_option("display.width", 220)
    for h in (21, 63):
        s, c = run(h)
        print(f"\n=== horizon {h}d: out-of-sample R^2 of log forward RV ===")
        print(s.round(3).to_string())
        print(c.round(3).to_string())
