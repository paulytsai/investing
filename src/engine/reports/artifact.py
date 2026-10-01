"""Prepare a report run for publishing as a multi-file Artifact: the entry page is stripped to head+body content (the
publisher wraps it in its own skeleton), sub-pages keep their doctype, and the vendored Plotly asset travels along."""
from __future__ import annotations

import json
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


def inline_x_images(html: str, max_width: int = 800, quality: int = 70) -> str:
    """The viewer blocks images from other hosts: Timmer's chart images (pbs.twimg.com) become data URIs from the local
    media cache (downscaled), matched through the media_key ↔ url map in x_posts."""
    import base64
    import io
    import json

    from ..pit.pull_x import media_path
    from ..store import has_table, read_df

    if "pbs.twimg.com" not in html or not has_table("x_posts"):
        return html
    url_to_key: dict[str, str] = {}
    for mu in read_df("x_posts")["media_urls"]:
        for m in (json.loads(mu) if isinstance(mu, str) else []):
            url_to_key[m["url"]] = m["media_key"]
    try:
        from PIL import Image
    except ImportError:
        Image = None

    def repl(m):
        url = m.group(1)
        path = media_path(url_to_key.get(url, "")) if url in url_to_key else None
        if not path or not path.exists():
            return m.group(0)
        data = path.read_bytes()
        mime = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
        if Image is not None:
            try:
                im = Image.open(io.BytesIO(data)).convert("RGB")
                if im.width > max_width:
                    im = im.resize((max_width, int(im.height * max_width / im.width)))
                buf = io.BytesIO()
                im.save(buf, format="JPEG", quality=quality, optimize=True)
                data, mime = buf.getvalue(), "image/jpeg"
            except Exception:  # noqa: BLE001
                pass
        return m.group(0).replace(url, f"data:{mime};base64,{base64.b64encode(data).decode()}")

    return re.sub(r'<img src="(https://pbs\.twimg\.com/[^"]+)"', repl, html)


def prepare(run_dir: Path, entry: str, title: str, sub_dirs: tuple[str, ...] = ("ideas", "cohorts"), max_sub_pages: int = 60,
            asset_rel_entry: str = "../../assets/", asset_rel_sub: str = "../../../assets/") -> Path:
    run_dir = Path(run_dir)
    out = OUT / run_dir.name
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    # the vendored plotly.min.js carries control bytes the publisher rejects as text: pages load it from cdnjs instead
    html = (run_dir / entry).read_text(encoding="utf-8").replace(f'src="{asset_rel_entry}plotly.min.js"', f'src="{PLOTLY_CDN}"')
    (out / "index.html").write_text(inline_x_images(_strip_skeleton(html, title)), encoding="utf-8")
    n = 0
    for sd in sub_dirs:
        src = run_dir / sd
        if not src.exists():
            continue
        (out / sd).mkdir(exist_ok=True)
        # the book's names first (sizing.json weights), then the rest smallest first; the cap keeps the publish under the limit
        chosen: set[str] = set()
        sz = run_dir / "sizing.json"
        if sz.exists():
            try:
                cands = json.loads((run_dir / "candidates.json").read_text()) if (run_dir / "candidates.json").exists() else []
                sid_sym = {c["security_id"]: c["symbol"] for c in cands}
                chosen = {sid_sym.get(k, "") for k in (json.loads(sz.read_text()).get("weights") or {})}
            except Exception:  # noqa: BLE001
                chosen = set()
        pages = sorted(src.glob("*.html"), key=lambda p: (0 if p.stem in chosen else 1, p.stat().st_size))
        for p in pages[:max_sub_pages]:
            t = p.read_text(encoding="utf-8").replace(f'src="{asset_rel_sub}plotly.min.js"', f'src="{PLOTLY_CDN}"').replace("../board.html", "../index.html")
            (out / sd / p.name).write_text(t, encoding="utf-8")
            n += 1
    print(f"[artifact] {out}: index.html + {n} sub-pages")
    _ = shutil
    return out
