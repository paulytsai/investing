"""Part 7: do options and the valuation multiple tell the same earnings story?

For each name with an option term structure (snapshots/ibkr_atm_quotes_*):

  Valuation lens  price + consensus EPS path -> growth the price implies (at a
                  CAPM discount rate), or the return it implies (if growth
                  follows consensus, then fades to 3% by year 10)
  Options lens    implied earnings-day move, implied normal-day vol, 1y vol
  History         realized earnings-day moves, EPS surprises, street EPS growth
  Analysts        dispersion of next-year EPS estimates (high/low)

Plus a historical check on CBOE's five single-stock vol indices: the earnings
move implied by the IV drop across each report vs. the move that happened.
"""

from __future__ import annotations

import json

import numpy as np
import pandas as pd
from scipy.optimize import brentq

from investing.volstudy import consensus as cs
from investing.volstudy import data
from investing.volstudy import decompose as dc
from investing.volstudy import implied as im
from investing.volstudy.study_live import SNAPSHOTS

OUT = data.CACHE / "out"
ASOF = pd.Timestamp("2026-10-02")


def _load_quotes() -> tuple[list[dict], dict]:
    rows = [json.loads(l) for l in open(SNAPSHOTS / "ibkr_atm_quotes_2026-10-02.jsonl") if l.strip()]
    extra: dict[str, list] = {}
    path = SNAPSHOTS / "ibkr_atm_quotes_2026-10-02_extra.jsonl"
    if path.exists():
        for l in open(path):
            if l.strip():
                r = json.loads(l)
                extra.setdefault(r["sym"], []).extend(r["legs"])
    return rows, extra


def implied_return(price: float, eps: list[float], payout: float) -> float:
    """Discount rate that sets value = price when EPS follows consensus, then
    its growth rate fades linearly to 3% by year 10."""
    g0 = float(np.clip((eps[-1] / eps[0]) ** (1 / max(len(eps) - 1, 1)) - 1 if len(eps) > 1 else 0.06, -0.05, 0.25))
    path = list(eps)
    n_fade = im.HORIZON - len(path)
    for k in range(1, n_fade + 1):
        g = g0 + (im.G_TERMINAL - g0) * k / n_fade
        path.append(path[-1] * (1 + g))
    f = lambda r: im.dcf_value(path, im.G_TERMINAL, r, payout) - price
    try:
        return brentq(f, im.G_TERMINAL + 0.002, 0.40)
    except ValueError:
        return float("nan")


def realized_moves(sym: str, n_last: int = 12) -> dict:
    """RMS 2-day raw move around reports, typical EPS surprise, both recent."""
    px = data.prices(sym)
    r = np.log(px).diff()
    e = data.street_eps(sym)
    moves = []
    for d in e["date"]:
        i = r.index.searchsorted(d)
        if 1 <= i and i + 2 <= len(r):
            moves.append(r.iloc[i : i + 2].sum())
    moves = np.array(moves[-n_last:])
    s = ((e["epsActual"] - e["epsEstimated"]) / e["epsEstimated"].abs()).dropna().clip(-0.2, 0.2).iloc[-n_last:]
    return {"move_rms": float(np.sqrt(np.mean(moves**2))), "surprise_rms": float(np.sqrt(np.mean(s**2)))}


def street_growth_vol(sym: str) -> float:
    """Vol of annual TTM street-EPS growth since 2010 (log changes)."""
    ttm = cs.street_ttm(sym).dropna()
    a = np.log(ttm).resample("YE").last().diff().dropna()
    return float(a[a.index >= "2010-01-01"].std())


