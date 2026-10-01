"""The product-company lens: how a company that sells a physical product is read, after two consulting playbooks Paul
supplied. Mars & Co (GM aftermarket roadmap, 2004): growth is a bridge — a *baseline* trend by region from the installed
base and current commitments, quantified headwinds and tailwinds, and *reach* growth that needs investment and comes at
lower margin; pressure runs up and down the value chain; defence and offence per channel. BCG (Nestlé Japan, Project
Tiger, 1998): the quality of a sale — trade spend and the gap between list and realised price, forward buying and
short-term volume push that show up as month-end loading and channel inventory, account-level profit.

Pure functions over tidy frames; nothing here fetches. Spec ids: F-107 (price × quantity, by region), F-08 (price
realization), F-81 (operating leverage), R-18 (sales quality), F-16 (what the price assumes)."""
from __future__ import annotations

import math

import pandas as pd

LABELS = {"engine": "engine of growth", "steady": "steady", "stalled": "stalled", "shrinking": "shrinking", "recovering": "recovering", "new": "too new to judge"}


def _cagr(a: float | None, b: float | None, years: float) -> float | None:
    if a is None or b is None or a <= 0 or b <= 0 or years <= 0:
        return None
    return (b / a) ** (1 / years) - 1


def region_bridge(rev: pd.DataFrame, ebit: pd.DataFrame | None = None, years: int = 3) -> dict:
    """rev / ebit: fiscal_year (index, ascending) × segment columns, with a 'total' column where available.

    Returns {rows: [...per region...], baseline_growth_pct, last_year_growth_pct, concentration_pct, largest, bridge: [...]}.
    Each row: segment, revenue, share_pct, growth_1y_pct, cagr_pct, contribution_pp (to last year's total growth),
    margin_pct, margin_change_pp (vs `years` ago), label."""
    if rev is None or rev.empty or len(rev) < 2:
        return {"rows": [], "baseline_growth_pct": None, "last_year_growth_pct": None, "concentration_pct": None, "largest": None, "bridge": []}
    rev = rev.sort_index()
    segs = [c for c in rev.columns if c != "total"]
    last, prev = rev.iloc[-1], rev.iloc[-2]
    base_idx = max(0, len(rev) - 1 - years)
    base = rev.iloc[base_idx]
    n_years = len(rev) - 1 - base_idx
    total_last = float(last.get("total")) if "total" in rev.columns and pd.notna(last.get("total")) else float(last[segs].sum())
    total_prev = float(prev.get("total")) if "total" in rev.columns and pd.notna(prev.get("total")) else float(prev[segs].sum())
    rows = []
    for s in segs:
        r_last, r_prev, r_base = last.get(s), prev.get(s), base.get(s)
        if r_last is None or pd.isna(r_last):
            continue
        g1 = (r_last / r_prev - 1) if r_prev and pd.notna(r_prev) and r_prev > 0 else None
        cg = _cagr(float(r_base) if pd.notna(r_base) else None, float(r_last), n_years) if n_years > 0 else None
        m_now = m_then = None
        if ebit is not None and s in ebit.columns:
            e_last = ebit[s].iloc[-1] if len(ebit) else None
            e_base = ebit[s].iloc[base_idx] if len(ebit) > base_idx else None
            m_now = float(e_last / r_last) if e_last is not None and pd.notna(e_last) and r_last else None
            m_then = float(e_base / r_base) if e_base is not None and pd.notna(e_base) and r_base and pd.notna(r_base) and r_base > 0 else None
        if cg is None:
            label = "new"
        elif cg >= 0.08 and (g1 is None or g1 >= 0):
            label = "engine"
        elif cg >= 0.02 and (g1 is None or g1 >= -0.02):
            label = "steady"
        elif cg < -0.02 and g1 is not None and g1 > 0.03:
            label = "recovering"
        elif cg < -0.02:
            label = "shrinking"
        else:
            label = "stalled"
        rows.append({"segment": s, "revenue": float(r_last), "share_pct": float(r_last / total_last * 100) if total_last else None,
                     "growth_1y_pct": g1 * 100 if g1 is not None else None, "cagr_pct": cg * 100 if cg is not None else None, "cagr_years": n_years,
                     "contribution_pp": float((r_last - r_prev) / total_prev * 100) if r_prev is not None and pd.notna(r_prev) and total_prev else None,
                     "margin_pct": m_now * 100 if m_now is not None else None,
                     "margin_change_pp": (m_now - m_then) * 100 if m_now is not None and m_then is not None else None, "label": label})
    rows.sort(key=lambda r: -(r["revenue"] or 0))
    weights = [(r["share_pct"] or 0) / 100 for r in rows if r["cagr_pct"] is not None]
    baseline = sum((r["share_pct"] or 0) / 100 * r["cagr_pct"] for r in rows if r["cagr_pct"] is not None) / sum(weights) if weights and sum(weights) > 0 else None
    bridge = [{"segment": r["segment"], "delta": r["revenue"] - float(prev.get(r["segment"])) if pd.notna(prev.get(r["segment"])) else None} for r in rows]
    return {"rows": rows, "baseline_growth_pct": baseline, "last_year_growth_pct": (total_last / total_prev - 1) * 100 if total_prev else None,
            "concentration_pct": rows[0]["share_pct"] if rows else None, "largest": rows[0]["segment"] if rows else None, "bridge": bridge,
            "fiscal_year": str(rev.index[-1]), "prev_fiscal_year": str(rev.index[-2])}


