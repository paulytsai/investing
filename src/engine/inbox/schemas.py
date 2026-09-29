from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field


class Claim(BaseModel):
    text: str
    period: str = ""
    source: str = ""
    verified: bool = False


class ChartDescription(BaseModel):
    media_key: str
    what_it_shows: str
    series: list[str] = Field(default_factory=list)
    takeaway: str


class MacroNote(BaseModel):
    source: str                       # x | inbox_file | federal_register
    author: str
    published_date: date | None = None
    ingested_from: str
    title: str
    market_relevant: bool
    stance_summary: str
    claims: list[Claim] = Field(default_factory=list)
    indicators_mentioned: list[str] = Field(default_factory=list)   # §6.2 I-IDs or FRED series where possible
    asset_classes: list[str] = Field(default_factory=list)
    sectors: list[str] = Field(default_factory=list)
    themes: list[str] = Field(default_factory=list)
    tickers: list[str] = Field(default_factory=list)
    regime_read: str = ""
    charts: list[ChartDescription] = Field(default_factory=list)
    confidence: Literal["relay"] = "relay"


class XThreadTags(BaseModel):
    market_relevant: bool
    asset_classes: list[str] = Field(default_factory=list)
    sectors: list[str] = Field(default_factory=list)
    themes: list[str] = Field(default_factory=list)
    tickers: list[str] = Field(default_factory=list)
    summary: str
    indicators_mentioned: list[str] = Field(default_factory=list)
    charts: list[ChartDescription] = Field(default_factory=list)
