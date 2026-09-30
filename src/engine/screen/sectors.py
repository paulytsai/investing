"""Stage 1 of the pipeline — the sector call. Theme sectors are built from GICS-style sector/industry with the AI value
chain split into layers (point-in-time membership through the transcript theme signal); each sector is evaluated on its
members' growth, fundamental momentum, quality, valuation and theme diffusion, gets a stance and a written rationale that
lists the numbers used, and the stock stage then picks the best names inside each sector (allocation before selection)."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
import yaml
from pydantic import BaseModel, Field

from ..config import CONFIG_DIR
from ..frameworks import core as fw
from .models import IdeaCandidate

AI_THEMES = ("ai_compute", "agentic_ai", "memory_hbm", "ai_power_grid")


def cfg() -> dict:
    return yaml.safe_load((CONFIG_DIR / "sectors.yaml").read_text(encoding="utf-8"))


def _norm(s: str | None) -> str:
    return (s or "").strip().lower()


def classify(c: IdeaCandidate, cfg_: dict | None = None) -> tuple[str, str | None]:
    """→ (theme_sector, ai_layer or None). AI layers first: core industries always; other listed industries only when the
    name's own calls talk about AI at ≥ the threshold (metrics['ai_theme_intensity'], per 10k words, point-in-time)."""
    k = cfg_ or cfg()
    ind, sec, sym = _norm(c.industry), _norm(c.sector), (c.symbol or "").upper()
    thr = float(k["ai_theme_min_per_10k"]["value"])
    inten = float(c.metrics.get("ai_theme_intensity") or 0.0)
    for layer, spec in k["ai_layers"].items():          # named members first (a hyperscaler is infrastructure whatever its industry code)
        if sym in set(spec.get("symbols", [])):
            return layer, layer
    for layer, spec in k["ai_layers"].items():
        inds = {_norm(x) for x in spec.get("industries", [])}
        always = spec.get("always", False) or ind in {_norm(x) for x in spec.get("always_industries", [])}
        if ind in inds and (always or inten >= thr):
            return layer, layer
    if inten >= 2 * thr:                      # any other industry talking about AI at twice the threshold joins by its sector
        fb = k.get("fallback_by_sector", {})
        layer = fb.get(c.sector or "", fb.get("default", "ai_applications"))
        return layer, layer
    for key, spec in k["theme_sectors"].items():
        if sec in {_norm(x) for x in spec.get("sectors", [])}:
            return key, None
    return "other", None


class SectorCall(BaseModel):
    sector: str
    label: str
    as_of: str
    n_members: int
    n_eligible: int
    score: float | None = None
    stance: str = "neutral"                 # overweight | neutral | underweight | avoid | thin
    inputs: dict = Field(default_factory=dict)      # aggregate → value (the numbers the call used)
    ranks: dict = Field(default_factory=dict)       # aggregate → rank among sectors (1 = best)
    rationale: list[str] = Field(default_factory=list)
    rule_ids: list[str] = Field(default_factory=lambda: ["R-23", "F-39", "R-14", "D-58"])
    slots: int = 0
    theme: str | None = None
    diffusion: dict = Field(default_factory=dict)
    bet: dict = Field(default_factory=dict)         # the recommended sector bet: market weight, recommended weight, active bet, Kelly-implied, cycle status
    cycle_read: dict = Field(default_factory=dict)  # commodity-cycle read for commodity sectors (phase, capex discipline, dampening, cycle length)
    danoff: dict = Field(default_factory=dict)      # the sector through Danoff's eyes: share smiling, median years to double, best of breed


AGG = {   # aggregate: (metric key, statistic, direction, group, label)
    "rev_growth_med": ("rev_growth_ttm", "median", +1, "growth", "median revenue growth TTM"),
    "rev_accel_med": ("rev_accel", "median", +1, "growth", "median revenue acceleration"),
    "eps_growth_med": ("eps_growth_ttm", "median", +1, "momentum", "median EPS growth TTM"),
    "eps_up_share": ("eps_growth_ttm", "share_pos", +1, "momentum", "share of members growing EPS"),
    "beat_streak_med": ("beat_streak", "median", +1, "momentum", "median EPS beat streak (of 8)"),
    "guidance_net": ("text_guidance", "mean", +1, "momentum", "guidance raised − cut language (calls)"),
    "demand_net": ("text_demand", "mean", +1, "growth", "demand/backlog language (calls)"),
    "roic_med": ("roic_ttm", "median", +1, "quality", "median ROIC"),
    "fcf_margin_med": ("fcf_margin", "median", +1, "quality", "median FCF margin"),
    "pe_pctile_med": ("pe_own_pctile", "median", -1, "valuation", "median own-band P/E percentile"),
    "p_fcf_med": ("p_fcf_avg", "median", -1, "valuation", "median price / 3y-avg FCF"),
    "mom_12m_med": ("run_up_12m", "median", +1, "momentum", "median 12-month price change"),
}


