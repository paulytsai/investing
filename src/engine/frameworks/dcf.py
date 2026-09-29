"""Scenario DCF and reverse DCF (spec Stage 6: F-16 what's priced in, F-77 expected value AND range,
F-18 hurdle, R-24 plausibility). Every input carries its status (stated / hypothesis / derived)."""
from __future__ import annotations

import math
from dataclasses import dataclass, field


@dataclass
class DCFInputs:
    price: float
    shares: float
    net_debt: float                 # debt − cash (negative = net cash)
    fcf_ttm: float
    revenue_ttm: float | None
    trailing_growth: float | None   # revenue CAGR 3y (decimal)
    rf_pct: float                   # 10-yr UST at as_of (point-in-time), percent
    beta: float = 1.0
    asset_type: str = "non_commodity"
    mid_cycle_margin: float | None = None   # for cyclicals: 10-yr median FCF margin


@dataclass
class DCFResult:
    discount_rate_pct: float
    horizon_years: int
    terminal_growth_pct: float
    base_growth_pct: float
    scenarios: dict = field(default_factory=dict)
    ev_weighted_per_share: float | None = None
    range_per_share: tuple[float | None, float | None] = (None, None)
    upside_weighted_pct: float | None = None
    implied_growth_pct: float | None = None
    implied_growth_gap_pp: float | None = None
    expected_return_pct: float | None = None
    hurdle: dict = field(default_factory=dict)
    sensitivity: list[dict] = field(default_factory=list)
    inputs: dict = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)
    basis: str = "fcf"

    def summary(self) -> str:
        if self.ev_weighted_per_share is None:
            return "n/a (" + "; ".join(self.notes) + ")"
        lo, hi = self.range_per_share
        s = (f"prob-weighted value {self.ev_weighted_per_share:,.0f}/sh ({self.upside_weighted_pct:+.0f}% vs price), range "
             f"{lo:,.0f}–{hi:,.0f} (bear–bull); discount {self.discount_rate_pct:.1f}% = 10Y {self.inputs.get('rf_pct', 0):.2f}% + ERP; "
             f"terminal g {self.terminal_growth_pct:.1f}%")
        if self.implied_growth_pct is not None:
            s += f"; price implies {self.implied_growth_pct:.0f}%/yr FCF growth vs trailing {self.base_growth_pct:.0f}% (gap {self.implied_growth_gap_pp:+.0f} pp)"
        if self.hurdle.get("passes") is not None:
            s += f"; expected return {self.expected_return_pct:.1f}% vs hurdle {self.hurdle['hurdle_pct']:.1f}% → {'pass' if self.hurdle['passes'] else 'fail'}"
        return s


def _pv_stream(fcf0: float, growth: float, years: int, taper_to: float, rate: float, term_g: float, exit_multiple: float | None) -> tuple[float, float, float]:
    """PV of FCF growing from `growth` linearly tapering to `taper_to` over `years`, plus terminal value.
    Returns (pv_explicit, pv_terminal_gordon, pv_terminal_multiple)."""
    pv = 0.0
    f = fcf0
    for t in range(1, years + 1):
        g = growth + (taper_to - growth) * (t - 1) / max(1, years - 1)
        f = f * (1 + g)
        pv += f / (1 + rate) ** t
    tv_g = f * (1 + term_g) / (rate - term_g) if rate > term_g else float("inf")
    tv_m = f * exit_multiple if exit_multiple else tv_g
    disc = (1 + rate) ** years
    return pv, tv_g / disc, tv_m / disc


