"""Industry and company analysis à la Mars & Co — the reference implementation from Paul's framework document
(docs/frameworks/INDUSTRY_COMPANY_ANALYSIS.md §11.4), ported as pure functions with its §11.5 test cases in
tests/unit/test_industry.py. Rates are decimals (0.12 = 12%). Section numbers cite that document.

Added for the engine (ADAPT): brand_map_imperative (§3.6), performance_gap_diagnosis (§5.5), spine_gap_bridge (§5.3–5.4 from an
income statement by nature). Output is diagnostic — the engine never emits a trade instruction (§0.6, INV)."""
from __future__ import annotations

import math
from typing import Dict, List, Optional, Sequence, Tuple

DEFAULTS = {
    "subscale_share_index": 0.40,   # 1:2.5 (source band is 1:3 to 1:2.5)  SRC p.154
    "dominant_share_index": 1.50,   # about 1.5:1                           INTERP
    "high_growth": 0.12,            # market growth line on the environment map  SRC p.154
    "inelastic_max": 0.30,          # |arc elasticity| below this: raise price   ADAPT
    "plateau_band": (0.70, 1.30),   # |arc elasticity| in this band: revenue flat  ADAPT
}


# ---------------------------------------------------------------- trends (§0.4)
def log_trend_cagr(values: Sequence[float]) -> Optional[float]:
    """Least squares fit of ln(value) on time; returns exp(slope) - 1."""
    if len(values) < 2 or any(v is None or v <= 0 for v in values):
        return None
    n = len(values)
    xbar = (n - 1) / 2
    ys = [math.log(v) for v in values]
    ybar = sum(ys) / n
    sxy = sum((x - xbar) * (y - ybar) for x, y in enumerate(ys))
    sxx = sum((x - xbar) ** 2 for x in range(n))
    return math.exp(sxy / sxx) - 1


def _log_sse(vals: Sequence[float]) -> float:
    n = len(vals)
    xbar = (n - 1) / 2
    ys = [math.log(v) for v in vals]
    ybar = sum(ys) / n
    sxx = sum((x - xbar) ** 2 for x in range(n))
    b = sum((x - xbar) * (y - ybar) for x, y in enumerate(ys)) / sxx
    a = ybar - b * xbar
    return sum((y - (a + b * x)) ** 2 for x, y in enumerate(ys))


def split_trend(values: Sequence[float], min_seg: int = 4) -> dict:
    """Best single break for two log-linear fits (segments share the break point). Use when a series shows an
    inflection; report both rates."""
    if any(v is None or v <= 0 for v in values) or len(values) < 2 * min_seg - 1:
        return {}
    best = None
    for b in range(min_seg - 1, len(values) - min_seg + 1):
        sse = _log_sse(values[:b + 1]) + _log_sse(values[b:])
        if best is None or sse < best[0]:
            best = (sse, b)
    b = best[1]
    return {"break_index": b, "cagr_before": log_trend_cagr(values[:b + 1]), "cagr_after": log_trend_cagr(values[b:])}


# ---------------------------------------------------------------- cost curves (§4)
def cost_curve(cost0: float, driver0: float, driver: float, slope: float) -> float:
    """Unit cost at a new driver value. slope = cost multiplier per doubling."""
    return cost0 * (driver / driver0) ** math.log2(slope)


def fit_slope(drivers: Sequence[float], costs: Sequence[float]) -> dict:
    """Fit ln(cost) = a + b ln(driver). Returns slope = 2**b and R squared."""
    xs = [math.log(d) for d in drivers]
    ys = [math.log(c) for c in costs]
    n = len(xs)
    xbar, ybar = sum(xs) / n, sum(ys) / n
    sxx = sum((x - xbar) ** 2 for x in xs)
    b = sum((x - xbar) * (y - ybar) for x, y in zip(xs, ys)) / sxx
    a = ybar - b * xbar
    ss_res = sum((y - (a + b * x)) ** 2 for x, y in zip(xs, ys))
    ss_tot = sum((y - ybar) ** 2 for y in ys)
    return {"slope": 2 ** b, "elasticity": b, "r2": 1 - ss_res / ss_tot if ss_tot else 1.0}