def fit_cards() -> pd.DataFrame:
    rows, extra = _load_quotes()
    erc = pd.read_csv(OUT / "erc_by_sector.csv").set_index("group")["move_per_1pct_beat"]
    feats = pd.read_pickle(OUT / "features.pkl")
    cards = []
    for q in rows:
        sym = q["sym"]
        ts = im.fit_term_structure(q, ASOF, extra.get(sym))
        price = float(q["spot"])
        cons = im.consensus_path(sym, ASOF)
        eps = im.annual_path(cons, ASOF)
        b = im.beta(sym)
        r_capm = im.RF_10Y + b * im.ERP
        po = im.payout_ratio(sym)
        g_impl = im.implied_growth(price, eps, r_capm, po)
        r_impl = implied_return(price, eps, po)
        cons_g = (eps[-1] / eps[0]) ** (1 / (len(eps) - 1)) - 1 if len(eps) > 1 else float("nan")
        # options' 1y range (16th-84th percentile), and the growth those prices would imply
        T, v = ts["T_long"], ts["vol_1y"]
        lo, hi = price * np.exp(-v * np.sqrt(T)), price * np.exp(v * np.sqrt(T))
        g_lo, g_hi = im.implied_growth(lo, eps, r_capm, po), im.implied_growth(hi, eps, r_capm, po)
        # analysts: next full fiscal year's high/low around the mean
        nxt = cons.iloc[1] if len(cons) > 1 else cons.iloc[0]
        an_disp = (np.log(nxt["epsHigh"]) - np.log(nxt["epsLow"])) / 2
        hist = realized_moves(sym)
        sec = data.sector(sym)
        k = erc.get(sec, erc["ALL"])
        f = feats[feats["sym"] == sym].dropna(subset=["dv252"]).iloc[-1]
        cards.append({
            "sym": sym, "sector": sec, "price": price, "fwd_pe": price / eps[0], "beta": b, "r_capm": r_capm,
            "payout": po, "consensus_years": len(eps), "consensus_growth": cons_g,
            "hist_eps_growth_10y": im.hist_eps_cagr(sym), "implied_growth": g_impl, "implied_return": r_impl,
            "opt_earn_move": ts["jump"], "hist_earn_move": hist["move_rms"],
            "earn_move_ratio": ts["jump"] / hist["move_rms"] if hist["move_rms"] else np.nan,
            "typical_surprise": hist["surprise_rms"], "move_per_1pct_beat": k,
            "move_from_surprise": hist["surprise_rms"] * 100 * k / 100,
            "opt_normal_day_vol_1y": ts["sigma_d_1y"], "hist_normal_day_vol_1y": float(f["dv252"]),
            "opt_vol_1y": v, "price_lo_1y": lo, "price_hi_1y": hi, "implied_growth_lo": g_lo, "implied_growth_hi": g_hi,
            "analyst_eps_disp": an_disp, "hist_eps_growth_vol": street_growth_vol(sym),
            "ts_method": ts["method"],
        })
    return pd.DataFrame(cards)


def cboe_earnings_check() -> pd.DataFrame:
    """Earnings move implied by the CBOE 30d IV drop across each report vs actual."""
    rows = []
    for idx, sym in data.CBOE_IV.items():
        iv = data.cboe_iv(idx)
        px = data.prices(sym)
        r = np.log(px).diff()
        for d in data.street_eps(sym)["date"]:
            if d < iv.index[0]:
                continue
            i = r.index.searchsorted(d)
            if i < 2 or i + 2 > len(r):
                continue
            pre, post = r.index[i - 1], r.index[i + 1]
            if pre not in iv.index or post not in iv.index:
                continue
            j2 = (iv[pre] ** 2 - iv[post] ** 2) * 30 / 365
            rows.append({"sym": sym, "date": d, "implied_move": np.sqrt(max(j2, 0)), "j2": j2,
                         "actual_move": r.iloc[i : i + 2].sum()})
    return pd.DataFrame(rows)


def run():
    cards = fit_cards()
    chk = cboe_earnings_check()
    summ = chk.groupby("sym").apply(lambda g: pd.Series({
        "n": len(g), "implied_rms": np.sqrt(g["j2"].clip(lower=0).mean()), "actual_rms": np.sqrt((g["actual_move"] ** 2).mean()),
        "corr_implied_vs_abs_actual": g["implied_move"].corr(g["actual_move"].abs()),
        "share_actual_exceeds_implied": (g["actual_move"].abs() > g["implied_move"]).mean(),
    }))
    summ["ratio"] = summ["implied_rms"] / summ["actual_rms"]
    cards.to_csv(OUT / "fit_cards.csv", index=False)
    chk.to_csv(OUT / "cboe_earnings_moves.csv", index=False)
    summ.to_csv(OUT / "cboe_earnings_summary.csv")
    return cards, summ


if __name__ == "__main__":
    pd.set_option("display.width", 250)
    c, s = run()
    print(c.round(3).T.to_string()); print(s.round(3).to_string())


# ---------- single-name deep dive ----------

