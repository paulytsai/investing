"""Exclusions → gates → factor z-scores → angle scores → Idea Strength → proposed action. Region-wide z-scores
(not sector-neutral) with a selection-time sector cap; coverage < min → insufficient_data (never imputed)."""
from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd

from ..config import Hypotheses, holdings
from ..frameworks import core as fw
from .models import Alert, AngleScore, GateResult, IdeaCandidate, ReasonComponent
from .rules import held_symbols, resolve_threshold, rules

FACTOR_UNITS = {
    "rev_growth_ttm": "%", "rev_cagr_3y": "%", "rev_accel": "pp", "ip_pattern": "flag", "gross_margin": "%", "gm_trend_3y": "pp",
    "incremental_margin": "x", "ai_layer_score": "score", "roic_ttm": "%", "ocf_ni_ratio": "x", "fcf_margin": "%", "net_debt_ebitda": "x",
    "pe_own_pctile": "pctile", "peg": "x", "multiple_led_drawdown": "%", "implied_growth_gap": "pp", "upside_to_peak": "%",
    "net_cash_to_cap": "%", "fcf_yield": "%", "insider_net_buy_12m": "% of cap", "shareholder_yield": "%", "beat_streak": "qtrs",
    "eps_growth_ttm": "%", "fit_score": "score",
    "text_demand": "per 10k words", "text_pricing": "per 10k words", "text_guidance": "per 10k words", "text_leadership": "per 10k words",
    "text_red_flags": "per 10k words", "text_ai_receipts": "per 10k words", "llm_demand": "score", "llm_pricing": "score", "llm_position": "score",
    "llm_guidance": "score", "llm_tone": "score", "llm_red_flags": "n", "p_fcf_avg": "x", "p_ocf": "x", "theme_exposure": "per 10k words", "theme_new_entrant": "flag",
}
PCT_FACTORS = {"rev_growth_ttm", "rev_cagr_3y", "gross_margin", "roic_ttm", "fcf_margin", "multiple_led_drawdown", "upside_to_peak",
               "net_cash_to_cap", "fcf_yield", "insider_net_buy_12m", "shareholder_yield", "eps_growth_ttm", "rev_accel", "gm_trend_3y"}


# ------------------------------------------------------------------------------------------
# exclusions & gates
# ------------------------------------------------------------------------------------------
def _exclusion_hits(cand: IdeaCandidate, m: dict, hyp: Hypotheses) -> list[ReasonComponent]:
    r = rules()
    hits = []
    ind = f"{cand.industry or ''} {cand.sector or ''} {cand.name or ''}".lower()
    for x in r["exclusions"]:
        t = x["test"]
        thr, status, did = resolve_threshold(x.get("threshold"), hyp)
        hit, note = False, ""
        if t == "is_fund_or_etf":
            hit = cand.asset_type == "fund_etf" or any(k in ind for k in ("etf", " trust", "fund", "leveraged", "2x ", "3x "))
        elif t == "crypto_or_btc_treasury":
            hit = any(k in ind for k in ("crypto", "bitcoin", "blockchain", "digital asset"))
        elif t == "bank_black_box":
            hit = cand.asset_type == "bank"
        elif t == "recent_ipo":
            hit = bool(m.get("listing_days") is not None and m["listing_days"] < float(thr or 365))
        elif t == "pre_revenue_or_loss_dreamer":
            rev = m.get("revenue_ttm")
            hit = (rev is None or rev < float(thr or 1e8)) or (m.get("loss_making") and (m.get("ps_ttm") or 0) > 15)
            note = f"revenue TTM {rev:,.0f}" if rev else "no revenue"
        elif t == "cyclical_peak_margins":
            hit = cand.asset_type in ("commodity_cyclical", "miner_resource") and (m.get("op_margin_pctile") or 0) >= float(thr or 90)
            note = f"operating margin at {(m.get('op_margin_pctile') or 0):.0f}th pct of own history"
        if hit:
            hits.append(ReasonComponent(rule_id=x["id"], factor_key=t, label=x["label"], kind="exclusion", status="excluded",
                                        encoding=x["encoding"], threshold=thr, threshold_status=status, decision_id=did, note=note or None))
    return hits


