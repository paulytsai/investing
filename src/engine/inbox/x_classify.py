"""Tag X threads with the Claude layer (market relevant / personal, asset classes, sectors, themes, tickers, one-line
summary, chart descriptions from the images). Without an ANTHROPIC_API_KEY the threads stay `pending` and the images
are flagged for later analysis."""
from __future__ import annotations

import base64
import json

import pandas as pd

from ..config import secret
from ..pit.pull_x import media_path
from ..store import read_df, write_table
from .schemas import XThreadTags

SYSTEM = (
    "You tag posts by Jurrien Timmer (Fidelity, Director of Global Macro) for an investment engine. "
    "Decide whether the thread is market relevant (markets, macro, rates, inflation, earnings, valuation, breadth, sectors, "
    "commodities, FX, crypto, positioning) or personal (cycling, cooking, travel, family). For market-relevant threads list asset classes "
    "(equities, bonds, gold, bitcoin, commodities, cash, FX), sectors, themes (e.g. 'rates: 10Y > 4.5%', 'real rates', 'breadth', "
    "'earnings revisions', 'valuation P/E', 'liquidity/Fed', 'inflation', 'dollar', 'AI capex', 'small caps', 'international'), tickers, and a "
    "one-line summary. Describe each chart image: what it shows, the series plotted, the takeaway. Quote numbers only as they appear in the "
    "text or on the chart; do not invent values. This is relay-weight context for Paul; never phrase as an instruction to trade."
)


def _image_block(path) -> dict | None:
    if path is None:
        return None
    ext = path.suffix.lower().lstrip(".")
    mt = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "gif": "image/gif"}.get(ext)
    if not mt:
        return None
    data = base64.b64encode(path.read_bytes()).decode()
    if len(data) > 4_000_000:
        return None
    return {"type": "image", "source": {"type": "base64", "media_type": mt, "data": data}}


def classify_threads(limit: int = 200) -> int:
    if not secret("ANTHROPIC_API_KEY"):
        print("[x classify] no ANTHROPIC_API_KEY — threads stay pending; images flagged for later analysis")
        return 0
    from ..research.llm import parse_structured

    th = read_df("x_threads")
    todo = th[th["analysis_status"] != "done"].sort_values("first_at", ascending=False).head(limit)
    n = 0
    for i, r in todo.iterrows():
        media = json.loads(r["media_urls"]) if isinstance(r["media_urls"], str) else []
        content: list[dict] = [{"type": "text", "text": f"<thread date='{pd.Timestamp(r['first_at']).date()}' posts='{r['n_posts']}'>\n{r['full_text']}\n</thread>"}]
        keys = []
        for m in media[:6]:
            blk = _image_block(media_path(m["media_key"]))
            if blk:
                content.append({"type": "text", "text": f"[image media_key={m['media_key']}]"})
                content.append(blk)
                keys.append(m["media_key"])
        content.append({"type": "text", "text": "Return the XThreadTags object. Use the media_key labels for chart descriptions."})
        try:
            tags: XThreadTags = parse_structured(SYSTEM, [{"role": "user", "content": content}], XThreadTags, cache_key=f"x:{r['conversation_id']}")
        except Exception as e:  # noqa: BLE001
            print(f"[x classify] {r['conversation_id']}: {str(e)[:120]}")
            th.loc[i, "analysis_status"] = "error"
            continue
        th.loc[i, "market_relevant"] = bool(tags.market_relevant)
        th.loc[i, "asset_classes"] = json.dumps(tags.asset_classes)
        th.loc[i, "sectors"] = json.dumps(tags.sectors)
        th.loc[i, "themes"] = json.dumps(tags.themes)
        th.loc[i, "tickers"] = json.dumps(tags.tickers)
        th.loc[i, "summary"] = tags.summary
        th.loc[i, "chart_descriptions"] = json.dumps([c.model_dump() for c in tags.charts])
        th.loc[i, "analysis_status"] = "done"
        n += 1
    write_table("x_threads", th)
    print(f"[x classify] tagged {n} threads")
    return n
