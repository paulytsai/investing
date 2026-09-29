"""Pull, filter, thread and store posts from configured X accounts (Timmer). Pure functions for the logic
(testable offline), a thin `pull_x()` for the network part."""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import yaml

from ..config import CONFIG_DIR
from ..store import RAW_DIR, append_table, has_table, read_df, write_table

MEDIA_DIR = RAW_DIR / "x" / "media"


def load_cfg() -> dict[str, Any]:
    return yaml.safe_load((CONFIG_DIR / "x_sources.yaml").read_text(encoding="utf-8"))


def api_fields(cfg: dict[str, Any]) -> dict[str, str]:
    return {"tweet.fields": ",".join(cfg["tweet_fields"]), "expansions": ",".join(cfg["expansions"]), "media.fields": ",".join(cfg["media_fields"])}


def lookback_start(cfg: dict[str, Any], today: date | None = None) -> str:
    today = today or datetime.now(timezone.utc).date()
    start = today - timedelta(days=int(cfg["lookback_days"]))
    return f"{start.isoformat()}T00:00:00Z"


# ---------------------------------------------------------------------------------------------
# pure logic
# ---------------------------------------------------------------------------------------------
@dataclass
class PageResult:
    posts: list[dict[str, Any]]
    media: dict[str, dict[str, Any]]
    next_token: str | None
    newest_id: str | None
    oldest_id: str | None


def parse_page(page: dict[str, Any]) -> PageResult:
    posts = page.get("data") or []
    media = {m["media_key"]: m for m in (page.get("includes") or {}).get("media", []) if m.get("media_key")}
    meta = page.get("meta") or {}
    return PageResult(posts=posts, media=media, next_token=meta.get("next_token"), newest_id=meta.get("newest_id"), oldest_id=meta.get("oldest_id"))


def keep_post(p: dict[str, Any], user_id: str) -> bool:
    """Keep originals and self-replies (his threads); drop replies to other people."""
    r = p.get("in_reply_to_user_id")
    return r is None or str(r) == str(user_id)


def normalize_posts(posts: list[dict[str, Any]], media: dict[str, dict[str, Any]], user_id: str, cal: pd.Series | None = None) -> list[dict[str, Any]]:
    rows = []
    for p in posts:
        if not keep_post(p, user_id):
            continue
        keys = (p.get("attachments") or {}).get("media_keys") or []
        urls = []
        for k in keys:
            m = media.get(k) or {}
            u = m.get("url") or m.get("preview_image_url")
            if u:
                urls.append({"media_key": k, "url": u, "type": m.get("type")})
        pm = p.get("public_metrics") or {}
        created = pd.Timestamp(p["created_at"]).tz_convert(None) if p.get("created_at") else None
        rows.append({
            "post_id": str(p["id"]), "user_id": str(user_id), "created_at": created,
            "available_from": _next_trading_day(created, cal), "conversation_id": str(p.get("conversation_id") or p["id"]),
            "in_reply_to_user_id": (str(p["in_reply_to_user_id"]) if p.get("in_reply_to_user_id") else None),
            "is_self_thread_reply": bool(p.get("in_reply_to_user_id")), "text": p.get("text", ""),
            "like_count": int(pm.get("like_count", 0)), "reply_count": int(pm.get("reply_count", 0)), "retweet_count": int(pm.get("retweet_count", 0)),
            "quote_count": int(pm.get("quote_count", 0)), "media_keys": json.dumps(keys), "media_urls": json.dumps(urls), "source": "x",
        })
    return rows


def _next_trading_day(ts, cal: pd.Series | None):
    if ts is None:
        return None
    d = pd.Timestamp(ts).normalize() + pd.Timedelta(days=1)
    if cal is None or cal.empty:
        return d
    c = pd.to_datetime(cal.values)
    i = c.searchsorted(d.to_datetime64(), side="left")
    return pd.Timestamp(c[min(i, len(c) - 1)])


def dedupe(new_rows: list[dict[str, Any]], existing_ids: set[str]) -> list[dict[str, Any]]:
    seen = set(existing_ids)
    out = []
    for r in new_rows:
        if r["post_id"] in seen:
            continue
        seen.add(r["post_id"])
        out.append(r)
    return out


def group_threads(posts: pd.DataFrame) -> pd.DataFrame:
    """One row per conversation_id, posts ordered by created_at, text joined with blank lines."""
    if posts.empty:
        return pd.DataFrame()
    posts = posts.copy()
    posts["created_at"] = pd.to_datetime(posts["created_at"])
    rows = []
    for cid, g in posts.sort_values("created_at").groupby("conversation_id"):
        urls = []
        for mu in g["media_urls"]:
            urls.extend(json.loads(mu) if isinstance(mu, str) else (mu or []))
        rows.append({
            "conversation_id": str(cid), "user_id": str(g["user_id"].iloc[0]), "first_post_id": str(g["post_id"].iloc[0]),
            "first_at": g["created_at"].iloc[0], "last_at": g["created_at"].iloc[-1], "available_from": g["available_from"].iloc[0],
            "n_posts": int(len(g)), "post_ids": json.dumps(g["post_id"].astype(str).tolist()), "full_text": "\n\n".join(g["text"].tolist()),
            "media_urls": json.dumps(urls), "n_media": len(urls), "like_count": int(g["like_count"].sum()),
            "market_relevant": None, "asset_classes": None, "sectors": None, "themes": None, "tickers": None, "summary": None,
            "chart_descriptions": None, "analysis_status": "pending", "source": "x",
        })
    return pd.DataFrame(rows)


def estimate_cost(n_posts: int, cfg: dict[str, Any]) -> float:
    return n_posts * float(cfg["cost_per_post_usd"])