def consensus_value(eps: list[float], r: float, payout: float) -> float:
    """Value if EPS follows consensus, its growth fades to 3% by year 10, and
    the investor earns r."""
    g0 = float(np.clip((eps[-1] / eps[0]) ** (1 / max(len(eps) - 1, 1)) - 1 if len(eps) > 1 else 0.06, -0.05, 0.25))
    path = list(eps)
    n_fade = im.HORIZON - len(path)
    for k in range(1, n_fade + 1):
        path.append(path[-1] * (1 + g0 + (im.G_TERMINAL - g0) * k / n_fade))
    return im.dcf_value(path, im.G_TERMINAL, r, payout)


def price_attribution(sym: str, years: tuple[int, ...] = (1, 2, 5, 10)) -> pd.DataFrame:
    """Split the price change over each window into P/E change and EPS change
    (TTM street EPS)."""
    p = cs.street_panel(sym).dropna()
    end = p.index[-1]
    rows = []
    for y in years:
        past = p[p.index <= end - pd.DateOffset(years=y)]
        if past.empty:
            continue
        a, b = past.iloc[-1], p.iloc[-1]
        rows.append({"years": y, "price_from": np.exp(a["v"]), "price_to": np.exp(b["v"]),
                     "eps_from": np.exp(a["f_st"]), "eps_to": np.exp(b["f_st"]),
                     "pe_from": np.exp(a["m_st"]), "pe_to": np.exp(b["m_st"]),
                     "price_chg": np.exp(b["v"] - a["v"]) - 1,
                     "from_eps": b["f_st"] - a["f_st"], "from_pe": b["m_st"] - a["m_st"]})
    return pd.DataFrame(rows)


def deep_dive(sym: str, quotes: dict | None, asof: pd.Timestamp) -> dict:
    price = float(quotes["spot"]) if quotes else float(data.split_adj_close(sym).iloc[-1])
    cons = im.consensus_path(sym, asof)
    eps = im.annual_path(cons, asof)
    b = im.beta(sym)
    r = im.RF_10Y + b * im.ERP
    po = im.payout_ratio(sym)
    out = {
        "sym": sym, "price": price, "consensus": cons, "eps_path": eps, "ntm_eps": eps[0], "fwd_pe": price / eps[0],
        "beta": b, "r_capm": r, "payout": po,
        "consensus_growth": (eps[-1] / eps[0]) ** (1 / (len(eps) - 1)) - 1 if len(eps) > 1 else float("nan"),
        "hist_eps_growth_10y": im.hist_eps_cagr(sym), "hist_eps_growth_5y": im.hist_eps_cagr(sym, 5),
        "implied_growth": im.implied_growth(price, eps, r, po), "implied_return": implied_return(price, eps, po),
        "value_consensus_capm": consensus_value(eps, r, po),
        "attribution": price_attribution(sym), "eps_growth_vol": street_growth_vol(sym),
    }
    # history of earnings-day moves and surprises
    rx = cs.reactions(sym)
    px = data.prices(sym)
    lr = np.log(px).diff()
    raw = []
    for d in rx["date"]:
        i = lr.index.searchsorted(d)
        raw.append(lr.iloc[i : i + 2].sum() if 1 <= i and i + 2 <= len(lr) else np.nan)
    rx["raw_move"] = raw
    out["recent_reports"] = rx.tail(8)[["date", "act", "est", "surprise_pct", "raw_move", "react"]]
    out.update(realized_moves(sym))
    erc = pd.read_csv(OUT / "erc_by_sector.csv").set_index("group")["move_per_1pct_beat"]
    out["move_per_1pct_beat"] = erc.get(data.sector(sym), erc["ALL"])
    nxt = cons.iloc[1] if len(cons) > 1 else cons.iloc[0]
    out["analyst_disp_next_fy"] = (np.log(nxt["epsHigh"]) - np.log(nxt["epsLow"])) / 2
    if quotes:
        ts = im.fit_term_structure(quotes, asof)
        T, v = ts["T_long"], ts["vol_1y"]
        lo, hi = price * np.exp(-v * np.sqrt(T)), price * np.exp(v * np.sqrt(T))
        out.update({"ts": ts, "price_lo_1y": lo, "price_hi_1y": hi,
                    "implied_growth_lo": im.implied_growth(lo, eps, r, po),
                    "implied_growth_hi": im.implied_growth(hi, eps, r, po)})
    return out