def _stat(vals: list[float], how: str) -> float | None:
    v = np.array([x for x in vals if x is not None and not (isinstance(x, float) and np.isnan(x))], dtype=float)
    if len(v) < 3:
        return None
    if how == "median":
        return float(np.median(v))
    if how == "mean":
        return float(v.mean())
    if how == "share_pos":
        return float((v > 0).mean())
    return None


def _diffusion(theme: str | None, as_of: pd.Timestamp) -> dict:
    """Breadth of the sector's theme in the last completed quarter vs four quarters earlier (point-in-time)."""
    from ..store import has_table, read_df
    from ..text.themes import _quarter

    if not theme or not has_table("theme_quarterly"):
        return {}
    tq = read_df("theme_quarterly", f"theme = '{theme}'").sort_values("quarter")
    tq = tq[tq["quarter"] < _quarter(as_of)]
    if len(tq) < 5:
        return {}
    b1, b0 = float(tq["breadth_pct"].iloc[-1]), float(tq["breadth_pct"].iloc[-5])
    return {"theme": theme, "quarter": tq["quarter"].iloc[-1], "breadth_now": b1, "breadth_4q_ago": b0, "ratio": (b1 / b0) if b0 else None,
            "new_entrants": int(tq["n_new_entrants"].iloc[-1])}