def _gates(cand: IdeaCandidate, m: dict, hyp: Hypotheses) -> list[GateResult]:
    g = rules()["gates"]
    out: list[GateResult] = []
    # G1 alignment proxy
    thr, st, did = resolve_threshold(g["G1"]["threshold"], hyp)
    buy, sell = m.get("insider_buy_usd_12m", 0.0), m.get("insider_sell_usd_12m", 0.0)
    shy = m.get("shareholder_yield") or 0.0
    if buy >= float(thr or 1e6):
        o, ev = "pass", f"officer open-market buys ${buy:,.0f} in 12m (≥ ${float(thr):,.0f})"
    elif sell > 20 * max(buy, 1.0) and sell > 5e7 and shy < 0.005:
        o, ev = "avoid", f"officer sales ${sell:,.0f} ≫ buys ${buy:,.0f}, no buybacks/dividends"
    else:
        o, ev = "pass", f"no veto signal (buys ${buy:,.0f}, sales ${sell:,.0f}, shareholder yield {shy*100:.1f}%) — proxy only"
    out.append(GateResult(gate_id="G1", name=g["G1"]["name"], rule_id=g["G1"]["id"], outcome=o, evidence=ev, proxy=True, decision_id=did))
    # G2 value trap
    thr, st, did = resolve_threshold(g["G2"]["threshold"], hyp)
    pbr = m.get("pbr")
    if pbr is not None and thr is not None and pbr < float(thr):
        catalyst = buy > 0 or shy > 0.02
        o = "pass" if catalyst else "avoid"
        ev = f"PBR {pbr:.2f} < {thr}; catalyst {'present' if catalyst else 'absent'} (insider buying or ≥2% shareholder yield)"
    else:
        o, ev = "pass", f"PBR {pbr:.2f}" if pbr is not None else "PBR n/a"
    out.append(GateResult(gate_id="G2", name=g["G2"]["name"], rule_id=g["G2"]["id"], outcome=o, evidence=ev, decision_id=did))
    # G3 balance sheet
    nd_thr, _, did3 = resolve_threshold("hypotheses:thresholds.net_debt_ebitda_max", hyp)
    ocf_thr, _, _ = resolve_threshold("hypotheses:thresholds.ocf_ni_min_ratio", hyp)
    nde, ocfni = m.get("net_debt_ebitda"), m.get("ocf_ni_ratio")
    flags = []
    if nde is not None and nde > float(nd_thr):
        flags.append(f"net debt/EBITDA {nde:.1f}x > {nd_thr}")
    if ocfni is not None and ocfni < float(ocf_thr):
        flags.append(f"OCF/NI {ocfni:.2f} < {ocf_thr}")
    if m.get("debt_funded_negative_fcf"):
        flags.append("negative FCF funded by net debt issuance")
    if len(flags) >= 2 or m.get("debt_funded_negative_fcf"):
        o = "avoid"
    elif flags:
        o = "size_cap"
    else:
        o = "pass"
    out.append(GateResult(gate_id="G3", name=g["G3"]["name"], rule_id=g["G3"]["id"], outcome=o, evidence="; ".join(flags) or "clean", decision_id=did3))
    # G4 speculation: growth the price requires (PE as proxy for 5-yr required CAGR at PEG=1) vs ceiling
    thr, st, did = resolve_threshold(g["G4"]["threshold"], hyp)
    req = m.get("required_cagr_pct")
    if req is None:
        o, ev = ("size_cap", "no positive earnings: non-core by default (F-91)")
    elif req > float(thr) * 2:
        o, ev = "size_cap", f"P/E {req:.0f}x implies >{thr}% growth for a PEG of 1 → non-core"
    else:
        o, ev = "pass", f"P/E {req:.0f}x vs {thr}% ceiling"
    out.append(GateResult(gate_id="G4", name=g["G4"]["name"], rule_id=g["G4"]["id"], outcome=o, evidence=ev, decision_id=did))
    # G5 yield trap
    hy, _, _ = resolve_threshold("hypotheses:thresholds.high_yield_pct", hyp)
    cov_min, _, did5 = resolve_threshold("hypotheses:thresholds.dividend_coverage_min", hyp)
    dy, cov = m.get("dividend_yield"), m.get("dividend_coverage")
    if dy is not None and dy * 100 >= float(hy):
        if cov is not None and cov < float(cov_min):
            o, ev = "avoid", f"yield {dy*100:.1f}% with FCF coverage {cov:.2f}x < {cov_min}"
        else:
            o, ev = "checkpoint", f"yield {dy*100:.1f}% ≥ {hy}%: income gate (R-16 five questions)"
    else:
        o, ev = "pass", f"yield {(dy or 0)*100:.1f}%"
    out.append(GateResult(gate_id="G5", name=g["G5"]["name"], rule_id=g["G5"]["id"], outcome=o, evidence=ev, decision_id=did5))
    out.append(GateResult(gate_id="G6", name=g["G6"]["name"], rule_id=g["G6"]["id"], outcome="pass", evidence="US-listed", encoding="ALERT"))
    return out


