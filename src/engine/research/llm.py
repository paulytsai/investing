"""Anthropic client wrapper: `messages.parse` with pydantic output, request-hash cache under data/llm_cache/,
per-run cost ledger and caps, refusal handling. Model: claude-opus-5-5 (adaptive thinking; effort high)."""
from __future__ import annotations

import hashlib
import json
import time
from typing import Any, TypeVar

from pydantic import BaseModel

from ..config import DATA_DIR, secret

MODEL = "claude-opus-5-5"
CACHE_DIR = DATA_DIR / "llm_cache"
PRICE_IN, PRICE_OUT, PRICE_CACHE_READ = 4.0, 20.0, 0.20   # $ per MTok (Opus 5.5)
T = TypeVar("T", bound=BaseModel)


class LLMBudget:
    def __init__(self, max_usd: float = 25.0):
        self.max_usd = max_usd
        self.spent_usd = 0.0
        self.calls = 0

    def add(self, usage: Any) -> None:
        inp = getattr(usage, "input_tokens", 0) or 0
        out = getattr(usage, "output_tokens", 0) or 0
        cr = getattr(usage, "cache_read_input_tokens", 0) or 0
        self.spent_usd += (inp * PRICE_IN + out * PRICE_OUT + cr * PRICE_CACHE_READ) / 1e6
        self.calls += 1

    def exhausted(self) -> bool:
        return self.spent_usd >= self.max_usd


BUDGET = LLMBudget()


class NarrativeUnavailable(RuntimeError):
    pass


def _client():
    import anthropic

    if not secret("ANTHROPIC_API_KEY"):
        raise NarrativeUnavailable("ANTHROPIC_API_KEY not set")
    return anthropic.Anthropic()


def _hash(system: str, messages: list[dict], schema: dict, effort: str) -> str:
    def strip_images(o):
        if isinstance(o, dict):
            if o.get("type") == "image":
                return {"type": "image", "sha": hashlib.sha1(o["source"]["data"].encode()).hexdigest()[:16]}
            return {k: strip_images(v) for k, v in o.items()}
        if isinstance(o, list):
            return [strip_images(v) for v in o]
        return o
    payload = json.dumps({"m": MODEL, "s": system, "msgs": strip_images(messages), "schema": schema, "e": effort}, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode()).hexdigest()[:24]


def parse_structured(system: str, messages: list[dict], schema: type[T], *, effort: str = "high", cache_key: str | None = None,
                     max_tokens: int = 16000, use_cache: bool = True) -> T:
    """Call Claude with a pydantic output schema. Cached by request hash (tests use the frozen fixture cache only)."""
    js = schema.model_json_schema()
    key = _hash(system, messages, js, effort)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / f"{key}.json"
    if use_cache and path.exists():
        data = json.loads(path.read_text(encoding="utf-8"))
        return schema.model_validate(data["parsed"])
    if BUDGET.exhausted():
        raise NarrativeUnavailable(f"LLM budget exhausted (${BUDGET.spent_usd:.2f} ≥ ${BUDGET.max_usd:.2f})")
    client = _client()
    sys_blocks = [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}]
    last_err: Exception | None = None
    for attempt in range(2):
        resp = client.messages.parse(model=MODEL, max_tokens=max_tokens, system=sys_blocks, messages=messages,
                                     output_config={"effort": effort}, output_format=schema)
        BUDGET.add(resp.usage)
        if resp.stop_reason == "refusal":
            cat = getattr(getattr(resp, "stop_details", None), "category", None)
            raise NarrativeUnavailable(f"refused ({cat})")
        parsed = getattr(resp, "parsed_output", None)
        if parsed is not None:
            path.write_text(json.dumps({"parsed": parsed.model_dump(mode="json"), "cache_key": cache_key, "model": MODEL,
                                        "usage": {"in": resp.usage.input_tokens, "out": resp.usage.output_tokens}, "ts": time.time()}, default=str), encoding="utf-8")
            return parsed
        last_err = RuntimeError(f"no parsed output (stop_reason={resp.stop_reason})")
        messages = messages + [{"role": "user", "content": f"The previous answer did not validate: {last_err}. Return only the object."}]
    raise NarrativeUnavailable(str(last_err))