def evaluate_sectors(cands: list[IdeaCandidate], as_of: pd.Timestamp, hyp=None) -> dict[str, SectorCall]:
    """Assign every candidate a theme sector, aggregate, score across sectors, decide the stance and write the rationale."""
    k = cfg()
    labels = {**{key: v["label"] for key, v in k["ai_layers"].items()}, **{key: v["label"] for key, v in k["theme_sectors"].items()}}
    for c in cands:
        ts, layer = classify(c, k)
        c.theme_sector = ts
        if layer:
            c.ai_chain_layer = layer
    groups: dict[str, list[IdeaCandidate]] = {}
    for c in cands:
        groups.setdefault(c.theme_sector, []).append(c)
    rows = {}
    for s, members in groups.items():
        inputs = {}
        for agg, (mk, how, _, _, _) in AGG.items():
            inputs[agg] = _stat([m.metrics.get(mk) for m in members if m.metrics], how)
        rows[s] = inputs
    df = pd.DataFrame(rows).T
    z = pd.DataFrame(index=df.index)
    for agg, (_, _, d, grp, _) in AGG.items():
        col = df[agg].astype(float) if agg in df else pd.Series(np.nan, index=df.index)
        zz = fw.zscore(col, 5.0) if col.notna().sum() >= 3 else pd.Series(np.nan, index=df.index)
        z[agg] = zz * d
    groups_w = k["scoring"]["weights"]
    diff = {}
    for s in df.index:
        diff[s] = _diffusion(k["theme_for_sector"].get(s), as_of)
    dz = pd.Series({s: (math.log(diff[s]["ratio"]) if diff[s].get("ratio") else np.nan) for s in df.index})
    if dz.notna().sum() >= 3:
        dz = fw.zscore(dz, 5.0)
    score_z = pd.Series(0.0, index=df.index)
    wsum = pd.Series(0.0, index=df.index)
    for agg, (_, _, _, grp, _) in AGG.items():
        w = float(groups_w.get(grp, 0)) / sum(1 for a, v in AGG.items() if v[3] == grp)
        avail = z[agg].notna()
        score_z[avail] += z[agg][avail] * w
        wsum[avail] += w
    avail = dz.notna()
    score_z[avail] += dz[avail] * float(groups_w.get("diffusion", 0))
    wsum[avail] += float(groups_w.get("diffusion", 0))
    score_z = score_z / wsum.replace(0, np.nan)
    pct = score_z.rank(pct=True) * 100
    from .commodity import reads_for_sectors

    creads = reads_for_sectors(as_of)                # commodity cycle: disciplined trough lifts the call, undisciplined peak lowers it (D-04)
    for s_, r in creads.items():
        if s_ in pct.index and not np.isnan(pct[s_]):
            pct[s_] = float(np.clip(pct[s_] + r["score_adjust"], 0, 100))
    ranks = {agg: (z[agg].rank(ascending=False)) for agg in AGG}
    ow, uw = float(k["scoring"]["stance"]["overweight_min"]), float(k["scoring"]["stance"]["underweight_max"])
    calls: dict[str, SectorCall] = {}
    for s, members in groups.items():
        inputs = rows[s]
        elig = [m for m in members if m.eligible]
        sc = None if s not in pct.index or np.isnan(pct[s]) else float(pct[s])
        stance = "neutral"
        if len(members) < int(k["scoring"]["min_members"]):
            stance = "thin"
        elif sc is not None and sc >= ow:
            stance = "overweight"
        elif sc is not None and sc <= uw:
            stance = "underweight"
        if (inputs.get("fcf_margin_med") is not None and inputs["fcf_margin_med"] < 0) and (inputs.get("eps_growth_med") is not None and inputs["eps_growth_med"] < 0):
            stance = "avoid"
        why = []
        n = len(df.index)
        for agg, (_, _, d, grp, lab) in AGG.items():
            v = inputs.get(agg)
            if v is None:
                continue
            r = int(ranks[agg][s]) if s in ranks[agg].index and not np.isnan(ranks[agg][s]) else None
            unit = "%" if agg in ("rev_growth_med", "rev_accel_med", "eps_growth_med", "roic_med", "fcf_margin_med", "mom_12m_med") else ""
            val = f"{v*100:+.0f}%" if unit == "%" else (f"{v*100:.0f}%" if agg == "eps_up_share" else f"{v:.1f}")
            why.append(f"{lab} {val} (rank {r}/{n})" if r else f"{lab} {val}")
        d = diff.get(s) or {}
        if d.get("ratio"):
            why.append(f"theme '{d['theme']}' in {d['breadth_now']:.0f}% of calls ({d['quarter']}), {d['ratio']:.1f}× four quarters earlier, {d['new_entrants']} new mentioners")
        cr = creads.get(s) or {}
        if cr:
            why.append(f"commodity cycle: {cr['verdict']} Score {cr['score_adjust']:+.0f} points for the cycle position.")
        from ..frameworks.danoff import danoff_sector

        dreads = [(m.metrics.get("danoff"), m.symbol) for m in elig if m.metrics.get("danoff")]
        dan = danoff_sector([r for r, _ in dreads], [sy for _, sy in dreads]) if dreads else {}
        if dan:
            why.append(dan["verdict"])
        head = {"overweight": "Overweight", "neutral": "Neutral", "underweight": "Underweight", "avoid": "Avoid (members losing money and shrinking earnings)", "thin": "Thin sample — neutral"}[stance]
        calls[s] = SectorCall(sector=s, label=labels.get(s, s), as_of=str(pd.Timestamp(as_of).date()), n_members=len(members), n_eligible=len(elig),
                              score=sc, stance=stance, inputs={a: (None if v is None else float(v)) for a, v in inputs.items()},
                              ranks={a: (None if s not in ranks[a].index or np.isnan(ranks[a][s]) else int(ranks[a][s])) for a in AGG},
                              rationale=[f"{head}: sector score {sc:.0f}/100 across {n} theme sectors" if sc is not None else head] + why,
                              theme=k["theme_for_sector"].get(s), diffusion=d, cycle_read=creads.get(s) or {}, danoff=dan)
    return calls


def allocate_slots(calls: dict[str, SectorCall], top_n: int, max_per_sector: int | None) -> dict[str, int]:
    """Slots per sector ∝ stance weight × sqrt(eligible members); overweight sectors always get ≥ 1; avoid gets 0."""
    sc = cfg()["scoring"]
    k, power = sc["slots"], float(sc.get("size_power", 0.25))
    raw = {}
    for s, c in calls.items():
        w = float(k.get(c.stance if c.stance != "thin" else "neutral", 0.0))
        raw[s] = w * (max(c.n_eligible, 0) ** power) if c.n_eligible else 0.0
    tot = sum(raw.values())
    slots = {s: 0 for s in calls}
    if tot <= 0:
        return slots
    for s, v in raw.items():
        slots[s] = int(round(top_n * v / tot))
        if calls[s].stance == "overweight" and calls[s].n_eligible and slots[s] == 0:
            slots[s] = 1
        if max_per_sector:
            slots[s] = min(slots[s], max_per_sector)
        slots[s] = min(slots[s], calls[s].n_eligible)
    for s in calls:
        calls[s].slots = slots[s]
    return slots


