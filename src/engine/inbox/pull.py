"""`engine inbox pull`: the Gmail connector lives in the Claude session, not in this process. This command only
reports what is in data/inbox and how to add to it (drop files, or ask Claude to save the labelled emails here)."""
from __future__ import annotations

from .parse import INBOX


def pull_inbox(label: str = "WAAR", since: str | None = None) -> None:
    INBOX.mkdir(parents=True, exist_ok=True)
    files = [p for d in INBOX.glob("*") if d.is_dir() for p in d.iterdir()]
    print(f"[inbox] {len(files)} files under {INBOX}")
    print(f"[inbox] to add Timmer WAAR posts: forward them to yourself with the Gmail label '{label}', then in a Claude session say "
          f"\"save my '{label}' emails{f' since {since}' if since else ''} into data/inbox/timmer/\"; or drop txt/pdf/png files there. Then run `engine inbox parse`.")
