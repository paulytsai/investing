"""Per-security metrics at a formation date, computed only from `snapshot()` (point-in-time) and prices/events
with dates ≤ as_of. Every metric maps to a spec rule/framework (see rules/screen.yaml)."""
from __future__ import annotations

import json
from dataclasses import dataclass

import numpy as np
import pandas as pd

from ..frameworks import core as fw
from ..pit.snapshot import Snapshot
from .rules import ai_layer_score

TAX = 0.21


METRICS_VERSION = "v4"     # v3: lexical text signals + theme diffusion factors in the candidate metrics     # bump when metric definitions change: the backtest candidate cache is keyed by it
PE_BAND_MAX = 150.0        # P/E above this is "EPS ≈ 0", not a valuation
PE_BAND_MIN_DAYS = 3 * 250 # ≥ 3 years of meaningful daily P/E before the own-history percentile is scored (F-13)


@dataclass
class Inputs:
    snap: Snapshot
    prices: pd.DataFrame            # prices_daily rows ≤ as_of (date, close_adj, close_tr)
    market_cap: float | None
    events: pd.DataFrame            # events rows with available_from ≤ as_of
    ai_layer: str
    asset_type: str


def _v(d: dict, k: str):
    v = d.get(k)
    return None if v is None or (isinstance(v, float) and np.isnan(v)) else float(v)


PRICE_BASED = ("pe_ttm", "pe_own_pctile", "pe_band_low", "pe_band_median", "pe_band_high", "pe_band_n", "pe_normalized", "p_ocf", "p_fcf_avg",
               "fcf_yield", "fcf_yield_avg", "peg", "required_cagr_pct", "implied_growth_gap", "ev_ebitda", "ps_ttm", "dividend_yield", "shareholder_yield",
               "multiple_only_drawdown", "pe_rel", "earnings_yield")


def void_if_currency_mismatch(out: dict, snap, quote_currency: str | None) -> dict:
    """An ADR whose statements are in another currency (TGS in ARS, TIMB in BRL) has no meaningful P/E or yield against a
    USD price: those metrics are voided (coverage falls, never imputed) and the mismatch is recorded for an ALERT."""
    rc = getattr(snap, "currency", None)
    if rc and quote_currency and rc != quote_currency.upper():
        for k in PRICE_BASED:
            if k in out:
                out[k] = None
        out["currency_mismatch"] = f"statements in {rc}, quote in {quote_currency.upper()}"
    return out


