"""Formation dates, point-in-time candidate caching, and cohort selection."""
from __future__ import annotations

import json
from dataclasses import dataclass

import pandas as pd

from ..config import DATA_DIR, Hypotheses
from ..screen.models import IdeaCandidate
from ..screen.run import build_candidates
from ..screen.scoring import score_universe, select_top

CACHE = DATA_DIR / "backtest_cache"


def formation_dates(start: str, end: str, cadence: str = "quarterly") -> list[pd.Timestamp]:
    freq = {"quarterly": "QE", "annual": "YE", "monthly": "ME"}[cadence]
    return [d for d in pd.date_range(pd.Timestamp(start) - pd.Timedelta(days=1), pd.Timestamp(end), freq=freq) if d >= pd.Timestamp(start)]


def candidates_at(as_of: pd.Timestamp, region: str, hyp: Hypotheses, universe_kind: str | None = None, use_cache: bool = True) -> list[IdeaCandidate]:
    """Unscored candidates (metrics only) at a formation date; cached so sensitivity variants cost seconds."""
    CACHE.mkdir(parents=True, exist_ok=True)
    kind = universe_kind or hyp.get("universe.kind")
    floor = hyp.get("universe.cap_floor_usd" if region == "US" else "universe.cap_floor_jpy")
    p = CACHE / f"{region}_{kind}_{int(floor)}_{as_of.date()}.json"
    if use_cache and p.exists():
        return [IdeaCandidate.model_validate(x) for x in json.loads(p.read_text())]
    from ..pit import universe as U

    orig = U.members
    if universe_kind:
        def members_kind(as_of_, region_, hyp_=None, kind=None):  # noqa: ANN001
            return orig(as_of_, region_, hyp_, kind=universe_kind)
        U.members = members_kind
    try:
        cands = build_candidates(as_of, region, hyp)
    finally:
        U.members = orig
    p.write_text(json.dumps([c.model_dump(mode="json") for c in cands], default=str))
    return cands


@dataclass
class Cohort:
    formation: pd.Timestamp
    region: str
    picks: list[IdeaCandidate]
    scored: list[IdeaCandidate]

    @property
    def n_eligible(self) -> int:
        return sum(1 for c in self.scored if c.eligible)


def form_cohort(as_of: pd.Timestamp, region: str, hyp: Hypotheses, top_n: int, preset: str | None, universe_kind: str | None, max_per_sector: int | None) -> Cohort:
    cands = candidates_at(as_of, region, hyp, universe_kind)
    for c in cands:                      # fresh scoring state per variant
        c.reasons, c.gates, c.alerts, c.penalties, c.angles, c.excluded_by = [], [], [], [], [], []
    if not cands:
        return Cohort(as_of, region, [], [])
    score_universe(cands, hyp, preset)
    picks = select_top(cands, top_n, max_per_sector)
    return Cohort(as_of, region, picks, cands)