def scenario_dcf(inp: DCFInputs, hyp: dict) -> DCFResult:
    """hyp: {erp_pct, beta_floor, beta_cap, terminal_growth_pct, horizon_years, growth_cap_pct, scenarios{bear,base,bull{growth_mult, margin_delta_pct, prob}}}"""
    n = int(hyp["horizon_years"])
    term_g = float(hyp["terminal_growth_pct"]) / 100
    beta = min(max(inp.beta, float(hyp["beta_floor"])), float(hyp["beta_cap"]))
    rate = (inp.rf_pct + float(hyp["erp_pct"]) * beta) / 100
    res = DCFResult(discount_rate_pct=rate * 100, horizon_years=n, terminal_growth_pct=term_g * 100, base_growth_pct=0.0,
                    inputs={"rf_pct": inp.rf_pct, "beta": beta, "erp_pct": hyp["erp_pct"], "fcf_ttm": inp.fcf_ttm, "shares": inp.shares,
                            "net_debt": inp.net_debt, "price": inp.price, "trailing_growth_pct": (inp.trailing_growth or 0) * 100})
    fcf0 = inp.fcf_ttm
    if inp.asset_type in ("commodity_cyclical", "miner_resource") and inp.mid_cycle_margin is not None and inp.revenue_ttm:
        fcf0 = inp.revenue_ttm * inp.mid_cycle_margin
        res.basis = "mid_cycle_fcf"
        res.notes.append("cyclical: FCF normalized to 10-yr median margin (R-14 yardstick)")
    if not inp.shares or inp.shares <= 0 or inp.price <= 0:
        res.notes.append("missing shares/price")
        return res
    if fcf0 is None or fcf0 <= 0:
        res.notes.append("FCF ≤ 0: scenario DCF not meaningful; reverse DCF on revenue only")
        if inp.revenue_ttm and inp.revenue_ttm > 0:
            res.implied_growth_pct = _implied_growth(inp.price * inp.shares + inp.net_debt, inp.revenue_ttm * 0.15, n, rate, term_g)
            res.notes.append("implied growth assumes a 15% terminal FCF margin (hypothesis)")
            if inp.trailing_growth is not None and res.implied_growth_pct is not None:
                res.implied_growth_gap_pp = inp.trailing_growth * 100 - res.implied_growth_pct
        return res
    g_cap = float(hyp["growth_cap_pct"]) / 100
    base_g = min(max(inp.trailing_growth if inp.trailing_growth is not None else 0.05, -0.10), g_cap)
    res.base_growth_pct = base_g * 100
    exit_mult = 1.0 / (rate - term_g) if rate > term_g else None      # Gordon-consistent multiple; shown as cross-check
    weighted = 0.0
    vals = []
    for name, sc in hyp["scenarios"].items():
        g = base_g * float(sc["growth_mult"])
        margin_adj = 1.0 + float(sc["margin_delta_pct"]) / 100 / max(0.05, (inp.fcf_ttm / inp.revenue_ttm) if inp.revenue_ttm else 0.15)
        pv, tv_g, tv_m = _pv_stream(fcf0 * margin_adj, g, n, term_g, rate, term_g, exit_mult)
        ev_g, ev_m = pv + tv_g, pv + tv_m
        eq = ev_g - inp.net_debt
        ps = eq / inp.shares
        res.scenarios[name] = {"growth_start_pct": g * 100, "ev_gordon": ev_g, "ev_multiple": ev_m, "equity": eq, "per_share": ps,
                               "upside_pct": (ps / inp.price - 1) * 100, "prob": float(sc["prob"])}
        weighted += ps * float(sc["prob"])
        vals.append(ps)
    res.ev_weighted_per_share = weighted
    res.range_per_share = (min(vals), max(vals))
    res.upside_weighted_pct = (weighted / inp.price - 1) * 100
    # reverse DCF: growth the market cap implies
    res.implied_growth_pct = _implied_growth(inp.price * inp.shares + inp.net_debt, fcf0, n, rate, term_g)
    if res.implied_growth_pct is not None:
        res.implied_growth_gap_pp = base_g * 100 - res.implied_growth_pct
    # expected return over horizon from base value (F-18)
    base_ps = res.scenarios.get("base", {}).get("per_share")
    if base_ps and base_ps > 0:
        yrs = 5.0
        res.expected_return_pct = ((base_ps / inp.price) ** (1 / yrs) - 1) * 100
    # sensitivity grid: discount ± and terminal g ±
    for dr in (-1.0, 0.0, 1.0):
        for dg in (-1.0, 0.0, 1.0):
            r2, g2 = rate + dr / 100, term_g + dg / 100
            if r2 <= g2:
                continue
            pv, tv_g, _ = _pv_stream(fcf0, base_g, n, g2, r2, g2, None)
            ps = (pv + tv_g - inp.net_debt) / inp.shares
            res.sensitivity.append({"discount_pct": r2 * 100, "terminal_g_pct": g2 * 100, "per_share": ps, "upside_pct": (ps / inp.price - 1) * 100})
    return res


def _implied_growth(target_ev: float, fcf0: float, n: int, rate: float, term_g: float) -> float | None:
    """Constant growth g for n years (then terminal) such that PV = target_ev; bisection on [-50%, +150%]."""
    if fcf0 is None or fcf0 <= 0 or target_ev <= 0:
        return None

    def pv(g):
        p, tv, _ = _pv_stream(fcf0, g, n, g, rate, term_g, None)
        return p + tv

    lo, hi = -0.5, 1.5
    if pv(lo) > target_ev:
        return lo * 100
    if pv(hi) < target_ev:
        return hi * 100
    for _ in range(60):
        mid = (lo + hi) / 2
        if pv(mid) < target_ev:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2 * 100


def hurdle_check(res: DCFResult, rf_pct: float, margin_pct: float) -> DCFResult:
    if res.expected_return_pct is None:
        res.hurdle = {"passes": None, "hurdle_pct": rf_pct + margin_pct, "gap_pct": None}
    else:
        h = rf_pct + margin_pct
        res.hurdle = {"passes": res.expected_return_pct > h, "hurdle_pct": h, "gap_pct": res.expected_return_pct - h}
    return res


def _isfinite(x) -> bool:
    return x is not None and not (isinstance(x, float) and (math.isnan(x) or math.isinf(x)))