def channel_mix(rev_by_channel: pd.DataFrame, direct_key: str = "Direct", years: int = 3) -> dict | None:
    """Direct-to-consumer share of revenue and its change — the push-to-pull shift (Mars & Co: 'move from push to pull')."""
    if rev_by_channel is None or rev_by_channel.empty:
        return None
    cols = [c for c in rev_by_channel.columns if c != "total"]
    direct = [c for c in cols if direct_key.lower() in c.lower()]
    if not direct:
        return None
    df = rev_by_channel.sort_index()
    tot = df[cols].sum(axis=1)
    share = (df[direct].sum(axis=1) / tot).dropna()
    if share.empty:
        return None
    then = share.iloc[max(0, len(share) - 1 - years)]
    return {"direct_share_pct": float(share.iloc[-1] * 100), "direct_share_change_pp": float((share.iloc[-1] - then) * 100), "years": min(years, len(share) - 1),
            "direct_label": direct[0], "history": [[str(i), round(float(v) * 100, 1)] for i, v in share.items()]}


def sales_quality(fy: pd.DataFrame | None) -> dict:
    """Is the growth real? Inventory and receivables against revenue (forward buying and channel loading show up here),
    gross margin against three years ago (price realization). fy: FY history with revenue, inventory, receivables,
    gross_profit / cost_of_revenue columns (period_end index)."""
    out = {"inventory_days": None, "inventory_days_change": None, "dso": None, "dso_change": None, "inventory_vs_revenue_pp": None,
           "receivables_vs_revenue_pp": None, "gross_margin_pct": None, "gross_margin_change_pp": None, "flags": [], "verdict": None}
    if fy is None or fy.empty or "revenue" not in fy.columns or len(fy) < 2:
        out["verdict"] = "Not enough history to judge the quality of the sales."
        return out
    f = fy.sort_index()
    rev = f["revenue"].astype(float)
    cogs = f["cost_of_revenue"].astype(float) if "cost_of_revenue" in f.columns else (rev - f["gross_profit"].astype(float) if "gross_profit" in f.columns else None)
    def last_two(col):
        if col not in f.columns:
            return None, None
        s = f[col].astype(float).dropna()
        return (float(s.iloc[-1]), float(s.iloc[-2])) if len(s) >= 2 else ((float(s.iloc[-1]), None) if len(s) else (None, None))
    inv_now, inv_prev = last_two("inventory")
    rec_now, rec_prev = last_two("receivables")
    r_now, r_prev = float(rev.iloc[-1]), float(rev.iloc[-2])
    rg = r_now / r_prev - 1 if r_prev else None
    if inv_now and cogs is not None and len(cogs.dropna()) >= 2:
        c_now, c_prev = float(cogs.iloc[-1]), float(cogs.iloc[-2])
        out["inventory_days"] = inv_now / c_now * 365 if c_now else None
        if inv_prev and c_prev:
            out["inventory_days_change"] = out["inventory_days"] - inv_prev / c_prev * 365
    if inv_now and inv_prev and rg is not None:
        out["inventory_vs_revenue_pp"] = ((inv_now / inv_prev - 1) - rg) * 100
    if rec_now and r_now:
        out["dso"] = rec_now / r_now * 365
        if rec_prev and r_prev:
            out["dso_change"] = out["dso"] - rec_prev / r_prev * 365
    if rec_now and rec_prev and rg is not None:
        out["receivables_vs_revenue_pp"] = ((rec_now / rec_prev - 1) - rg) * 100
    if cogs is not None and len(cogs.dropna()) >= 2:
        gm = (1 - cogs / rev) * 100
        out["gross_margin_pct"] = float(gm.iloc[-1])
        then = gm.iloc[max(0, len(gm) - 4)]
        out["gross_margin_change_pp"] = float(gm.iloc[-1] - then)
    flags = []
    if out["inventory_vs_revenue_pp"] is not None and out["inventory_vs_revenue_pp"] > 10:
        flags.append(f"inventory grew {out['inventory_vs_revenue_pp']:.0f} points faster than revenue — product is being built or pushed ahead of demand")
    if out["receivables_vs_revenue_pp"] is not None and out["receivables_vs_revenue_pp"] > 10:
        flags.append(f"receivables grew {out['receivables_vs_revenue_pp']:.0f} points faster than revenue — sales are being financed with longer terms (forward buying, channel loading)")
    if out["gross_margin_change_pp"] is not None and out["gross_margin_change_pp"] < -2:
        flags.append(f"gross margin is {abs(out['gross_margin_change_pp']):.1f} points below three years ago — price realization is slipping (the list-to-realised gap is widening)")
    if out["gross_margin_change_pp"] is not None and out["gross_margin_change_pp"] > 2:
        flags.append(f"gross margin is {out['gross_margin_change_pp']:.1f} points above three years ago — price is being realised, not given away")
    out["flags"] = flags
    bad = sum(1 for x in flags if "faster than revenue" in x or "slipping" in x)
    out["verdict"] = ("The sales look pushed: " + "; ".join(flags) + "." if bad >= 2 else
                      ("One warning on sales quality: " + flags[0] + "." if bad == 1 else
                       ("The sales look earned: inventory and receivables are moving with revenue" + (" and " + flags[0] if flags else "") + "." )))
    return out


