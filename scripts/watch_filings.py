"""Watch for new large-shareholding filings (大量保有報告書 / 変更報告書) by chosen investors.

Every check reads the day's full filing list (one request) and alerts on filings by any
EDINET filer code in config/watchlist.json that it has not seen before. An initial report
(大量保有報告書) means the investor just crossed 5%: a new position.

    python scripts/watch_filings.py --seed            # first run: mark existing filings as seen, no alerts
    python scripts/watch_filings.py                   # check today (and yesterday), alert on anything new
    python scripts/watch_filings.py --loop 600        # keep running, checking every 10 minutes
    python scripts/watch_filings.py --days 30 --dry-run   # show what would alert over the last 30 days

Alerts go to stdout plus any channel configured in the environment (or .env):
    NTFY_TOPIC            push to phone via https://ntfy.sh/<topic> (use a long random topic name)
    SLACK_WEBHOOK_URL     Slack incoming webhook
    SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, ALERT_EMAIL_TO   email
Source: ufocatch.com's daily index of EDINET large-shareholding filings.
"""

from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import os
import re
import smtplib
import sys
import time
import urllib.request
from email.message import EmailMessage
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from investing.config import settings  # noqa: E402  (loads .env)

JST = ZoneInfo("Asia/Tokyo")
BASE = "https://ufocatch.com"
UA = "Mozilla/5.0 (investing filing watcher)"
WATCHLIST = ROOT / "config" / "watchlist.json"
STATE = Path(os.environ.get("WATCH_STATE_FILE", ROOT / "state" / "seen_filings.json"))

ROW_RE = re.compile(
    r'<td class="fs-08 nosm">(?P<date>\d\d/\d\d)</td>\s*<td class="fs-08">(?P<time>\d\d:\d\d)</td>'
    r'.*?href="/large-shareholding/holder/(?P<filer>E\d+)" title="(?P<filer_name>[^"]*)"'
    r'.*?href="/large-shareholding/holding/E\d+/(?P<code>[0-9A-Z]{4})" title="\[[0-9A-Z]{4}\] (?P<issuer>[^"]*)"'
    r'.*?<span class="[^"]*">(?P<pct>[^<]*)</span>'
    r'.*?href="(?P<doc_url>/large-shareholding/holding/E\d+/[0-9A-Z]{4}/(?P<doc_id>S\w+))">\s*(?P<doc_type>[^<]*?)\s*</a>',
    re.S)


def get(url: str, tries: int = 3) -> str:
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read().decode("utf-8", "ignore")
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(3 * (i + 1))
    return ""


def filings_on(day: dt.date) -> list[dict]:
    page = get(f"{BASE}/large-shareholding/index/{day.isoformat()}")
    out = []
    for tr in page.split("<tr>"):
        m = ROW_RE.search(tr)
        if not m:
            continue
        f = {k: html.unescape(v).strip() for k, v in m.groupdict().items()}
        pm = re.match(r"([\d.]+)%\s*([+\-][\d.]+)?", f["pct"])
        f["pct_value"] = float(pm.group(1)) if pm else None
        f["change"] = float(pm.group(2)) if pm and pm.group(2) else None
        f["day"] = day.isoformat()
        f["url"] = BASE + f["doc_url"]
        out.append(f)
    return out


def load_watchlist() -> dict[str, tuple[str, str]]:
    cfg = json.loads(WATCHLIST.read_text(encoding="utf-8"))
    return {code: (group, name) for group, ents in cfg["groups"].items() for code, name in ents.items()}


def classify(f: dict) -> str:
    t = f["doc_type"]
    if t.startswith("大量保有報告書"):
        return "NEW POSITION (crossed 5%)"
    if "短期大量譲渡" in t:
        return "BIG SALE (short-term large transfer)"
    if t.startswith("訂正"):
        return "Correction"
    if f["pct_value"] is not None and f["pct_value"] <= 5:
        return "EXIT (now at or below 5%)"
    if f["change"] is not None:
        return "Added" if f["change"] > 0 else "Cut" if f["change"] < 0 else "Update"
    return "Update"


def market_info(code: str) -> str:
    try:
        from investing.jquants import daily_bars
        today = dt.datetime.now(JST).date()
        bars = daily_bars(code, (today - dt.timedelta(days=10)).strftime("%Y%m%d"), today.strftime("%Y%m%d"))
        if bars:
            b = bars[-1]
            cap = f", market cap ¥{b['MktCap'] / 1000:,.1f}B" if b.get("MktCap") else ""
            return f"close ¥{b['C']:,.0f}{cap}"
    except Exception:
        pass
    return ""


