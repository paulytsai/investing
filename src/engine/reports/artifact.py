"""Prepare a report run for publishing as a multi-file Artifact: the entry page is stripped to head+body content (the
publisher wraps it in its own skeleton), sub-pages keep their doctype, and the vendored Plotly asset travels along."""
from __future__ import annotations

import re
import shutil
from pathlib import Path

from ..config import REPORTS_DIR

OUT = REPORTS_DIR / "_artifact"
PLOTLY_CDN = "https://cdnjs.cloudflare.com/ajax/libs/plotly.js/2.35.3/plotly.min.js"


def _strip_skeleton(html: str, title: str | None = None) -> str:
    head = re.search(r"<head>(.*?)</head>", html, re.S)
    body = re.search(r"<body[^>]*>(.*?)</body>", html, re.S)
    h = head.group(1) if head else ""
    h = re.sub(r"<meta[^>]*>", "", h)
    if title:
        h = re.sub(r"<title>.*?</title>", f"<title>{title}</title>", h, count=1, flags=re.S)
    return (h.strip() + "\n" + (body.group(1) if body else html)).strip()


def prepare(run_dir: Path, entry: str, title: str, sub_dirs: tuple[str, ...] = ("ideas", "cohorts"), max_sub_pages: int = 60,
            asset_rel_entry: str = "../../assets/", asset_rel_sub: str = "../../../assets/") -> Path:
    run_dir = Path(run_dir)
    out = OUT / run_dir.name
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    # the vendored plotly.min.js carries control bytes the publisher rejects as text: pages load it from cdnjs instead
    html = (run_dir / entry).read_text(encoding="utf-8").replace(f'src="{asset_rel_entry}plotly.min.js"', f'src="{PLOTLY_CDN}"')
    (out / "index.html").write_text(_strip_skeleton(html, title), encoding="utf-8")
    n = 0
    for sd in sub_dirs:
        src = run_dir / sd
        if not src.exists():
            continue
        (out / sd).mkdir(exist_ok=True)
        pages = sorted(src.glob("*.html"), key=lambda p: p.stat().st_size)  # smaller first; the cap keeps the publish under the limit
        for p in pages[:max_sub_pages]:
            t = p.read_text(encoding="utf-8").replace(f'src="{asset_rel_sub}plotly.min.js"', f'src="{PLOTLY_CDN}"').replace("../board.html", "../index.html")
            (out / sd / p.name).write_text(t, encoding="utf-8")
            n += 1
    print(f"[artifact] {out}: index.html + {n} sub-pages")
    _ = shutil
    return out