def baseline_vs_required(baseline_pct: float | None, implied_pct: float | None, reach_margin_discount: float = 0.5) -> dict:
    """Mars & Co's question against the market's: the price asks for implied growth; the regions' own trends give the
    baseline. The gap must come from 'reach' — new channels, segments or regions — which the playbook says arrives at
    lower margin and needs investment."""
    if baseline_pct is None or implied_pct is None:
        return {"baseline_pct": baseline_pct, "required_pct": implied_pct, "reach_gap_pp": None, "verdict": None}
    gap = implied_pct - baseline_pct
    if gap <= 0:
        v = f"The regions' own trends ({baseline_pct:.0f}% a year) already cover what the price asks ({implied_pct:.0f}%); no reach growth is needed."
    elif gap <= 3:
        v = f"The baseline ({baseline_pct:.0f}% a year) nearly covers the price's {implied_pct:.0f}%; the {gap:.0f}-point gap is ordinary execution."
    else:
        v = (f"The regions' own trends give {baseline_pct:.0f}% a year; the price asks {implied_pct:.0f}%. The {gap:.0f}-point gap must come from reach — "
             f"new channels, segments or regions — which arrives at lower margin and needs investment first.")
    return {"baseline_pct": baseline_pct, "required_pct": implied_pct, "reach_gap_pp": gap, "verdict": v}


