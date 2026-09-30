"""Jinja rendering of runs (board, idea pages, run index)."""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import pandas as pd
from jinja2 import Environment, FileSystemLoader, select_autoescape

from ..config import REPORTS_DIR
from ..store import read_df

TEMPLATES = Path(__file__).parent / "templates"
_env = Environment(loader=FileSystemLoader(str(TEMPLATES)), autoescape=select_autoescape(["html", "j2"]))


def _pct(v, digits: int = 0, sign: bool = True):
    if v is None or (isinstance(v, float) and v != v):
        return "–"
    return f"{float(v)*100:{'+' if sign else ''}.{digits}f}%"


def _num(v, digits: int = 2):
    if v is None or (isinstance(v, float) and v != v):
        return "–"
    return f"{float(v):,.{digits}f}"


_env.filters["pct"] = _pct
_env.filters["num"] = _num
from . import plain as _plain  # noqa: E402

_env.filters["plain_reason"] = _plain.plain_reason
_env.filters["plain_penalty"] = _plain.plain_penalty
_env.filters["plain_gate"] = _plain.plain_gate
_env.filters["plain_sector_line"] = _plain.plain_sector_line
_env.globals["plain_action"] = _plain.plain_action
_env.globals["plain_summary"] = _plain.plain_summary
_env.globals["summary_parts"] = _plain.summary_parts
_env.globals["why_cheap"] = _plain.why_cheap
_env.globals["STANCE_WORDS"] = _plain.STANCE
_env.globals["ASSET_WORDS"] = _plain.ASSET
_env.globals["LAYER_WORDS"] = _plain.LAYER
_env.globals["GLOSSARY"] = _plain.GLOSSARY


def env() -> Environment:
    return _env


def fmt_value(v, unit: str) -> str:
    if v is None:
        return "–"
    try:
        v = float(v)
    except (TypeError, ValueError):
        return str(v)
    if unit in ("%", "% of cap", "pp"):
        return f"{v:+.1f}{'%' if unit != 'pp' else ' pp'}"
    if unit == "x":
        return f"{v:.2f}x"
    if unit == "pctile":
        return f"{v:.0f}th"
    if unit == "flag":
        return "yes" if v >= 1 else "no"
    if unit == "qtrs":
        return f"{v:.0f}"
    if unit == "USD":
        return f"${v:,.0f}"
    return f"{v:.2f}"


def fmt_cap(v, currency: str = "USD") -> str:
    if v is None:
        return "–"
    v = float(v)
    sym = {"USD": "$", "JPY": "¥"}.get(currency or "USD", (currency or "") + " ")
    if v >= 1e12:
        return f"{sym}{v/1e12:.2f}T"
    if v >= 1e9:
        return f"{sym}{v/1e9:.1f}B"
    return f"{sym}{v/1e6:.0f}M"


def macro_strip(as_of) -> dict[str, str]:
    """10Y UST, real 10Y, breakeven, 3-mo T-bill, CPI YoY, USDJPY at `as_of` (point-in-time; user-flagged benchmarks)."""
    out: dict[str, str] = {}
    df = read_df("macro_daily")
    if df.empty:
        return out
    df["date"] = pd.to_datetime(df["date"])
    df = df[df["date"] <= pd.Timestamp(as_of)]

    def last(sid):
        s = df[df.series_id == sid].sort_values("date")
        return None if s.empty else float(s["value"].iloc[-1])

    def yoy(sid):
        s = df[df.series_id == sid].sort_values("date")
        if len(s) < 13:
            return None
        return (float(s["value"].iloc[-1]) / float(s["value"].iloc[-13]) - 1) * 100

    v = last("DGS10")
    if v is not None:
        flag = " ⚠ >4.5%" if v > 4.5 else ""
        out["10Y UST"] = f"{v:.2f}%{flag}"
    v = last("DFII10")
    if v is not None:
        out["10Y real"] = f"{v:.2f}%"
    v = last("T10YIE")
    if v is not None:
        out["10Y breakeven"] = f"{v:.2f}%"
    v = last("DTB3")
    if v is not None:
        out["3M T-bill (hurdle)"] = f"{v:.2f}%"
    v = yoy("CPIAUCSL")
    if v is not None:
        out["CPI YoY"] = f"{v:.1f}%"
    v = yoy("CPILFESL")
    if v is not None:
        out["Core CPI YoY"] = f"{v:.1f}%"
    v = last("DEXJPUS")
    if v is not None:
        out["USDJPY"] = f"{v:.0f}"
    v = last("DCOILWTICO")
    if v is not None:
        out["WTI"] = f"${v:.0f}"
    return out


def write(path: Path, html: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(html, encoding="utf-8")
    return path


def now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M")


PLOTLY_URL = "https://cdn.jsdelivr.net/npm/plotly.js-dist-min@2.35.3/plotly.min.js"


def ensure_assets() -> None:
    """Vendor Plotly.js once under reports/assets so pages render offline (CDN is the fallback in the page)."""
    p = REPORTS_DIR / "assets" / "plotly.min.js"
    if p.exists() and p.stat().st_size > 1_000_000:
        return
    try:
        import httpx

        r = httpx.get(PLOTLY_URL, timeout=90, follow_redirects=True)
        if r.status_code == 200 and len(r.content) > 1_000_000:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(r.content)
    except Exception:  # noqa: BLE001 — the page falls back to the CDN
        pass


def update_index() -> Path:
    """reports/index.html listing every run folder."""
    ensure_assets()
    runs = []
    for kind_dir in sorted(REPORTS_DIR.glob("*")):
        if not kind_dir.is_dir():
            continue
        for run in sorted(kind_dir.glob("*"), reverse=True):
            meta = run / "run.json"
            if meta.exists():
                m = json.loads(meta.read_text())
                runs.append({"kind": kind_dir.name, "run": run.name, "as_of": m.get("as_of"), "title": m.get("title"), "href": f"{kind_dir.name}/{run.name}/{m.get('entry','index.html')}"})
    html = env().get_template("index.html.j2").render(runs=runs, generated=now(), title="Engine runs")
    return write(REPORTS_DIR / "index.html", html)