def format_alert(f: dict, who: tuple[str, str]) -> tuple[str, str]:
    group, name = who
    kind = classify(f)
    chg = f" ({f['change']:+.2f}pt)" if f["change"] is not None else ""
    title = f"{kind}: {group} – {f['code']} {f['issuer']} {f['pct']}"
    body = "\n".join(x for x in [
        f"{group} ({name}) filed a {f['doc_type']} on {f['day']} {f['time']} JST.",
        f"Stock: {f['code']} {f['issuer']}",
        f"Joint holding: {f['pct_value']}%{chg}" if f["pct_value"] is not None else "",
        market_info(f["code"]) if kind.startswith("NEW") else "",
        f["url"],
    ] if x)
    return title, body


def send(title: str, body: str, url: str = "") -> None:
    """Print the alert and push it to every configured channel; one failing channel does not stop the others."""
    print(f"\n=== {title}\n{body}", flush=True)

    def ntfy(topic: str) -> None:
        # JSON publishing keeps the Japanese company names intact (headers must be ASCII).
        msg = {"topic": topic, "title": title, "message": body, "tags": ["chart_with_upwards_trend"]}
        if url:
            msg["click"] = url
        req = urllib.request.Request(os.environ.get("NTFY_SERVER", "https://ntfy.sh"), data=json.dumps(msg).encode(),
                                     headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=30)

    def slack(hook: str) -> None:
        req = urllib.request.Request(hook, data=json.dumps({"text": f"*{title}*\n{body}"}).encode(),
                                     headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=30)

    def email(host: str) -> None:
        msg = EmailMessage()
        msg["Subject"], msg["To"] = title, settings.get("ALERT_EMAIL_TO")
        msg["From"] = settings.get("SMTP_USER") or settings.get("ALERT_EMAIL_TO")
        msg.set_content(body)
        with smtplib.SMTP(host, int(settings.get("SMTP_PORT") or 587), timeout=30) as s:
            s.starttls()
            if settings.get("SMTP_USER"):
                s.login(settings.get("SMTP_USER"), settings.get("SMTP_PASS") or "")
            s.send_message(msg)

    channels = [("ntfy", settings.get("NTFY_TOPIC"), ntfy), ("slack", settings.get("SLACK_WEBHOOK_URL"), slack),
                ("email", settings.get("SMTP_HOST") if settings.get("ALERT_EMAIL_TO") else None, email)]
    for name, cfg, fn in channels:
        if cfg:
            try:
                fn(cfg)
            except Exception as e:
                print(f"{name} alert failed: {e}", file=sys.stderr, flush=True)
    if summary := os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write(f"### {title}\n\n```\n{body}\n```\n")


def load_state() -> set[str]:
    return set(json.loads(STATE.read_text())) if STATE.exists() else set()


def save_state(seen: set[str]) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(sorted(seen)[-20000:]))


def check(days: int, seed: bool, dry_run: bool) -> int:
    watch = load_watchlist()
    seen = load_state()
    today = dt.datetime.now(JST).date()
    new = []
    for back in range(days - 1, -1, -1):
        day = today - dt.timedelta(days=back)
        if day.weekday() >= 5:
            continue
        for f in filings_on(day):
            if f["filer"] in watch and f["doc_id"] not in seen:
                new.append(f)
    for f in sorted(new, key=lambda f: (f["day"], f["time"])):
        if not seed:
            send(*format_alert(f, watch[f["filer"]]), url=f["url"])
        seen.add(f["doc_id"])
    if not dry_run:
        save_state(seen)
    print(f"[{dt.datetime.now(JST):%Y-%m-%d %H:%M} JST] {len(new)} new filing(s) from watched investors"
          + (" (seeded, no alerts)" if seed else ""), flush=True)
    return len(new)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", type=int, default=2, help="how many calendar days back to scan (default 2)")
    ap.add_argument("--seed", action="store_true", help="record current filings as seen without alerting")
    ap.add_argument("--dry-run", action="store_true", help="alert to stdout only and do not save state")
    ap.add_argument("--loop", type=int, metavar="SECONDS", help="keep running, checking every SECONDS")
    a = ap.parse_args()
    if a.dry_run:
        for k in ("NTFY_TOPIC", "SLACK_WEBHOOK_URL", "SMTP_HOST"):
            os.environ[k] = ""
    while True:
        try:
            check(a.days, a.seed, a.dry_run)
        except Exception as e:  # keep the loop alive through network blips
            print(f"check failed: {e}", file=sys.stderr, flush=True)
            if not a.loop:
                raise
        if not a.loop:
            break
        a.seed = False
        time.sleep(a.loop)


if __name__ == "__main__":
    main()
