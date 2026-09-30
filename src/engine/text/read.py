"""Tier 2 — Claude reads the latest documents for a name and returns a structured TextRead (live-only factors, like
estimate revisions): demand, pricing power, competitive position (主役?), guidance direction, the AI three dials (F-45),
red flags, tone — every judgement backed by quoted evidence with its document. Cost-capped, cached by request hash."""
from __future__ import annotations

import json
from datetime import date
from typing import Literal

import pandas as pd
from pydantic import BaseModel, Field

from ..config import secret
from ..research.llm import BUDGET, parse_structured
from ..store import has_table, read_df, write_table

READ_MODEL = "claude-sonnet-5-5"     # extraction, not judgement: Sonnet is ~10× cheaper than Opus for this

SYSTEM = (
    "You read a company's latest earnings-call transcript and filing excerpts for Paul's investment engine and return a structured TextRead. "
    "Score each dimension from -2 (clearly negative) to +2 (clearly positive), 0 when the documents are silent or mixed. "
    "demand: order/backlog/RPO/capacity signals (sold out, capacity-constrained = +2; destocking, push-outs = -2). "
    "pricing_power: are price increases sticking (+) or is there price erosion (-)? competitive_position: evidence the company is the "
    "indispensable #1 (主役) in its market — share gains, sole supplier, switching costs; is_number_one true only if the documents say so. "
    "guidance: raised (+) / maintained (0) / cut (-). ai_receipts / ai_utilization / ai_pricing: the AI three dials — committed AI spend "
    "or backlog, utilization / lit capacity, AI pricing — 0 if not an AI-exposed business. red_flags: going concern, restatement, material "
    "weakness, covenant issues, customer loss, investigations. tone: management confidence vs hedging. "
    "Quote the exact sentence for every non-zero score and name the document. Never invent numbers; this is relay-weight evidence, not advice."
)


class Evidence(BaseModel):
    dimension: str
    quote: str
    document: str


class TextRead(BaseModel):
    demand: int = Field(ge=-2, le=2)
    pricing_power: int = Field(ge=-2, le=2)
    competitive_position: int = Field(ge=-2, le=2)
    is_number_one: bool = False
    guidance: int = Field(ge=-2, le=2)
    ai_receipts: int = Field(ge=-2, le=2)
    ai_utilization: int = Field(ge=-2, le=2)
    ai_pricing: int = Field(ge=-2, le=2)
    red_flags: list[str] = Field(default_factory=list)
    tone: int = Field(ge=-2, le=2)
    one_line: str
    evidence: list[Evidence] = Field(default_factory=list)
    confidence: Literal["low", "mid", "high"] = "mid"


def _docs_for(sid: str, sym: str) -> tuple[list[str], list[dict]]:
    blocks, refs = [], []
    if has_table("transcripts"):
        tr = read_df("transcripts", f"security_id = '{sid}'").sort_values("call_date", ascending=False).head(2)
        for r in tr.itertuples(index=False):
            blocks.append(f'<doc id="Earnings call Q{r.quarter} FY{r.fiscal_year} ({r.call_date})">\n{(r.content or "")[:60000]}\n</doc>')
            refs.append({"doc": f"transcript Q{r.quarter} FY{r.fiscal_year}", "date": str(r.call_date)})
    if has_table("filings_text"):
        fl = read_df("filings_text", f"security_id = '{sid}'").sort_values("filed", ascending=False)
        for r in fl.itertuples(index=False):
            if r.item in ("1", "7", "2", "4", "5"):
                blocks.append(f'<doc id="{r.form} filed {r.filed} Item {r.item}">\n{(r.text or "")[:40000]}\n</doc>')
                refs.append({"doc": f"{r.form} Item {r.item}", "date": str(r.filed)})
    return blocks, refs


def read_names(security_ids: list[tuple[str, str]], model: str = READ_MODEL, max_usd: float | None = None) -> int:
    """Run TextRead for (security_id, symbol) pairs; writes `text_reads`. Skips names already read on their latest documents."""
    if not secret("ANTHROPIC_API_KEY"):
        print("[text read] no ANTHROPIC_API_KEY — skipped")
        return 0
    if max_usd:
        BUDGET.max_usd = max_usd
    old = read_df("text_reads") if has_table("text_reads") else pd.DataFrame()
    rows = []
    n = 0
    for sid, sym in security_ids:
        blocks, refs = _docs_for(sid, sym)
        if not blocks:
            continue
        docs_key = json.dumps(refs, sort_keys=True)
        if not old.empty and ((old.security_id == sid) & (old.docs == docs_key)).any():
            continue
        msgs = [{"role": "user", "content": [{"type": "text", "text": "\n\n".join(blocks) + f"\n\nReturn the TextRead for {sym}."}]}]
        try:
            tr: TextRead = parse_structured(SYSTEM, msgs, TextRead, cache_key=f"textread:{sid}:{docs_key}", effort="medium", model=model, max_tokens=4000)
        except Exception as e:  # noqa: BLE001
            print(f"[text read] {sym}: {str(e)[:120]}", flush=True)
            continue
        latest = max(r["date"] for r in refs)
        rows.append({"security_id": sid, "symbol": sym, "read_date": date.today(), "available_from": pd.Timestamp(latest).date(), "docs": docs_key, "model": model,
                     "demand": tr.demand, "pricing_power": tr.pricing_power, "competitive_position": tr.competitive_position, "is_number_one": tr.is_number_one,
                     "guidance": tr.guidance, "ai_receipts": tr.ai_receipts, "ai_utilization": tr.ai_utilization, "ai_pricing": tr.ai_pricing,
                     "red_flags_n": len(tr.red_flags), "tone": tr.tone, "payload": tr.model_dump_json(), "source": "claude"})
        n += 1
        if n % 20 == 0:
            print(f"[text read] {n} names read, ${BUDGET.spent_usd:.2f} spent", flush=True)
            write_table("text_reads", pd.concat([old, pd.DataFrame(rows)], ignore_index=True).drop_duplicates(["security_id", "docs"], keep="last"))
    if rows:
        write_table("text_reads", pd.concat([old, pd.DataFrame(rows)], ignore_index=True).drop_duplicates(["security_id", "docs"], keep="last"))
    print(f"[text read] {n} names read; LLM spend ${BUDGET.spent_usd:.2f} over {BUDGET.calls} calls", flush=True)
    return n


def reads_for(as_of: pd.Timestamp, security_ids: list[str], max_age_days: int = 120) -> pd.DataFrame:
    """Latest TextRead per name usable at as_of (live-only: the read must post-date as_of − max_age and its documents must be visible)."""
    if not has_table("text_reads") or not security_ids:
        return pd.DataFrame()
    ids = ",".join("'" + s + "'" for s in security_ids)
    df = read_df("text_reads", f"security_id IN ({ids}) AND available_from <= DATE '{as_of.date()}' AND read_date >= DATE '{(as_of - pd.Timedelta(days=max_age_days)).date()}'")
    if df.empty:
        return df
    return df.sort_values("read_date").drop_duplicates("security_id", keep="last")