def competitor_cost_position(activities: Dict[str, dict], competitor_drivers: Dict[str, float]) -> dict:
    """Estimate a competitor's unit cost activity by activity (§5.1).
    activities: {name: {"client_cost": c, "client_driver": d, "slope": s}}; competitor_drivers: {name: value}.
    Activities without a driver or slope are assumed at parity (flagged)."""
    out, flags = {}, []
    for name, a in activities.items():
        d_comp = competitor_drivers.get(name)
        if d_comp is None or a.get("slope") is None or a.get("client_driver") is None:
            out[name] = a["client_cost"]
            flags.append(f"{name}: assumed parity (no driver or slope)")
        else:
            out[name] = cost_curve(a["client_cost"], a["client_driver"], d_comp, a["slope"])
    client_total = sum(a["client_cost"] for a in activities.values())
    comp_total = sum(out.values())
    gaps = {k: activities[k]["client_cost"] - v for k, v in out.items()}
    return {"competitor_cost": out, "gap_by_activity": gaps, "client_total": client_total, "competitor_total": comp_total,
            "total_gap": client_total - comp_total, "flags": flags}


def derivative_spine(gaps_by_activity: Dict[str, float]) -> Dict[str, float]:
    """Share of total competitor cost gap by activity — the actionable zones (§5.3)."""
    tot = sum(gaps_by_activity.values())
    return {k: v / tot for k, v in gaps_by_activity.items()} if tot else {k: 0.0 for k in gaps_by_activity}


# ---------------------------------------------------------------- profit pools (§3.6)
def whale_curve(units: Sequence[Tuple[str, float, float]]) -> dict:
    """units: (name, revenue, operating_profit). Ranks by margin, returns the cumulative profit curve and the unprofitable tail."""
    ranked = sorted(units, key=lambda u: -(u[2] / u[1]) if u[1] else 0)
    cum, curve = 0.0, []
    for name, rev, prof in ranked:
        cum += prof
        curve.append((name, prof / rev if rev else None, cum))
    losers = [u for u in units if u[2] < 0]
    tot_rev = sum(u[1] for u in units)
    return {"ranked": curve, "peak_cumulative_profit": max(c for _, _, c in curve), "total_profit": cum,
            "unprofitable_count_share": len(losers) / len(units), "unprofitable_revenue_share": sum(u[1] for u in losers) / tot_rev if tot_rev else 0.0,
            "unprofitable_loss": sum(u[2] for u in losers)}


def brand_map_imperative(margin: Optional[float], growth: Optional[float], avg_margin: float = 0.0, avg_growth: float = 0.0,
                         breakeven_band: float = 0.02) -> str:
    """The product/brand map imperatives (§3.6, SRC p.63–64): x = operating margin, y = growth, reference lines at the
    portfolio averages. Returns one of the four imperatives."""
    if margin is None:
        return "no margin data"
    if margin < 0:
        return "find a radical solution or exit"
    if abs(margin) <= breakeven_band:
        return "maintain or make profitable"
    if growth is not None and growth < avg_growth and growth < 0:
        return "stop the decline"
    return "drive profitable growth"


def gap_bridge(start: float, items: Sequence[Tuple[str, float, str]]) -> dict:
    """Walk from one profit figure to another (§5.4). items: (label, value, kind) with kind in
    {"non_economic", "mix", "structural", "closable"}. Positive values raise the client toward the comparator."""
    by_kind: Dict[str, float] = {}
    for _, v, kind in items:
        by_kind[kind] = by_kind.get(kind, 0.0) + v
    economic_start = start + by_kind.get("non_economic", 0.0) + by_kind.get("mix", 0.0)
    efficiency = by_kind.get("structural", 0.0) + by_kind.get("closable", 0.0)
    return {"by_kind": by_kind, "economic_start": economic_start, "end": economic_start + efficiency, "economic_gap": efficiency,
            "structural_share": (by_kind.get("structural", 0.0) / efficiency) if efficiency else None}


# ---------------------------------------------------------------- industry (§6)
def cost_histogram_price_band(plants: Sequence[Tuple[str, float, float]], demand: float) -> dict:
    """plants: (name, capacity, full delivered cost incl. return on capital). Fill demand from the cheapest plant up;
    the theoretical price lies between the last plant needed (last entrant) and the next one (first loser) (§6.2)."""
    ranked = sorted(plants, key=lambda p: p[2])
    cum, last, first_loser = 0.0, None, None
    for p in ranked:
        if cum < demand:
            last = p
            cum += p[1]
        elif first_loser is None:
            first_loser = p
    return {"last_entrant": last, "first_loser": first_loser, "price_floor": last[2] if last else None,
            "price_ceiling": first_loser[2] if first_loser else None, "spare_capacity": cum - demand}


