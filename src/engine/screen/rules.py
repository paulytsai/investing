"""Load rules/screen.yaml; tag asset_type / ai_layer; resolve thresholds to (value, status, decision_id)."""
from __future__ import annotations

from functools import lru_cache
from typing import Any

import yaml

from ..config import ROOT, Hypotheses, get_path, holdings, philosophy


@lru_cache(maxsize=None)
def rules() -> dict[str, Any]:
    with open(ROOT / "rules" / "screen.yaml", encoding="utf-8") as f:
        return yaml.safe_load(f)


def resolve_threshold(ref: str | None, hyp: Hypotheses) -> tuple[Any, str, str | None]:
    """'hypotheses:thresholds.peg_ceiling' → (2.0, 'hypothesis', 'D-25'); 'philosophy:a.b' → (v, 'stated', None)."""
    if not ref:
        return None, "n/a", None
    src, _, path = ref.partition(":")
    if src == "hypotheses":
        e = hyp.entry(path)
        hyp.get(path)
        did = e.get("decision_id")
        return e.get("value"), "hypothesis", (None if did in (None, "none") else did)
    if src == "philosophy":
        v = get_path(philosophy(), path)
        if isinstance(v, str) and v.startswith("TBD("):
            return None, "tbd", None
        return v, "stated", None
    return None, "n/a", None


def _match(industry: str | None, sector: str | None, keywords: list[str]) -> bool:
    text = f"{industry or ''} | {sector or ''}".lower()
    return any(k.lower() in text for k in keywords)


def asset_type_for(symbol: str, industry: str | None, sector: str | None) -> str:
    r = rules()
    if symbol in r.get("oil_majors", []):
        return "non_commodity"          # R-04 exception: barbell insurance, handled via role
    m = r["asset_type_map"]
    for at in ("fund_etf", "bank", "real_estate", "miner_resource", "commodity_cyclical"):
        if _match(industry, sector, m.get(at, [])):
            return at
    return "non_commodity"


def ai_layer_for(symbol: str, industry: str | None, sector: str | None) -> str:
    m = rules()["ai_layer_map"]
    if symbol in m.get("overrides", {}):
        return m["overrides"][symbol]
    for layer in ("upstream", "midstream_receipts", "midstream_reseller", "downstream_tollbooth"):
        if _match(industry, sector, m.get(layer, [])):
            return layer
    return "none"


def ai_layer_score(layer: str) -> float:
    return float(rules()["ai_layer_map"]["layer_score"].get(layer, 0.5))


def role_hint_for(symbol: str, asset_type: str) -> str:
    r = rules()
    h = holdings()
    if symbol in r.get("oil_majors", []):
        return "barbell_insurance"
    for p in h["positions"]:
        if p["symbol"] == symbol:
            return p.get("role", "core_growth")
    if asset_type in ("commodity_cyclical", "miner_resource"):
        return "trade"
    if asset_type == "real_estate":
        return "stable_income"
    return "core_growth"


def held_symbols() -> set[str]:
    return {p["symbol"] for p in holdings()["positions"]}
