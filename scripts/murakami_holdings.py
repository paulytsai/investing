"""Current 5%+ positions of Murakami-linked investors in Japanese stocks.

Source: EDINET large-shareholding reports (大量保有報告書 / 変更報告書) as
indexed by ufocatch.com (有報キャッチャー). Listing status comes from J-Quants.

For each investor group the script reports, per stock:
  * joint holding % from the latest filing (all group entities combined)
  * start date = reporting-obligation date of the most recent initial
    large-holding report (the day the group crossed 5%)
  * trend = direction of the latest filings (a change report is required on
    every move of 1 point or more, so no recent filing means roughly flat)

    python scripts/murakami_holdings.py            # writes reports/*.csv and *.md
"""

from __future__ import annotations

import csv
import datetime as dt
import html
import re
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from investing.jquants import master  # noqa: E402

BASE = "https://ufocatch.com"
UA = "Mozilla/5.0 (investing research script)"
CACHE = Path.home() / ".cache" / "ufocatch"
# A filing older than this is treated as stale: the stake may have been
# squeezed out, tendered or merged away without a later report.
STALE_BEFORE = "2024-01-01"

# EDINET filer codes. Joint-holder links were traced from the filings themselves.
GROUPS: dict[str, dict[str, str]] = {
    "Murakami family (旧村上ファンド系)": {
        "E35393": "シティインデックスイレブンス", "E31712": "野村絢", "E26526": "ATRA",
        "E27236": "南青山不動産", "E24231": "レノ", "E04037": "エスグラントコーポレーション",
        "E26513": "フォルティス", "E26527": "オフィスサポート", "E04917": "C&I Holdings",
        "E40184": "シティインデックスファースト", "E39600": "シティインデックスサード",
        "E42031": "シティインデックスフィフス", "E41818": "Mホールディングス",
        "E34604": "野村幸弘", "E40616": "Kadan Capital Fund", "E40411": "湯沢",
    },
    "Murakami Takateru (村上貴輝) / MI entities": {
        "E38513": "村上貴輝", "E38425": "MI2", "E40967": "MI5", "E40978": "MI1",
    },
    "Effissimo Capital (founded by ex-Murakami Fund staff)": {"E11852": "Effissimo"},
    "Strategic Capital (founded by ex-Murakami Fund staff)": {"E27325": "Strategic Capital"},
}


def fetch(path: str, refresh: bool = False) -> str:
    CACHE.mkdir(parents=True, exist_ok=True)
    fn = CACHE / (re.sub(r"[^A-Za-z0-9]+", "_", path.strip("/")) + ".html")
    if refresh or not fn.exists() or fn.stat().st_size < 1000:
        req = urllib.request.Request(BASE + path, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=30) as r:
            fn.write_bytes(r.read())
        time.sleep(0.3)
    return fn.read_text("utf-8", "ignore")