def share_profit_line(share_ratios: Sequence[float], ros: Sequence[float]) -> dict:
    """Fit ROS = a + b ln(relative share) (§6.3). Residuals show who over- or under-earns for its share."""
    xs = [math.log(r) for r in share_ratios]
    n = len(xs)
    xbar, ybar = sum(xs) / n, sum(ros) / n
    sxx = sum((x - xbar) ** 2 for x in xs)
    b = sum((x - xbar) * (y - ybar) for x, y in zip(xs, ros)) / sxx if sxx else 0.0
    a = ybar - b * xbar
    return {"a_ros_at_parity": a, "b_per_log_ratio": b, "ros_gain_per_doubling": b * math.log(2),
            "residuals": [y - (a + b * x) for x, y in zip(xs, ros)]}


def market_environment(share_index: float, growth: float, cfg: dict = DEFAULTS) -> str:
    """Market environment map (§6.4, SRC p.154). share_index = own share / main competitor's share; growth = annual market growth."""
    if growth > cfg["high_growth"]:
        return "HIGH_GROWTH_OPEN" if share_index >= cfg["subscale_share_index"] else "HIGH_GROWTH_SUBSCALE_UNCLASSIFIED"
    if share_index < cfg["subscale_share_index"]:
        return "SUB_SCALE"
    if share_index <= cfg["dominant_share_index"]:
        return "CRITICAL_MASS"
    return "DOMINANT"


ENVIRONMENT_WORDS = {
    "SUB_SCALE": "sub-scale — below about 1:2.5 of the main competitor; not viable go-alone: ally or exit",
    "CRITICAL_MASS": "critical mass — a viable ongoing business",
    "DOMINANT": "dominant — above about 1.5:1; major barriers for the competitor",
    "HIGH_GROWTH_OPEN": "high growth, no entrenched competitor — grow the market, use first-mover advantage",
    "HIGH_GROWTH_SUBSCALE_UNCLASSIFIED": "high growth but sub-scale — the source leaves this corner blank",
}


# ---------------------------------------------------------------- demand (§7)
def price_response_zones(prices: Sequence[float], volumes: Sequence[float], cfg: dict = DEFAULTS) -> List[dict]:
    """Classify each adjacent price interval by arc (midpoint) elasticity (§7.3). prices ascending; volumes as levels or indices."""
    lo_band, hi_band = cfg["plateau_band"]
    out = []
    for i in range(len(prices) - 1):
        p1, p2, q1, q2 = prices[i], prices[i + 1], volumes[i], volumes[i + 1]
        dq = (q2 - q1) / ((q1 + q2) / 2)
        dp = (p2 - p1) / ((p1 + p2) / 2)
        e = dq / dp
        drev = (p2 * q2) / (p1 * q1) - 1
        ae = abs(e)
        if ae < cfg["inelastic_max"]:
            zone = "VOLUME_INELASTIC"
        elif lo_band <= ae <= hi_band:
            zone = "REVENUE_PLATEAU"
        elif ae > hi_band:
            zone = "ELASTIC"
        else:
            zone = "MODERATE"
        out.append({"from": p1, "to": p2, "arc_elasticity": e, "volume_change": q2 / q1 - 1, "revenue_change": drev, "zone": zone})
    return out


def _solve(a: List[List[float]], b: List[float]) -> List[float]:
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for c in range(n):
        piv = max(range(c, n), key=lambda r: abs(m[r][c]))
        m[c], m[piv] = m[piv], m[c]
        for r in range(n):
            if r != c:
                f = m[r][c] / m[c][c]
                for k in range(c, n + 1):
                    m[r][k] -= f * m[c][k]
    return [m[i][n] / m[i][i] for i in range(n)]


def demand_lever_ranking(levers: Dict[str, Sequence[float]], demand: Sequence[float]) -> List[dict]:
    """Multivariable OLS on z-scored variables (§7.1). Ranks levers by |standardised coefficient| and returns raw coefficients."""
    names = list(levers)
    n = len(demand)

    def z(v):
        mu = sum(v) / n
        sd = math.sqrt(sum((x - mu) ** 2 for x in v) / (n - 1))
        return [(x - mu) / sd for x in v], sd

    zy, sdy = z(demand)
    zx, sdx = {}, {}
    for k in names:
        zx[k], sdx[k] = z(levers[k])
    xtx = [[sum(zx[i][t] * zx[j][t] for t in range(n)) for j in names] for i in names]
    xty = [sum(zx[i][t] * zy[t] for t in range(n)) for i in names]
    beta = _solve(xtx, xty)
    rows = [{"lever": k, "std_coef": b, "raw_coef": b * sdy / sdx[k]} for k, b in zip(names, beta)]
    return sorted(rows, key=lambda r: -abs(r["std_coef"]))