# ------------------------------------------------------------------------------------------
# scoring across a universe
# ------------------------------------------------------------------------------------------
def _fit_score(cand: IdeaCandidate) -> tuple[float, list[str]]:
    h = holdings()
    notes = []
    score = 0.7
    if cand.symbol in held_symbols():
        notes.append("already held (RP) — an add, not a new idea")
        score -= 0.1
    if cand.symbol in h.get("deliberately_not_held", []):
        notes.append("Paul deliberately does not hold this (spec §5.1)")
        score -= 0.4
    if cand.ai_layer in ("midstream_reseller", "commodity_midstream"):
        notes.append("commodity-midstream / borrowed-compute layer: avoid per F-43")
        score -= 0.4
    if cand.ai_layer == "downstream_tollbooth" and cand.symbol not in held_symbols():
        notes.append("toll-booth layer already held thickly (GOOGL/META/SAP/NFLX): redundancy check R-40")
        score -= 0.1
    if cand.role_hint == "barbell_insurance":
        notes.append("barbell insurance leg (R-77)")
        score += 0.2
    if cand.ai_layer == "upstream":
        score += 0.1
    return max(0.0, min(1.0, score)), notes


def score_universe(cands: list[IdeaCandidate], hyp: Hypotheses, preset_name: str | None = None) -> list[IdeaCandidate]:
    r = rules()
    weights = hyp.preset(preset_name)
    cov_min = float(hyp.get("screen.coverage_min"))
    winsor = float(hyp.get("screen.winsor_pct"))
    as_of = cands[0].as_of if cands else date.today()

    # exclusions + gates + fit first
    for c in cands:
        m = c.metrics
        c.excluded_by = []
        for h in _exclusion_hits(c, m, hyp):
            c.reasons.append(h)
            c.excluded_by.append(h.rule_id)
        c.gates = _gates(c, m, hyp)
        fs, notes = _fit_score(c)
        m["fit_score"] = fs
        c.fit_notes = notes
        if c.stale:
            c.alerts.append(Alert(rule_id="PIT", message=f"latest visible period {c.period_end} is stale (> stale_days)"))

    # factor matrix
    keys = [f["key"] for a in r["angles"].values() for f in a["factors"]]
    df = pd.DataFrame({k: [c.metrics.get(k) for c in cands] for k in keys}, index=[c.security_id for c in cands]).astype(float)
    zs = pd.DataFrame(index=df.index)
    for a in r["angles"].values():
        for f in a["factors"]:
            k = f["key"]
            s = df[k]
            if s.notna().sum() < 3:
                zs[k] = np.nan
                continue
            z = fw.zscore(s, winsor)
            if f["dir"] == "lower_better":
                z = -z
            zs[k] = z
    pct = df.rank(pct=True) * 100

    # angle z → percentile scores
    angle_z = pd.DataFrame(index=df.index)
    angle_cov = pd.DataFrame(index=df.index)
    for ak, a in r["angles"].items():
        w = pd.Series({f["key"]: f["weight"] for f in a["factors"]})
        # a factor with no data anywhere in this universe/date (e.g. live-only Claude reads inside the backtest) is not
        # "missing coverage" for anyone: it drops out of the denominator for this date
        present = pd.Series({k: bool(zs[k].notna().any()) for k in w.index})
        w = w[present[present].index]
        zz = zs[w.index]
        avail = zz.notna().astype(float)
        wsum = (avail * w).sum(axis=1)
        angle_z[ak] = (zz.fillna(0) * w).sum(axis=1) / wsum.replace(0, np.nan)
        angle_cov[ak] = wsum / w.sum() if len(w) and w.sum() > 0 else 0.0
    angle_pct = angle_z.rank(pct=True) * 100

    for c in cands:
        sid = c.security_id
        c.angles = []
        total_w = used_w = 0.0
        strength = 0.0
        for ak, a in r["angles"].items():
            w = float(weights.get(ak, 0))
            total_w += w
            sc = angle_pct.loc[sid, ak]
            cov = float(angle_cov.loc[sid, ak])
            if not np.isnan(sc) and cov > 0:
                used_w += w
                strength += w * float(sc)
            c.angles.append(AngleScore(key=ak, label=a["label"], score=None if np.isnan(sc) else float(sc),
                                       z=None if np.isnan(angle_z.loc[sid, ak]) else float(angle_z.loc[sid, ak]), coverage=cov, weight=w,
                                       components=[f["key"] for f in a["factors"]]))
            for f in a["factors"]:
                k = f["key"]
                v = c.metrics.get(k)
                thr, st, did = resolve_threshold(f.get("threshold"), hyp)
                z = zs.loc[sid, k] if k in zs.columns else np.nan
                pr = pct.loc[sid, k] if k in pct.columns else np.nan
                val = None if v is None or (isinstance(v, float) and np.isnan(v)) else float(v)
                unit = FACTOR_UNITS.get(k, "")
                c.reasons.append(ReasonComponent(
                    rule_id=f["id"], factor_key=k, label=f["label"], kind="factor", angle=ak, metric=k,
                    value=(val * 100 if (val is not None and k in PCT_FACTORS) else val), unit=unit,
                    period_end=c.period_end, period_basis=c.basis, source="fmp/derived", as_of=as_of, direction=f["dir"],
                    rank_pct=None if np.isnan(pr) else float(pr), z=None if np.isnan(z) else float(z), weight=float(f["weight"]) * w,
                    contribution=None if np.isnan(z) else float(z) * float(f["weight"]) * w,
                    threshold=thr, threshold_status=st, decision_id=did, status="scored" if val is not None else "missing"))
        c.coverage = used_w / total_w if total_w else 0.0
        base = strength / used_w if used_w else None
        # penalties
        c.penalties = []
        if base is not None:
            for p in r["penalties"]:
                thr, st, did = resolve_threshold(p.get("threshold"), hyp)
                if p["key"] == "run_up_penalty" and (c.metrics.get("run_up_12m") or 0) * 100 >= float(thr or 50):
                    base -= p["points"]
                    c.penalties.append(ReasonComponent(rule_id=p["id"], factor_key=p["key"], label=p["label"], kind="penalty",
                                                       value=c.metrics["run_up_12m"] * 100, unit="%", threshold=thr, threshold_status=st,
                                                       decision_id=did, contribution=-p["points"], status="scored"))
                if p["key"].startswith("geopolitical_penalty") and c.country and c.country.upper() in {x.upper() for x in p.get("countries", [])}:
                    base -= p["points"]
                    c.penalties.append(ReasonComponent(rule_id=p["id"], factor_key=p["key"], label=p["label"], kind="penalty",
                                                       value=None, unit="", note=f"domicile {c.country}", contribution=-p["points"], status="scored"))
                if p["key"] == "cyclical_high_margin_penalty" and c.asset_type in ("commodity_cyclical", "miner_resource") and (c.metrics.get("op_margin_pctile") or 0) >= 75:
                    base -= p["points"]
                    c.penalties.append(ReasonComponent(rule_id=p["id"], factor_key=p["key"], label=p["label"], kind="penalty",
                                                       value=c.metrics["op_margin_pctile"], unit="pctile", contribution=-p["points"], status="scored"))
        c.idea_strength = None if base is None else float(max(0.0, min(100.0, base)))
        c.eligible = not c.excluded_by and c.coverage >= cov_min and not c.stale
        if any(g.outcome in ("veto", "avoid") for g in c.gates):
            c.eligible = False
        c.decisions_touched = hyp.decisions_touched()
    _assign_actions(cands, hyp)
    return cands