def region_sentences(bridge: dict, currency: str = "USD") -> list[str]:
    """Plain sentences for the regions, strongest claim first."""
    rows = bridge.get("rows") or []
    if not rows:
        return []
    out = []
    unit = "bn" if max(r["revenue"] for r in rows) >= 1e9 else "m"
    div = 1e9 if unit == "bn" else 1e6
    big = rows[0]
    out.append(f"{big['segment']} is the largest region at {big['share_pct']:.0f}% of revenue ({big['revenue']/div:,.1f}{unit} {currency}), "
               f"{LABELS[big['label']]}" + (f" at {big['cagr_pct']:+.0f}% a year over {big['cagr_years']} years" if big['cagr_pct'] is not None else "") + ".")
    engines = [r for r in rows[1:] if r["label"] == "engine"]
    weak = [r for r in rows if r["label"] in ("shrinking", "stalled")]
    if engines:
        out.append("Growing fastest: " + ", ".join(f"{r['segment']} ({r['cagr_pct']:+.0f}% a year, {r['share_pct']:.0f}% of revenue)" for r in engines) + ".")
    if weak:
        out.append("Holding the company back: " + ", ".join(f"{r['segment']} ({r['cagr_pct']:+.0f}% a year" + (f", {r['growth_1y_pct']:+.0f}% last year" if r['growth_1y_pct'] is not None else "") + ")" for r in weak) + ".")
    if bridge.get("last_year_growth_pct") is not None:
        contrib = sorted([r for r in rows if r["contribution_pp"] is not None], key=lambda r: -abs(r["contribution_pp"]))[:3]
        out.append(f"Last year's {bridge['last_year_growth_pct']:+.0f}% came from " + ", ".join(f"{r['segment']} {r['contribution_pp']:+.1f} points" for r in contrib) + ".")
    margins = [r for r in rows if r["margin_pct"] is not None]
    if margins:
        hi, lo = max(margins, key=lambda r: r["margin_pct"]), min(margins, key=lambda r: r["margin_pct"])
        out.append(f"Margins run from {hi['margin_pct']:.0f}% in {hi['segment']} to {lo['margin_pct']:.0f}% in {lo['segment']}" +
                   (f"; the biggest margin move is {max(margins, key=lambda r: abs(r['margin_change_pp'] or 0))['segment']} at {max(margins, key=lambda r: abs(r['margin_change_pp'] or 0))['margin_change_pp']:+.0f} points over {rows[0]['cagr_years']} years." if any(r['margin_change_pp'] is not None for r in margins) else "."))
    return out


def lens_score(bridge: dict, quality: dict, mix: dict | None, reach: dict) -> dict:
    """A 0–100 read for the back-up panel: regions (breadth of growth), sales quality, channel shift, reach gap."""
    pts, notes = 50.0, []
    rows = bridge.get("rows") or []
    if rows:
        growing = sum(1 for r in rows if r["label"] in ("engine", "steady", "recovering"))
        pts += 20 * (growing / len(rows) - 0.5)
        notes.append(f"{growing} of {len(rows)} regions growing")
    bad = sum(1 for f in quality.get("flags", []) if "faster than revenue" in f or "slipping" in f)
    pts -= 10 * bad
    if quality.get("gross_margin_change_pp") is not None and quality["gross_margin_change_pp"] > 2:
        pts += 8
    if mix and mix.get("direct_share_change_pp") is not None:
        pts += max(-6, min(6, mix["direct_share_change_pp"] / 2))
    if reach.get("reach_gap_pp") is not None:
        pts -= max(0, min(15, reach["reach_gap_pp"]))
    pts = max(0.0, min(100.0, pts))
    return {"score": pts, "notes": notes, "n_regions": len(rows)}


def fmt_money(x: float | None, currency: str = "USD") -> str:
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return "–"
    a = abs(x)
    s = f"{x/1e9:,.1f}bn" if a >= 1e9 else (f"{x/1e6:,.0f}m" if a >= 1e6 else f"{x:,.0f}")
    return f"{s} {currency}"