def _text(x: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", x)).strip()


def _pct(x: str) -> tuple[float | None, float]:
    m = re.match(r"\s*([\d.]+)%(?:（(.*?)）)?", x)
    if not m:
        return None, 0.0
    chg = m.group(2) or ""
    if chg in ("", "同"):
        return float(m.group(1)), 0.0
    val = float(re.sub(r"[^\d.]", "", chg))
    return float(m.group(1)), -val if "△" in chg else val


def _date(yy: str) -> str:
    return "20" + yy.replace("/", "-") if re.fullmatch(r"\d\d/\d\d/\d\d", yy) else yy


def holder_positions(edinet: str, refresh: bool) -> list[dict]:
    page = fetch(f"/large-shareholding/holder/{edinet}", refresh)
    out = []
    for tr in re.findall(r"<tr>(.*?)</tr>", page, flags=re.S):
        tds = re.findall(r"<td[^>]*>(.*?)</td>", tr, flags=re.S)
        m = re.search(r'title="\[([0-9A-Z]{4})\] (.*?)"', tds[0]) if len(tds) >= 5 else None
        if not m:
            continue
        joint, chg = _pct(_text(tds[1]))
        out.append(dict(entity=edinet, code=m.group(1), name=html.unescape(m.group(2)),
                        joint=joint, chg=chg, disclosed=_date(_text(tds[3]))))
    return out


def history(edinet: str, code: str, refresh: bool) -> list[dict]:
    page = fetch(f"/large-shareholding/holding/{edinet}/{code}", refresh)
    i = page.find("履歴</h2>")
    rows = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", page[i:page.find("</table>", i)], flags=re.S):
        tds = re.findall(r"<td[^>]*>(.*?)</td>", tr, flags=re.S)
        if len(tds) < 6:
            continue
        joint, chg = _pct(_text(tds[3]))
        rows.append(dict(oblig=_date(_text(tds[0])), disclosed=_date(_text(tds[1])),
                         doc=_text(tds[2]), joint=joint, chg=chg))
    return rows


def trend(hist: list[dict], today: dt.date) -> str:
    last = hist[-1]
    recent = [h["chg"] for h in hist[-4:] if h["chg"]]
    age = (today - dt.date.fromisoformat(last["disclosed"])).days
    if age > 180:
        return f"Flat (no ≥1pt change filed since {last['disclosed']})"
    if last["chg"] > 0:
        streak = sum(1 for c in recent if c > 0)
        return "Increasing" + (f" ({streak} of last {len(recent)} filings up)" if len(recent) > 1 else "")
    if last["chg"] < 0:
        streak = sum(1 for c in recent if c < 0)
        return "Decreasing" + (f" ({streak} of last {len(recent)} filings down)" if len(recent) > 1 else "")
    return "Flat (latest filing had no ratio change)"


def start_date(hist: list[dict]) -> str:
    # Most recent initial report, i.e. the latest time the group crossed 5%.
    for h in reversed(hist):
        if h["doc"].startswith("大量保有報告書"):
            return h["oblig"]
    return f"before {hist[0]['oblig']} (earliest filing in source)"


def build(refresh: bool = False) -> tuple[list[dict], list[dict], list[dict]]:
    today = dt.date.today()
    listed = {r["Code"][:4]: r for r in master()}
    current, exited, stale = [], [], []
    for group, ents in GROUPS.items():
        latest: dict[str, dict] = {}
        rows = [p for e in ents for p in holder_positions(e, refresh)]
        for p in rows:
            if p["code"] not in latest or p["disclosed"] > latest[p["code"]]["disclosed"]:
                latest[p["code"]] = p
        for code, p in latest.items():
            hist: dict[tuple, dict] = {}
            for e in {r["entity"] for r in rows if r["code"] == code}:
                for h in history(e, code, refresh):
                    hist[(h["oblig"], h["disclosed"], h["joint"])] = h
            hs = sorted(hist.values(), key=lambda h: (h["disclosed"], h["oblig"]))
            jq = listed.get(code)
            is_reit = code.startswith(("2972", "3", "8")) and "投資法人" in p["name"]
            rec = dict(group=group, code=code,
                       name=jq["CoName"] if jq else p["name"],
                       name_en=jq["CoNameEn"] if jq else "",
                       joint_pct=p["joint"], last_change_pt=p["chg"],
                       latest_filing=p["disclosed"], start=start_date(hs),
                       trend=trend(hs, today),
                       listed="yes" if jq or is_reit else "no (delisted / not in J-Quants)")
            if p["joint"] is not None and p["joint"] > 5 and rec["listed"] == "yes":
                (stale if p["disclosed"] < STALE_BEFORE else current).append(rec)
            elif p["joint"] is not None and p["joint"] <= 5 and \
                    (today - dt.date.fromisoformat(p["disclosed"])).days <= 365:
                rec["trend"] = f"Cut below 5% on {p['disclosed']}"
                exited.append(rec)
    return current, exited, stale


def main() -> None:
    current, exited, stale = build(refresh="--refresh" in sys.argv)
    stamp = dt.date.today().isoformat()
    out = ROOT / "reports"
    out.mkdir(exist_ok=True)
    cols = ["group", "code", "name", "name_en", "joint_pct", "last_change_pt",
            "latest_filing", "start", "trend"]
    with open(out / f"murakami_holdings_{stamp}.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=cols + ["status"], extrasaction="ignore")
        w.writeheader()
        for r in current:
            w.writerow({**r, "status": "current >5%"})
        for r in exited:
            w.writerow({**r, "status": "cut below 5% in last 12 months"})
        for r in stale:
            w.writerow({**r, "status": f"stale (last filing before {STALE_BEFORE})"})
    md = [f"# Murakami-linked 5%+ holdings in Japanese stocks ({stamp})", "",
          "Source: EDINET large-shareholding reports via ufocatch.com; listing check via J-Quants.",
          "Holding % is the joint total for all entities in the group, from the latest filing.",
          "Start is the reporting-obligation date of the latest initial report (crossing 5%).", ""]
    for g in GROUPS:
        rows = [r for r in current if r["group"] == g]
        md += [f"## {g}", "", "| Code | Name | 銘柄 | Held % | Last Δ pt | Latest filing | Position started | Trend |",
               "|---|---|---|---:|---:|---|---|---|"]
        for r in sorted(rows, key=lambda r: r["latest_filing"], reverse=True):
            md.append(f"| {r['code']} | {r['name_en'].title()} | {r['name']} | {r['joint_pct']:.2f} | {r['last_change_pt']:+.2f} | "
                      f"{r['latest_filing']} | {r['start']} | {r['trend']} |")
        md.append("")
    md += ["## Cut below 5% in the last 12 months", "",
           "| Group | Code | Name | Last reported % | Filing |", "|---|---|---|---:|---|"]
    for r in sorted(exited, key=lambda r: r["latest_filing"], reverse=True):
        md.append(f"| {r['group'].split(' (')[0]} | {r['code']} | {r['name']} | {r['joint_pct']:.2f} | {r['latest_filing']} |")
    md += ["", f"## Stale: still above 5% on paper, but last filing before {STALE_BEFORE}", "",
           "| Group | Code | Name | Last reported % | Filing |", "|---|---|---|---:|---|"]
    for r in stale:
        md.append(f"| {r['group'].split(' (')[0]} | {r['code']} | {r['name']} | {r['joint_pct']:.2f} | {r['latest_filing']} |")
    (out / f"murakami_holdings_{stamp}.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print("\n".join(md))


if __name__ == "__main__":
    main()