def volume_gap(regions: Sequence[Tuple[str, float, float]], benchmark_share: float) -> List[Tuple[str, float]]:
    """regions: (name, market_size, own_share). Volume gap vs a benchmark share (§7.5)."""
    out = [(n, max(0.0, benchmark_share - s) * m) for n, m, s in regions]
    return sorted(out, key=lambda x: -x[1])


# ---------------------------------------------------------------- engine adaptations (ADAPT)
SPINE_STAGES = {"cost_of_sales": "purchased materials and transformation", "rd": "product development", "opex_other": "demand building, selling and G&A"}


def spine_gap_bridge(client: dict, peer: dict, scale_ratio: float, structural_ratio: float = 2.0) -> dict:
    """The operating-margin gap to a better peer, bridged by spine stage from an income statement by nature (§3.2, §5.3–5.4).
    client / peer: {gross_margin, operating_margin, rd_pct} as decimals. Items are tagged structural when the peer's
    revenue is at least `structural_ratio` × the client's (scale related, §4.1), else closable. Returns the bridge, the derivative
    spine (where the gap is, not the cost shares) and the stage items in margin points."""
    def stage_costs(d):
        gm, om, rd = d.get("gross_margin"), d.get("operating_margin"), d.get("rd_pct") or 0.0
        if gm is None or om is None:
            return None
        return {"cost_of_sales": 1 - gm, "rd": rd, "opex_other": max(0.0, gm - om - rd)}
    c, p = stage_costs(client), stage_costs(peer)
    if c is None or p is None:
        return {"items": [], "bridge": None, "derivative_spine": {}, "note": "margins unavailable"}
    kind = "structural" if scale_ratio >= structural_ratio else "closable"
    items = [(SPINE_STAGES[k], (c[k] - p[k]) * 100, kind) for k in ("cost_of_sales", "rd", "opex_other")]
    gaps = {SPINE_STAGES[k]: max(0.0, (c[k] - p[k]) * 100) for k in c}
    br = gap_bridge(client["operating_margin"] * 100, items)
    return {"items": [{"stage": s, "gap_pp": v, "kind": k} for s, v, k in items], "bridge": br, "derivative_spine": derivative_spine(gaps),
            "client_margin_pct": client["operating_margin"] * 100, "peer_margin_pct": peer["operating_margin"] * 100,
            "scale_ratio": scale_ratio, "kind": kind}


def performance_gap_diagnosis(growth: Optional[float], sector_growth: Optional[float], margin: Optional[float], predicted_margin: Optional[float],
                              asset_turns: Optional[float], sector_asset_turns: Optional[float], share_index: Optional[float], cfg: dict = DEFAULTS) -> list[dict]:
    """§5.5 (SRC p.36): slow volume growth, weak operating margin, poor asset utilisation → operational or structural drivers and the
    source's solution orientation. Returns one row per gap found."""
    out = []
    if growth is not None and sector_growth is not None and growth < sector_growth - 0.03:
        structural = sector_growth < 0.03
        out.append({"gap": "slow volume growth", "type": "structural" if structural else "operational",
                    "driver": "mature market, mature share" if structural else "lackluster market or share",
                    "solution": ("create excitement; new products and extensions; new categories" if structural else
                                 "focus the brand and channel portfolio; leverage latent brand equity; step up investment in quality, pricing, advertising and merchandising")})
    if margin is not None and predicted_margin is not None and margin < predicted_margin - 0.03:
        structural = share_index is not None and share_index < cfg["subscale_share_index"]
        out.append({"gap": "weak operating margin", "type": "structural" if structural else "operational",
                    "driver": "low share or scale, weak brands, strong trade" if structural else "margin below what share and scale predict",
                    "solution": ("acquisition, or a slow build" if structural else
                                 "rip apart internal economics (grow high-margin areas, fix or exit low-margin ones); rip apart competitor economics to close cost gaps")})
    if asset_turns is not None and sector_asset_turns is not None and asset_turns < sector_asset_turns * 0.75:
        out.append({"gap": "poor asset utilisation", "type": "operational", "driver": "low fixed-asset or inventory turns",
                    "solution": "less asset-intensive growth routes (product or channel mix, distributors, co-packers); sweat or sell assets; inventory reduction"})
    return out
