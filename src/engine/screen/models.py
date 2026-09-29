"""Typed artifacts shown to Paul (spec §4.1 / §8.4 rendered as pydantic models)."""
from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

Encoding = Literal["HARD", "SOFT", "ALERT", "GATE"]
ThresholdStatus = Literal["stated", "hypothesis", "tbd", "n/a"]


class ReasonComponent(BaseModel):
    rule_id: str
    framework_id: str | None = None
    factor_key: str
    label: str
    kind: Literal["factor", "exclusion", "gate", "penalty", "annotation"] = "factor"
    angle: str | None = None
    metric: str | None = None
    value: float | None = None
    unit: str = ""
    period_end: date | None = None
    period_basis: str = "n/a"
    source: str = "derived"
    as_of: date | None = None
    direction: Literal["higher_better", "lower_better", "n/a"] = "n/a"
    rank_pct: float | None = None
    z: float | None = None
    weight: float | None = None
    contribution: float | None = None
    threshold: float | str | None = None
    threshold_status: ThresholdStatus = "n/a"
    decision_id: str | None = None
    status: Literal["scored", "missing", "excluded", "veto", "avoid", "size_cap", "checkpoint", "stale", "info"] = "scored"
    encoding: Encoding = "SOFT"
    note: str | None = None


class GateResult(BaseModel):
    gate_id: str
    name: str
    rule_id: str
    outcome: Literal["pass", "veto", "avoid", "size_cap", "checkpoint", "substitute", "unknown"]
    evidence: str
    proxy: bool = False
    encoding: Encoding = "HARD"
    decision_id: str | None = None


class Alert(BaseModel):
    rule_id: str
    encoding: Encoding = "ALERT"
    message: str
    decision_ids: list[str] = Field(default_factory=list)


class AngleScore(BaseModel):
    key: str
    label: str
    score: float | None            # 0–100 percentile within region × date
    z: float | None
    coverage: float
    weight: float
    components: list[str] = Field(default_factory=list)   # factor keys


class IdeaCandidate(BaseModel):
    security_id: str
    symbol: str
    name: str | None = None
    region: str
    as_of: date
    sector: str | None = None
    industry: str | None = None
    country: str | None = None
    asset_type: str = "non_commodity"
    ai_layer: str = "none"
    role_hint: str = "core_growth"
    market_cap: float | None = None
    price: float | None = None
    currency: str = "USD"
    idea_strength: float | None = None
    rank: int | None = None
    coverage: float = 0.0
    eligible: bool = True
    excluded_by: list[str] = Field(default_factory=list)
    action: Literal["buy-in-stages", "watch", "pass", "excluded", "insufficient_data"] = "pass"
    action_reason: str = ""
    size_tier: Literal["core", "non_core", "speculative", "n/a"] = "n/a"
    entry_plan: dict = Field(default_factory=dict)
    angles: list[AngleScore] = Field(default_factory=list)
    reasons: list[ReasonComponent] = Field(default_factory=list)
    gates: list[GateResult] = Field(default_factory=list)
    alerts: list[Alert] = Field(default_factory=list)
    penalties: list[ReasonComponent] = Field(default_factory=list)
    metrics: dict = Field(default_factory=dict)
    fit_notes: list[str] = Field(default_factory=list)
    stale: bool = False
    basis: str = "TTM"
    period_end: date | None = None
    decisions_touched: list[str] = Field(default_factory=list)