def compute_metrics(inp: Inputs, as_of: pd.Timestamp, hyp_thresholds: dict) -> dict:
    s, m, prior = inp.snap, inp.snap.metrics, inp.snap.prior_ttm
    out: dict = {"basis": s.basis, "period_end": s.period_end, "stale": s.stale}
    px = inp.prices.drop_duplicates("date").sort_values("date").reset_index(drop=True) if inp.prices is not None else pd.DataFrame()
    price = float(px["close_adj"].iloc[-1]) if not px.empty else None
    out["price"] = price
    out["price_date"] = px["date"].iloc[-1] if not px.empty else None
    mcap = inp.market_cap
    if mcap is None and price and _v(m, "shares_diluted"):
        mcap = price * _v(m, "shares_diluted")
        out["market_cap_derived"] = True
    out["market_cap"] = mcap

    rev, rev_p = _v(m, "revenue"), _v(prior, "revenue")
    oi, oi_p = _v(m, "operating_income"), _v(prior, "operating_income")
    ni = _v(m, "net_income")
    gp = _v(m, "gross_profit")
    ocf, capex = _v(m, "ocf"), _v(m, "capex")
    fcf = _v(m, "fcf")
    if fcf is None and ocf is not None and capex is not None:
        fcf = ocf + capex if capex < 0 else ocf - capex
    if fcf is None and ocf is not None and capex is None and _v(m, "cfi") is not None:
        fcf = ocf + _v(m, "cfi")   # 簡易FCF: 決算短信 has no capex line; investing cash flow stands in (labelled)
        out["fcf_basis"] = "ocf+cfi (簡易FCF; 短信 has no capex line)"
    eps, eps_p = _v(m, "eps_diluted"), _v(prior, "eps_diluted")
    debt, cash, equity = _v(m, "total_debt"), _v(m, "cash_st_inv"), _v(m, "total_equity")
    ebitda = _v(m, "ebitda")
    rd = _v(m, "rd_expense")
    divs, buybacks = _v(m, "dividends_paid"), _v(m, "buybacks")

    # --- story & growth (P-24, R-43, F-106) --------------------------------------------------
    out["revenue_ttm"], out["net_income_ttm"], out["eps_ttm"], out["fcf_ttm"], out["ocf_ttm"] = rev, ni, eps, fcf, ocf
    out["rev_growth_ttm"] = fw.growth(rev, rev_p)
    fy = s.fy_history
    out["rev_cagr_3y"] = out["rev_accel"] = out["gm_trend_3y"] = out["eps_cagr_3y"] = None
    if fy is not None and not fy.empty and "revenue" in fy.columns:
        r = fy["revenue"].dropna()
        if len(r) >= 4:
            out["rev_cagr_3y"] = fw.cagr(r.iloc[-1], r.iloc[-4], 3.0)
            g1, g0 = fw.growth(r.iloc[-1], r.iloc[-2]), fw.growth(r.iloc[-2], r.iloc[-3])
            out["rev_accel"] = None if g1 is None or g0 is None else g1 - g0
        if "gross_profit" in fy.columns and len(fy) >= 4:
            gm = (fy["gross_profit"] / fy["revenue"]).dropna()
            if len(gm) >= 4 and pd.notna(gm.iloc[-1]) and pd.notna(gm.iloc[-4]) and np.isfinite(gm.iloc[-1]) and np.isfinite(gm.iloc[-4]):
                out["gm_trend_3y"] = float(gm.iloc[-1] - gm.iloc[-4])
        if "eps_diluted" in fy.columns:
            e = fy["eps_diluted"].dropna()
            if len(e) >= 4:
                out["eps_cagr_3y"] = fw.cagr(e.iloc[-1], e.iloc[-4], 3.0)
    gm_now = fw.safe_div(gp, rev)
    rd_pct = fw.safe_div(rd, rev)
    capex_pct = fw.safe_div(abs(capex) if capex else None, rev)
    ip_rd = float(hyp_thresholds.get("ip_pattern_rd_pct", 20)) / 100
    out["rd_pct"] = rd_pct
    out["ip_pattern"] = 1.0 if (rd_pct is not None and rd_pct > ip_rd and (out["gm_trend_3y"] or 0) >= 0 and (capex_pct or 0) < 0.06) else 0.0

    # --- moat (F-01, F-08, F-81, F-39/F-43) ------------------------------------------------------
    out["gross_margin"] = gm_now
    ol = fw.operating_leverage(oi, oi_p, rev, rev_p)
    out["incremental_margin"] = ol["incremental_margin"]
    out["operating_margin"] = ol["operating_margin"]
    out["eps_impact_per_1pct_rev"] = ol["eps_impact_per_1pct_rev"]
    out["ai_layer_score"] = ai_layer_score(inp.ai_layer)

    # --- quality (F-07, F-82, F-40/41, R-18) -------------------------------------------------------
    invested = None if debt is None or equity is None else (debt + equity - (cash or 0))
    if invested is None and debt is None and _v(m, "total_assets"):
        invested = _v(m, "total_assets") - (cash or 0)   # proxy: 短信 has no debt line → total assets less cash (conservative)
        out["roic_basis"] = "NOPAT / (total assets − cash); proxy, no debt line in 決算短信"
    out["roic_ttm"] = fw.safe_div(oi * (1 - TAX) if oi is not None else None, invested) if invested and invested > 0 else None
    out["ocf_ni_ratio"] = fw.safe_div(ocf, ni) if ni and ni > 0 else None
    out["fcf_margin"] = fw.safe_div(fcf, rev)
    net_debt = None if debt is None else debt - (cash or 0)
    out["net_debt"] = net_debt
    out["net_debt_ebitda"] = fw.safe_div(net_debt, ebitda) if ebitda and ebitda > 0 else None
    out["capex_to_ocf"] = fw.safe_div(abs(capex) if capex else None, ocf) if ocf and ocf > 0 else None

    # --- on sale (F-13, F-14, F-12/F-83) -----------------------------------------------------------
    pe = fw.safe_div(price, eps) if eps and eps > 0 and price else None
    out["pe_ttm"] = pe
    band = {"percentile": None, "low": None, "median": None, "high": None, "n": 0}
    eps_series = s.eps_ttm_series()
    pe_hist = pd.Series(dtype=float)
    if not eps_series.empty and not px.empty:
        daily = px.set_index(pd.to_datetime(px["date"]))["close_adj"].astype(float)
        eps_daily = eps_series.reindex(daily.index.union(eps_series.index)).ffill().reindex(daily.index)
        pe_hist = (daily / eps_daily).replace([np.inf, -np.inf], np.nan)
        # a P/E only means something with real earnings: drop days where EPS was ≤ 0 or so small that P/E > 150 (a
        # loss-to-profit transition otherwise makes today's 40x look like the 1st percentile of a 600x "band")
        pe_hist = pe_hist[(eps_daily > 0) & (pe_hist <= PE_BAND_MAX)]
        band = fw.band_percentile(pe_hist.dropna(), pe, 10)
        if band["n"] < PE_BAND_MIN_DAYS or (pe is not None and pe > PE_BAND_MAX):
            band = {**band, "percentile": None}            # < 3 years of meaningful P/E history: no own-band score (coverage, not imputed)
            out["pe_band_note"] = f"own-history band needs ≥{PE_BAND_MIN_DAYS} days of meaningful P/E (have {band['n']})"
    out["pe_own_pctile"], out["pe_band_low"], out["pe_band_median"], out["pe_band_high"], out["pe_band_n"] = (
        band["percentile"], band["low"], band["median"], band["high"], band["n"])
    # normalized P/E (F-13 / R-14): a company temporarily in the red is valued on its prior normal state — the median of
    # the positive TTM EPS observations of the last 3 years; used for the own-band percentile when TTM EPS is ≤ 0 or ≈ 0
    out["eps_normalized"] = out["pe_normalized"] = None
    out["pe_basis"] = "ttm"
    if not eps_series.empty:
        recent = eps_series[eps_series.index >= as_of - pd.Timedelta(days=3 * 365)]
        pos = recent[recent > 0]
        if len(pos) >= 4:
            eps_norm = float(pos.median())
            out["eps_normalized"] = eps_norm
            out["pe_normalized"] = fw.safe_div(price, eps_norm) if price else None
            if (pe is None or pe > PE_BAND_MAX) and out["pe_normalized"] and band["n"] >= PE_BAND_MIN_DAYS:
                nb = fw.band_percentile(pe_hist.dropna(), out["pe_normalized"], 10)
                if nb["percentile"] is not None:
                    out["pe_own_pctile"] = nb["percentile"]
                    out["pe_basis"] = "normalized (median positive TTM EPS, 3y)"
    # cash-flow yardsticks (F-19 / R-14): price ÷ operating cash flow and price ÷ 3-year average free cash flow — earnings
    # can be depressed or flattered while cash is harder to dress up
    out["p_ocf"] = fw.safe_div(mcap, ocf) if mcap and ocf and ocf > 0 else None
    out["fcf_avg_3y"] = out["p_fcf_avg"] = out["fcf_yield_avg"] = None
    if fy is not None and not fy.empty:
        fcf_fy = None
        if "fcf" in fy.columns and fy["fcf"].notna().sum() >= 2:
            fcf_fy = fy["fcf"].dropna()
        elif "ocf" in fy.columns and "capex" in fy.columns:
            tmp = (fy["ocf"] + fy["capex"].where(fy["capex"] < 0, -fy["capex"])).dropna()
            fcf_fy = tmp if len(tmp) >= 2 else None
        elif "ocf" in fy.columns and "cfi" in fy.columns:          # JP 簡易FCF
            tmp = (fy["ocf"] + fy["cfi"]).dropna()
            fcf_fy = tmp if len(tmp) >= 2 else None
        if fcf_fy is not None and len(fcf_fy):
            avg = float(fcf_fy.tail(3).mean())
            out["fcf_avg_3y"] = avg
            if mcap and avg > 0:
                out["p_fcf_avg"] = mcap / avg
                out["fcf_yield_avg"] = avg / mcap
    out["peg"] = fw.peg(pe, (out["eps_cagr_3y"] or 0) * 100 if out["eps_cagr_3y"] else None)
    out["drawdown_3y"] = out["upside_to_peak"] = out["multiple_led_drawdown"] = None
    out["move_decomp"] = None
    if not px.empty and price:
        win = px[pd.to_datetime(px["date"]) >= as_of - pd.Timedelta(days=3 * 365)]
        if len(win) > 60:
            hi_i = win["close_adj"].astype(float).idxmax()
            hi_px, hi_date = float(win.loc[hi_i, "close_adj"]), pd.Timestamp(win.loc[hi_i, "date"])
            out["drawdown_3y"] = price / hi_px - 1.0
            out["upside_to_peak"] = hi_px / price - 1.0
            out["peak_date"] = hi_date
            e0 = None
            if not eps_series.empty:
                prior_eps = eps_series[eps_series.index <= hi_date]
                e0 = float(prior_eps.iloc[-1]) if len(prior_eps) else None
            d = fw.move_decomposition(hi_px, price, e0, eps)
            out["move_decomp"] = d
            thr = float(hyp_thresholds.get("drawdown_research_trigger_pct", 25)) / 100
            if out["drawdown_3y"] <= -thr and d["basis"] == "pe" and (d["f_mult"] or 0) >= 0.6 and eps and e0 and eps >= 0.9 * e0:
                out["multiple_led_drawdown"] = -out["drawdown_3y"]      # magnitude of the on-sale gap
            else:
                out["multiple_led_drawdown"] = 0.0
        if len(px) > 260:
            p12 = float(px["close_adj"].iloc[-253])
            out["run_up_12m"] = price / p12 - 1.0 if p12 > 0 else None
        else:
            out["run_up_12m"] = None
    out["implied_growth_gap"] = None     # filled by the DCF module (M2b)

    # --- asymmetry (F-76, F-20, F-19) --------------------------------------------------------------
    out["net_cash_to_cap"] = fw.safe_div(-(net_debt), mcap) if net_debt is not None and mcap else None
    out["fcf_yield"] = fw.safe_div(fcf, mcap) if mcap else None

    # --- alignment (F-09 proxy, R-22, F-111) --------------------------------------------------------
    ev = inp.events if inp.events is not None else pd.DataFrame()
    buy = sell = 0.0
    beat_streak = 0
    if not ev.empty:
        ev = ev.copy()
        ev["event_date"] = pd.to_datetime(ev["event_date"])
        recent = ev[ev["event_date"] >= as_of - pd.Timedelta(days=365)]
        for _, r in recent.iterrows():
            if r["event_type"] in ("form4_buy", "form4_sell"):
                p = json.loads(r["payload"])
                if str(p.get("owner_type", "")).lower().startswith(("officer", "director", "10 percent")):
                    if r["event_type"] == "form4_buy":
                        buy += float(p.get("value_usd") or 0)
                    else:
                        sell += float(p.get("value_usd") or 0)
        earn = ev[ev["event_type"] == "earnings"].sort_values("event_date", ascending=False).head(8)
        for _, r in earn.iterrows():
            sp = json.loads(r["payload"]).get("surprise_pct")
            if sp is not None and sp >= 0:
                beat_streak += 1
            else:
                break
    out["insider_buy_usd_12m"], out["insider_sell_usd_12m"] = buy, sell
    out["insider_net_buy_12m"] = fw.safe_div(buy - sell, mcap) if mcap else None
    sh_yield = None
    if mcap:
        sh_yield = (abs(buybacks or 0) + abs(divs or 0)) / mcap
    out["shareholder_yield"] = sh_yield
    out["dividend_yield"] = fw.safe_div(abs(divs) if divs else 0.0, mcap) if mcap else None
    out["dividend_coverage"] = fw.safe_div(fcf, abs(divs)) if divs else None

    # --- fundamental momentum (F-17) ---------------------------------------------------------------
    out["beat_streak"] = float(beat_streak)
    out["eps_growth_ttm"] = fw.growth(eps, eps_p)

    # --- misc for gates / tags -----------------------------------------------------------------------
    out["pbr"] = fw.safe_div(mcap, equity) if equity and equity > 0 and mcap else None
    out["ps_ttm"] = fw.safe_div(mcap, rev) if rev and rev > 0 and mcap else None
    out["loss_making"] = bool((ni is not None and ni < 0) and (ocf is not None and ocf < 0))
    out["debt_funded_negative_fcf"] = bool(fcf is not None and fcf < 0 and (_v(m, "debt_issued_net") or 0) > 0)
    # cyclical margin percentile vs own FY history (F-26 / R-15)
    out["op_margin_pctile"] = None
    if fy is not None and not fy.empty and {"operating_income", "revenue"} <= set(fy.columns):
        om = (fy["operating_income"] / fy["revenue"]).dropna()
        if len(om) >= 5 and ol["operating_margin"] is not None:
            out["op_margin_pctile"] = float((om < ol["operating_margin"]).mean() * 100)
    # required CAGR to justify price: growth that makes PEG = 1 over 5 years (F-91 proxy)
    out["required_cagr_pct"] = pe if pe else None
    return out