# ---------------------------------------------------------------------------------------------
# network
# ---------------------------------------------------------------------------------------------
def resolve(handle: str) -> str:
    from ..connectors.x import X, save_user_id

    cfg = load_cfg()
    for a in cfg["accounts"]:
        if a["handle"].lower() == handle.lower() and a.get("user_id"):
            return str(a["user_id"])
    u = X().resolve_user(handle)
    if not u.get("id"):
        raise RuntimeError(f"could not resolve @{handle}: {u}")
    save_user_id(handle, u["id"])
    print(f"[x] @{handle} → user_id {u['id']} ({u.get('name')}) saved to config/x_sources.yaml")
    return str(u["id"])


def pull_x(handle: str = "TimmerFidelity", first_page_only: bool = False, confirm: bool = False, today: date | None = None) -> dict[str, Any]:
    from ..connectors.x import X

    cfg = load_cfg()
    acct = next(a for a in cfg["accounts"] if a["handle"].lower() == handle.lower())
    user_id = str(acct.get("user_id") or resolve(handle))
    x = X()
    cal = read_df("trading_calendar", "region = 'US'")["date"] if has_table("trading_calendar") else None
    existing = read_df("x_posts") if has_table("x_posts") else pd.DataFrame()
    existing_ids = set(existing["post_id"].astype(str)) if not existing.empty else set()
    since_id = None
    if not existing.empty:
        mine = existing[existing.user_id.astype(str) == user_id]
        if not mine.empty:
            since_id = str(max(mine["post_id"].astype(int)))
    start_time = None if since_id else lookback_start(cfg, today)
    cap = int(cfg["max_posts_per_run"])
    fields = api_fields(cfg)
    fetched: list[dict[str, Any]] = []
    media: dict[str, dict[str, Any]] = {}
    token = None
    pages = 0
    while True:
        page = x.user_tweets(user_id, fields=fields, page_size=int(cfg["page_size"]), start_time=start_time, since_id=since_id, next_token=token)
        pr = parse_page(page)
        pages += 1
        fetched.extend(pr.posts)
        media.update(pr.media)
        token = pr.next_token
        if first_page_only and not confirm:
            break
        if not token or len(fetched) >= cap:
            break
    fetched = fetched[:cap]
    est_run = estimate_cost(len(fetched), cfg)
    rows = dedupe(normalize_posts(fetched, media, user_id, cal), existing_ids)
    report = {"handle": handle, "user_id": user_id, "mode": "since_id" if since_id else "backfill", "pages": pages, "posts_returned": len(fetched),
              "posts_kept": len(rows), "next_token": token, "estimated_cost_usd": round(est_run, 2), "cap": cap}
    if first_page_only and not confirm:
        # extrapolate: 6-month window → if a full page came back, assume ~page_size posts per page until start_time
        per_page = len(fetched)
        report["note"] = ("first page only; " + ("more pages remain — " if token else "no more pages — ")
                          + f"a full backfill costs about ${estimate_cost(per_page, cfg):.2f} per page of {per_page}")
        _log_run(report)
        return report
    if rows:
        df = pd.DataFrame(rows)
        append_table("x_posts", df)
        allp = read_df("x_posts")
        allp = allp[allp.user_id.astype(str) == user_id]
        write_table("x_threads", group_threads(allp))
        n_img = download_all_media(x, rows)
        report["media_downloaded"] = n_img
    _log_run(report)
    return report


def download_all_media(x, rows: list[dict[str, Any]]) -> int:
    n = 0
    for r in rows:
        for mu in json.loads(r["media_urls"]):
            url = mu["url"]
            ext = url.rsplit(".", 1)[-1].split("?")[0][:4] if "." in url[-6:] else "jpg"
            if x.download_media(url, MEDIA_DIR / f"{mu['media_key']}.{ext}"):
                n += 1
    return n


def _log_run(report: dict[str, Any]) -> None:
    p = RAW_DIR / "x" / "runs.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "a", encoding="utf-8") as f:
        f.write(json.dumps({**report, "at": datetime.now(timezone.utc).isoformat()}, default=str) + "\n")
    print(f"[x] {report['mode']} @{report['handle']}: {report['posts_returned']} posts returned ({report['posts_kept']} new kept) in {report['pages']} page(s); "
          f"estimated cost ${report['estimated_cost_usd']:.2f}" + (f"; {report['note']}" if report.get("note") else ""))


def summary(handle: str = "TimmerFidelity") -> dict[str, Any]:
    posts = read_df("x_posts") if has_table("x_posts") else pd.DataFrame()
    threads = read_df("x_threads") if has_table("x_threads") else pd.DataFrame()
    out: dict[str, Any] = {"posts": int(len(posts)), "threads": int(len(threads))}
    if not threads.empty and threads["market_relevant"].notna().any():
        t = threads[threads["market_relevant"].notna()]
        out["market_relevant_share"] = float(t["market_relevant"].astype(bool).mean())
        themes: dict[str, int] = {}
        for th in t["themes"].dropna():
            for k in (json.loads(th) if isinstance(th, str) else th):
                themes[k] = themes.get(k, 0) + 1
        out["top_themes"] = sorted(themes.items(), key=lambda kv: -kv[1])[:10]
        out["samples"] = t[t["market_relevant"].astype(bool)].sort_values("like_count", ascending=False).head(5)[["first_at", "summary", "themes", "tickers", "n_media"]].to_dict("records")
    else:
        out["analysis_status"] = "pending (no ANTHROPIC_API_KEY or `engine x classify` not run)"
    return out


def media_path(media_key: str) -> Path | None:
    for p in MEDIA_DIR.glob(f"{media_key}.*"):
        return p
    return None