def _assign_actions(cands: list[IdeaCandidate], hyp: Hypotheses) -> None:
    buy_min = float(hyp.get("screen.action.buy_strength_min"))
    sale_min = float(hyp.get("screen.action.on_sale_min"))
    watch_min = float(hyp.get("screen.action.watch_strength_min"))
    tranches = int(hyp.get("sizing.tranches"))
    core_band = hyp.get("sizing.core_band_pct")
    nc_band = hyp.get("sizing.non_core_band_pct")
    spec_max = hyp.get("sizing.speculative_max_pct")
    for c in cands:
        on_sale = next((a.score for a in c.angles if a.key == "on_sale"), None)
        gate_out = {g.gate_id: g.outcome for g in c.gates}
        if c.excluded_by:
            c.action, c.action_reason = "excluded", "HARD exclusion: " + ", ".join(c.excluded_by)
            continue
        if c.idea_strength is None or c.coverage < float(hyp.get("screen.coverage_min")) or c.stale:
            c.action, c.action_reason = "insufficient_data", f"coverage {c.coverage:.0%}, stale={c.stale}"
            continue
        if any(o in ("veto", "avoid") for o in gate_out.values()):
            bad = [g for g, o in gate_out.items() if o in ("veto", "avoid")]
            c.action, c.action_reason = "pass", "gate " + ", ".join(bad) + " → avoid"
            continue
        size_capped = any(o == "size_cap" for o in gate_out.values())
        c.size_tier = "non_core" if size_capped else ("speculative" if c.role_hint == "speculative" else "core")
        band = (nc_band if c.size_tier == "non_core" else ([0, spec_max] if c.size_tier == "speculative" else core_band))
        if c.idea_strength >= buy_min and (on_sale or 0) >= sale_min:
            c.action = "buy-in-stages"
            c.action_reason = f"Idea Strength {c.idea_strength:.0f} ≥ {buy_min:.0f} and on-sale angle {(on_sale or 0):.0f} ≥ {sale_min:.0f}; no avoid gate"
            lo = c.metrics.get("pe_band_low")
            eps = c.metrics.get("eps_ttm")
            level = (lo * eps) if (lo and eps and eps > 0) else None
            c.entry_plan = {"tranches": tranches, "size_band_pct": band, "first_tranche_now": True,
                            "add_level_pe_band_low": level, "note": "R-30 staged entry; R-34 pre-set 買いたい価格水準 at the own-band 10th percentile P/E (hypothesis)"}
        elif c.idea_strength >= watch_min or any(o == "checkpoint" for o in gate_out.values()):
            c.action = "watch"
            why = []
            if (on_sale or 0) < sale_min:
                why.append(f"not on sale (angle {(on_sale or 0):.0f} < {sale_min:.0f}; R-31 don't chase)")
            if any(o == "checkpoint" for o in gate_out.values()):
                why.append("open gate checkpoint")
            if c.idea_strength < buy_min:
                why.append(f"strength {c.idea_strength:.0f} < {buy_min:.0f}")
            c.action_reason = "; ".join(why) or "watch"
            c.entry_plan = {"tranches": tranches, "size_band_pct": band}
        else:
            c.action, c.action_reason = "pass", f"Idea Strength {c.idea_strength:.0f} < {watch_min:.0f}"


def select_top(cands: list[IdeaCandidate], top_n: int, max_per_sector: int | None) -> list[IdeaCandidate]:
    ranked = sorted([c for c in cands if c.idea_strength is not None], key=lambda c: -c.idea_strength)
    chosen, per_sector = [], {}
    for c in ranked:
        if not c.eligible:
            continue
        sec = c.sector or "?"
        if max_per_sector and per_sector.get(sec, 0) >= max_per_sector:
            continue
        chosen.append(c)
        per_sector[sec] = per_sector.get(sec, 0) + 1
        if len(chosen) >= top_n:
            break
    for i, c in enumerate(ranked, 1):
        c.rank = i
    return chosen
