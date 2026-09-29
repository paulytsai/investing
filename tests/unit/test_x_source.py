"""X source logic, offline: pagination parsing, self-reply filter, thread grouping, dedupe, cap, cost, lookback."""
import json
from datetime import date
from pathlib import Path

import pandas as pd

from engine.pit import pull_x as px

FIX = Path(__file__).resolve().parents[1] / "fixtures" / "x"
USER = "999"
CFG = {"lookback_days": 183, "max_posts_per_run": 1500, "cost_per_post_usd": 0.005, "page_size": 100,
       "tweet_fields": ["created_at", "conversation_id", "in_reply_to_user_id", "public_metrics", "attachments"],
       "expansions": ["attachments.media_keys"], "media_fields": ["url", "type", "preview_image_url", "media_key"]}


def _page(n):
    return json.loads((FIX / f"page{n}.json").read_text())


def test_lookback_from_today():
    assert px.lookback_start(CFG, today=date(2026, 9, 29)) == "2026-03-30T00:00:00Z"


def test_parse_page_and_fields():
    pr = px.parse_page(_page(1))
    assert pr.next_token == "tok2" and pr.newest_id == "1001" and len(pr.posts) == 5 and "3_1" in pr.media
    f = px.api_fields(CFG)
    assert f["tweet.fields"].startswith("created_at,conversation_id") and f["expansions"] == "attachments.media_keys"


def test_self_replies_kept_other_replies_dropped():
    pr = px.parse_page(_page(1))
    rows = px.normalize_posts(pr.posts, pr.media, USER)
    ids = {r["post_id"] for r in rows}
    assert {"1001", "1002", "1003", "1005"} == ids        # 1004 is a reply to user 123 → dropped
    r1002 = next(r for r in rows if r["post_id"] == "1002")
    assert r1002["is_self_thread_reply"] is True and json.loads(r1002["media_urls"])[0]["url"].endswith("chart2.jpg")


def test_threads_grouped_in_order():
    pr = px.parse_page(_page(1))
    df = pd.DataFrame(px.normalize_posts(pr.posts, pr.media, USER))
    th = px.group_threads(df).set_index("conversation_id")
    assert th.loc["1001", "n_posts"] == 3
    assert json.loads(th.loc["1001", "post_ids"]) == ["1001", "1002", "1003"]
    assert th.loc["1001", "full_text"].startswith("The 10-yr") and th.loc["1001", "full_text"].endswith("3/3")
    assert th.loc["1001", "n_media"] == 2 and th.loc["1005", "n_posts"] == 1
    assert th.loc["1001", "analysis_status"] == "pending"


def test_dedupe_across_pages():
    p1, p2 = px.parse_page(_page(1)), px.parse_page(_page(2))
    rows1 = px.normalize_posts(p1.posts, p1.media, USER)
    stored = {r["post_id"] for r in rows1}
    rows2 = px.dedupe(px.normalize_posts(p2.posts, p2.media, USER), stored)
    assert [r["post_id"] for r in rows2] == ["0900"]


def test_cap_and_cost():
    posts = [dict(id=str(i), created_at="2026-09-01T00:00:00.000Z", conversation_id=str(i), text="x", public_metrics={}) for i in range(2000)]
    capped = posts[: CFG["max_posts_per_run"]]
    assert len(capped) == 1500
    assert abs(px.estimate_cost(len(capped), CFG) - 7.5) < 1e-9


def test_since_id_is_newest_stored(tmp_path, monkeypatch):
    from engine import store

    monkeypatch.setattr(store, "PIT_DIR", tmp_path)
    pr = px.parse_page(_page(1))
    store.write_table("x_posts", pd.DataFrame(px.normalize_posts(pr.posts, pr.media, USER)))
    existing = store.read_df("x_posts")
    assert str(max(existing["post_id"].astype(int))) == "1005"   # numerically newest id → since_id