def cycle_status(theme: str | None, as_of: pd.Timestamp, min_breadth: float = 10.0) -> dict:
    """Where the theme is in its cycle, point-in-time from completed quarters: breadth now vs peak, quarters since it first
    reached `min_breadth` of calls (cycle age), and the trend over four quarters (expanding / plateau / contracting)."""
    from ..store import has_table, read_df
    from ..text.themes import _quarter

    if not theme or not has_table("theme_quarterly"):
        return {}
    tq = read_df("theme_quarterly", f"theme = '{theme}'").sort_values("quarter")
    tq = tq[(tq["quarter"] < _quarter(as_of)) & (tq["n_docs_all"] >= 200)].reset_index(drop=True)   # thin early quarters are noise
    if len(tq) < 5:
        return {}
    b = tq["breadth_pct"].astype(float).values
    now, peak, ago4 = float(b[-1]), float(b.max()), float(b[-5])
    live = tq[tq["breadth_pct"] >= min_breadth]
    started = str(live["quarter"].iloc[0]) if len(live) else None
    age_q = int(len(tq) - tq.index.get_loc(live.index[0])) if len(live) else 0
    trend = "expanding" if ago4 > 0 and now / ago4 >= 1.15 else ("contracting" if ago4 > 0 and now / ago4 <= 0.85 else "plateau")
    if now < min_breadth:
        phase = "not a cycle yet" if peak < min_breadth else "faded"
    elif now >= peak * 0.9:
        phase = "at or near peak breadth" if trend != "expanding" else "expanding to new highs"
    elif now <= peak * 0.75:
        phase = "off its peak by 25%+ (cycle-over signal, D-24)"
    else:
        phase = "below peak"
    return {"theme": theme, "quarter": str(tq["quarter"].iloc[-1]), "breadth_now": now, "breadth_peak": peak, "breadth_4q_ago": ago4,
            "cycle_started": started, "cycle_age_quarters": age_q, "trend": trend, "phase": phase}


def sector_bets(calls: dict[str, SectorCall], cands: list[IdeaCandidate], as_of: pd.Timestamp, sizing: dict | None = None) -> dict[str, SectorCall]:
    """Attach the recommended sector bet to every call: market weight (the sector's share of scored market cap), recommended
    weight (market weight × stance multiplier, renormalised to 100%), the active bet in percentage points, what the chosen
    names' Kelly weights imply for the sector, and the theme's cycle status. Written back onto the SectorCall."""
    k = cfg()
    mult = k["scoring"].get("bet_multiplier", {"overweight": 1.5, "neutral": 1.0, "underweight": 0.5, "avoid": 0.0, "thin": 1.0})
    min_b = float(k["scoring"].get("cycle_breadth_min_pct", 10))
    caps: dict[str, float] = {}
    for c in cands:
        if c.market_cap:
            caps[c.theme_sector] = caps.get(c.theme_sector, 0.0) + float(c.market_cap)
    total = sum(caps.values()) or 1.0
    mkt = {s: caps.get(s, 0.0) / total for s in calls}
    raw = {s: mkt[s] * float(mult.get(calls[s].stance, 1.0)) for s in calls}
    rsum = sum(raw.values()) or 1.0
    rec = {s: v / rsum for s, v in raw.items()}
    kw = (sizing or {}).get("weights") or {}
    by_sid = {c.security_id: c for c in cands}
    kelly_by = {}
    for sid, w in kw.items():
        c = by_sid.get(sid)
        if c is not None:
            kelly_by[c.theme_sector] = kelly_by.get(c.theme_sector, 0.0) + float(w)
    for s, call in calls.items():
        bet = rec[s] - mkt[s]
        call.bet = {"market_weight": mkt[s], "recommended_weight": rec[s], "active_bet_pp": bet * 100.0,
                    "direction": ("overweight" if bet > 0.005 else ("underweight" if bet < -0.005 else "market weight")),
                    "multiplier": float(mult.get(call.stance, 1.0)), "kelly_implied_weight": kelly_by.get(s, 0.0),
                    "cycle": cycle_status(call.theme, as_of, min_b),
                    "summary": ""}
        cyc = call.bet["cycle"]
        txt = (f"{call.bet['direction']}: {rec[s]*100:.1f}% vs {mkt[s]*100:.1f}% market weight ({bet*100:+.1f} pp), stance {call.stance} "
               f"(score {call.score:.0f}/100)" if call.score is not None else f"{call.bet['direction']}: stance {call.stance}")
        if kelly_by.get(s):
            txt += f"; the chosen names' Kelly weights put {kelly_by[s]*100:.1f}% here"
        if cyc:
            txt += (f"; theme '{cyc['theme']}' {cyc['phase']} — {cyc['breadth_now']:.0f}% of calls in {cyc['quarter']} vs peak {cyc['breadth_peak']:.0f}%, "
                    f"{cyc['trend']} over four quarters" + (f", cycle age {cyc['cycle_age_quarters']} quarters since {cyc['cycle_started']}" if cyc['cycle_started'] else ""))
        call.bet["summary"] = txt
    return calls
