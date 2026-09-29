"""Configuration: philosophy.yaml (Paul's parameters, verbatim), hypotheses.yaml (labelled stand-ins for
TBD(Paul) values, spec INV-5), sources.yaml, holdings.yaml. Secrets come from the environment only.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
CONFIG_DIR = ROOT / "config"
DATA_DIR = Path(os.environ.get("ENGINE_DATA_DIR", ROOT / "data"))
REPORTS_DIR = Path(os.environ.get("ENGINE_REPORTS_DIR", ROOT / "reports"))

load_dotenv(ROOT / ".env", override=False)

SECRET_NAMES = [
    "FMP_API_KEY",
    "ALPACA_API_KEY",
    "ALPACA_SECRET_KEY",
    "JQUANTS_API_KEY",
    "EDINET_API_KEY",
    "FRED_API_KEY",
    "ANTHROPIC_API_KEY",
]


def secret(name: str) -> str | None:
    """Read a secret from the environment. Never log or persist the value."""
    v = os.environ.get(name)
    return v.strip() if v else None


def _load_yaml(path: Path) -> dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


@lru_cache(maxsize=None)
def philosophy() -> dict[str, Any]:
    return _load_yaml(CONFIG_DIR / "philosophy.yaml")


@lru_cache(maxsize=None)
def sources() -> dict[str, Any]:
    return _load_yaml(CONFIG_DIR / "sources.yaml")


@lru_cache(maxsize=None)
def holdings() -> dict[str, Any]:
    return _load_yaml(CONFIG_DIR / "holdings.yaml")


@lru_cache(maxsize=None)
def macro_episodes() -> list[dict[str, Any]]:
    return _load_yaml(CONFIG_DIR / "macro_episodes.yaml").get("episodes", [])


@lru_cache(maxsize=None)
def informed_investors() -> list[dict[str, Any]]:
    return _load_yaml(CONFIG_DIR / "informed_investors.yaml").get("investors", [])


def get_path(d: dict[str, Any], path: str, default: Any = None) -> Any:
    cur: Any = d
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return default
        cur = cur[part]
    return cur


# --------------------------------------------------------------------------------------
# TBD(Paul) detection (INV-5). Comments are lost by the YAML parser, so the raw file is scanned
# to pair each TBD value with the D-IDs its comment names.
# --------------------------------------------------------------------------------------
_KEY_RE = re.compile(r"^(\s*)([A-Za-z0-9_]+):\s*(.*)$")
_DID_RE = re.compile(r"\bD-\d{2}\b")


@dataclass
class TbdEntry:
    key: str
    value: str
    decision_ids: list[str] = field(default_factory=list)
    line: int = 0


def tbd_entries() -> list[TbdEntry]:
    """Every `TBD(...)` value in philosophy.yaml with its key path and the D-IDs in its comment."""
    out: list[TbdEntry] = []
    stack: list[tuple[int, str]] = []
    for ln, raw in enumerate((CONFIG_DIR / "philosophy.yaml").read_text(encoding="utf-8").splitlines(), 1):
        if not raw.strip() or raw.lstrip().startswith("#") or raw.lstrip().startswith("- "):
            continue
        m = _KEY_RE.match(raw)
        if not m:
            continue
        indent, key, rest = len(m.group(1)), m.group(2), m.group(3)
        while stack and stack[-1][0] >= indent:
            stack.pop()
        stack.append((indent, key))
        value, _, comment = rest.partition("#")
        value = value.strip()
        if value.startswith("TBD("):
            path = ".".join(k for _, k in stack)
            out.append(TbdEntry(key=path, value=value, decision_ids=sorted(set(_DID_RE.findall(comment))), line=ln))
    return out


# --------------------------------------------------------------------------------------
# Hypotheses: labelled stand-ins. Every read is recorded so outputs can list the D-IDs involved.
# --------------------------------------------------------------------------------------
class Hypotheses:
    def __init__(self, data: dict[str, Any]):
        self._data = data
        self.used: dict[str, dict[str, Any]] = {}

    @classmethod
    def load(cls) -> "Hypotheses":
        return cls(_load_yaml(CONFIG_DIR / "hypotheses.yaml"))

    def entry(self, path: str) -> dict[str, Any]:
        node = get_path(self._data, path)
        if node is None:
            raise KeyError(f"hypothesis not found: {path}")
        if isinstance(node, dict) and "value" in node:
            return node
        return {"value": node, "decision_id": None, "note": None}

    def get(self, path: str) -> Any:
        e = self.entry(path)
        self.used[path] = {"value": e.get("value"), "decision_id": e.get("decision_id"), "note": e.get("note")}
        return e["value"]

    def preset(self, name: str | None = None) -> dict[str, float]:
        name = name or self.get("screen.preset")
        presets = get_path(self._data, "screen.presets")
        if name not in presets:
            raise KeyError(f"unknown preset {name}; have {list(presets)}")
        self.used[f"screen.presets.{name}"] = {"value": presets[name], "decision_id": "D-27", "note": "angle weights"}
        return dict(presets[name])

    def decisions_touched(self) -> list[str]:
        ids = {u["decision_id"] for u in self.used.values() if u.get("decision_id") not in (None, "none")}
        return sorted(ids)

    def reset_usage(self) -> None:
        self.used = {}
