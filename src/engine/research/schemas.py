"""Typed narrative artifacts (spec §4.1 fields). Numeric checkpoint thresholds are TBD(Paul) unless stated in config."""
from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class Claim(BaseModel):
    text: str
    value: float | None = None
    unit: str | None = None
    period: str = ""          # "FY2025", "Q2 FY2026", "2026-09-30"
    source: str = ""          # doc id from context (e.g. "10-K FY2025 Item 7") or "FinancialRead.roic_ttm"
    verified: bool = False    # set by verify.py, never by the model


class MainCharacter(BaseModel):
    is_number_one: bool
    rationale: str
    rivals: list[str] = Field(default_factory=list)


class ThesisRecordV0(BaseModel):
    story_one_line: str
    q_story: str
    q_evidence: list[Claim]
    q_breaks_when: list[str]
    main_character: MainCharacter
    drivers: list[str]
    why_bought: str
    break_conditions: list[str]
    edge_statement: str
    horizon_years: int
    analogy_held: str | None = None
    ai_scenario: str | None = None
    confidence_label: Literal["low", "mid", "high"]
    role: Literal["core_growth", "barbell_insurance", "ai_upstream", "stable_income", "weed", "speculative", "trade", "idea_outside_RP"]
    asset_type: Literal["non_commodity", "commodity_cyclical", "miner_resource", "real_estate", "fund_etf", "bond_cash"]
    ai_layer: Literal["upstream", "midstream_receipts", "midstream_reseller", "downstream_tollbooth", "none"]
    conviction: Literal["low", "mid", "high"]
    weaknesses: list[str] = Field(default_factory=list)
    unverified_count: int = 0


class MoatLite(BaseModel):
    chokepoint_assets: list[str]
    replaceability: Literal["irreplaceable", "thin", "squeezed"]
    moat_kind: Literal["accumulating", "re_earned"]
    pricing_evidence: list[Claim] = Field(default_factory=list)
    data_position: Literal["own", "customer_owned", "wrapped_low_margin", "none"]
    verdict: str


class LensVerdict(BaseModel):
    verdict: Literal["pass", "fail", "split"]
    reason: str
    claims: list[Claim] = Field(default_factory=list)


class LensVerdicts(BaseModel):
    buffett: LensVerdict
    danoff: LensVerdict
    tillinghast: LensVerdict
    lynch: LensVerdict
    split_items: list[str] = Field(default_factory=list)


class Checkpoint(BaseModel):
    premise: str
    kpi: str
    source: str
    next_date: date | None = None
    bull_threshold: str = "TBD(Paul)"
    bear_threshold: str = "TBD(Paul)"
    suggested_bull: str | None = None
    suggested_bear: str | None = None
    status: Literal["open", "bull", "bear", "stale"] = "open"

    @field_validator("bull_threshold", "bear_threshold")
    @classmethod
    def _no_invented_numbers(cls, v: str) -> str:
        # INV-5: a numeric threshold may only come from philosophy.yaml (today: APP ≥ +46%); anything else stays TBD.
        import re

        if v != "TBD(Paul)" and re.search(r"\d", v) and "46" not in v:
            return "TBD(Paul)"
        return v


class MoatAndLenses(BaseModel):
    moat: MoatLite
    lenses: LensVerdicts


class CheckpointSet(BaseModel):
    checkpoints: list[Checkpoint]
    the_tension: str = ""


class ResearchBundle(BaseModel):
    thesis: ThesisRecordV0
    moat: MoatLite
    lenses: LensVerdicts
    checkpoints: list[Checkpoint]
    the_tension: str = ""          # the one thing that decides it (spec brief format: "the tension")


class PhaseExplanation(BaseModel):
    phase_idx: int
    explanation: str
    cited_events: list[str] = Field(default_factory=list)
    cited_sources: list[str] = Field(default_factory=list)
    driver_label_llm: Literal["earnings_led", "multiple_led", "event", "macro", "mixed"]
    shock_type: Literal["temporary", "structural", "na"] = "na"
    shock_kind: Literal["demand_death", "position_clearing", "na"] = "na"


class PhaseExplanations(BaseModel):
    phases: list[PhaseExplanation]


class ThesisClaimVerdict(BaseModel):
    """One claim from Paul's own thesis, tested against the documents (the evaluator front-end)."""
    claim: str
    status: Literal["supported", "contradicted", "mixed", "unverifiable"]
    evidence_for: list[Claim] = Field(default_factory=list)
    evidence_against: list[Claim] = Field(default_factory=list)
    note: str = ""


class ThesisVerdict(BaseModel):
    """Verdict on a thesis Paul wrote himself: claim by claim, what would break it, what the engine sees that the thesis
    does not mention, and the one question that decides it."""
    thesis_restated: str
    claims: list[ThesisClaimVerdict]
    overall: Literal["supported", "mixed", "contradicted", "unverifiable"]
    overall_reason: str
    breaks_when: list[str] = Field(default_factory=list)
    not_in_thesis: list[str] = Field(default_factory=list)     # material facts in the documents the thesis is silent on
    checkpoints: list[Checkpoint] = Field(default_factory=list)
    the_tension: str = ""
    unverified_count: int = 0


class StockPitch(BaseModel):
    """The case for one stock, written as a presenter would make it to Paul (plain words, no rule ids). Every figure in the
    prose must also appear in numbers_used with its source; verify.py checks them and counts what it cannot trace."""
    opening: str                      # the one idea, two sentences — why this name, why now
    the_business: str                 # what it does and why the world needs it; the indispensable #1 question
    why_now: str                      # what changed: demand, numbers, the last move, what management said
    valuation_in_cycle: str           # where the multiple sits in its own history and why it is there
    what_the_price_assumes: str       # the implied growth sentence, against delivered growth
    three_reasons: list[str] = Field(min_length=3, max_length=3)   # strongest, weakest, second-strongest (the sandwich)
    what_breaks_it: str               # the honest bear case and the sign that would end the thesis
    closing: str                      # the ask: what to do, how big, and the one thing to watch
    numbers_used: list[Claim] = Field(default_factory=list)
    unverified_count: int = 0


class SectorPitch(BaseModel):
    """The case for the sector call: where the cycle is, why the stance, the bet, the names that carry it."""
    where_we_are: str
    the_case: str
    the_bet: str
    names: str
    what_would_change_the_call: str
    numbers_used: list[Claim] = Field(default_factory=list)
    unverified_count: int = 0
