"""Theme diffusion tracker (F-39 / R-23 / §6.4 premises): which big themes are spreading through company calls, when a theme
expands beyond its origin sector, who mentions it for the first time — point-in-time by call date, so it is backtestable —
plus emerging terms found without a lexicon, and Jurrien Timmer's weekly theme frequencies mapped onto the same buckets
(relay-weight context, never a score)."""
from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor

import pandas as pd
import yaml

from ..config import CONFIG_DIR
from ..store import has_table, read_df, table_path, write_table

STOP = set("""the a an and or of to in for on with at by from as is are was were be been being that this these those it its we our you your they their
he she his her them us i me my not no yes if then than so such very can could would should will shall may might must do does did done have has had
having about above across after again against all almost also although always among any because before between both but each either enough
even ever every few first further get give go going good great here how however into just last less like little many more most much new next
now off often only other others out over own per same second see since some still take terms thank thanks think through today too under until up
upon well what when where whether which while who whom whose why year years quarter quarters million billion percent one two three four five
number also right okay yeah look kind sort lot bit things thing way ways really pretty going forward continue continued continues business
company results revenue revenues growth margin margins cash flow operating income net sales customers customer market markets team call
question questions operator morning afternoon everyone welcome guidance outlook fiscal financial""".split())
WORD = re.compile(r"[A-Za-z][A-Za-z\-]{2,}")


def _lexicon() -> dict:
    return yaml.safe_load((CONFIG_DIR / "themes.yaml").read_text(encoding="utf-8"))


def _compiled():
    lex = _lexicon()
    return {k: (v["label"], [re.compile(p, re.I) for p in v["patterns"]]) for k, v in lex["themes"].items()}, lex.get("emerging", {})


def _quarter(d) -> str:
    t = pd.Timestamp(d)
    return f"{t.year}Q{(t.month - 1) // 3 + 1}"


def _scan_rowgroups(args):
    """Worker: theme mention counts + bigram document sets for the given parquet row groups."""
    path, groups = args
    import pyarrow.parquet as pq

    themes, _ = _compiled()
    pf = pq.ParquetFile(path)
    mentions, bigram_docs = [], defaultdict(Counter)
    for g in groups:
        df = pf.read_row_group(g, columns=["security_id", "fiscal_year", "quarter", "call_date", "available_from", "content"]).to_pandas()
        for r in df.itertuples(index=False):
            text = r.content or ""
            words = len(re.findall(r"\w+", text))
            q = _quarter(r.call_date)
            for key, (label, pats) in themes.items():
                n, quote = 0, ""
                for p in pats:
                    for m in p.finditer(text):
                        n += 1
                        if not quote:
                            lo = max(0, text.rfind(". ", 0, m.start()) + 2)
                            hi = text.find(". ", m.start())
                            quote = text[lo: (hi + 1 if hi > 0 else lo + 240)][:300]
                if n:
                    mentions.append({"security_id": r.security_id, "theme": key, "quarter": q, "call_date": pd.Timestamp(r.call_date).date(),
                                     "available_from": pd.Timestamp(r.available_from).date(), "count": n, "words": words, "quote": quote,
                                     "doc_ref": f"Q{r.quarter} FY{r.fiscal_year}"})
            toks = [w.lower() for w in WORD.findall(text)]
            seen = set()
            for a, b in zip(toks, toks[1:]):
                if a in STOP or b in STOP or a == b:
                    continue
                bg = f"{a} {b}"
                if bg not in seen:
                    seen.add(bg)
            for bg in seen:
                bigram_docs[bg][q] += 1
    return mentions, {k: dict(v) for k, v in bigram_docs.items() if sum(v.values()) >= 5}


def build_themes(workers: int = 3) -> dict:
    """Scan every transcript → theme_mentions, theme_quarterly (diffusion), theme_emerging; then Timmer's weekly buckets."""
    import pyarrow.parquet as pq

    path = table_path("transcripts")
    pf = pq.ParquetFile(path)
    n = pf.num_row_groups
    chunks = [list(range(i, n, workers)) for i in range(workers)]
    mentions: list[dict] = []
    by_q: dict[str, Counter] = defaultdict(Counter)       # quarter → bigram → document count
    with ProcessPoolExecutor(max_workers=workers) as ex:
        for m, bd in ex.map(_scan_rowgroups, [(str(path), c) for c in chunks if c]):
            mentions.extend(m)
            for bg, qc in bd.items():
                for q, c in qc.items():
                    by_q[q][bg] += c
    tm = pd.DataFrame(mentions)
    write_table("theme_mentions", tm)
    # --- diffusion per theme × calendar quarter -------------------------------------------------------------
    docs_q = _docs_per_quarter(path)
    master = read_df("security_master")[["security_id", "sector"]].set_index("security_id")["sector"].to_dict()
    tm["sector"] = tm["security_id"].map(master)
    rows = []
    first_seen = tm.sort_values("call_date").drop_duplicates(["theme", "security_id"]).set_index(["theme", "security_id"])["quarter"].to_dict()
    for (theme, q), g in tm.groupby(["theme", "quarter"]):
        names = g["security_id"].unique()
        new = [s for s in names if first_seen.get((theme, s)) == q]
        sec = Counter(g["sector"].dropna())
        rows.append({"theme": theme, "quarter": q, "n_docs": int(len(names)), "n_docs_all": int(docs_q.get(q, 0)),
                     "breadth_pct": float(100.0 * len(names) / docs_q[q]) if docs_q.get(q) else None, "n_sectors": int(len(sec)),
                     "n_new_entrants": int(len(new)), "top_sectors": json.dumps([f"{k} {v}" for k, v in sec.most_common(4)]),
                     "new_entrants": json.dumps(sorted(new)[:40]), "mentions_per_doc": float(g["count"].sum() / max(1, len(names)))})
    tq = pd.DataFrame(rows).sort_values(["theme", "quarter"])
    write_table("theme_quarterly", tq)
    # --- emerging bigrams: document frequency vs the prior four quarters -------------------------------------
    _, em = _compiled()
    min_docs, ratio_min, top_n = int(em.get("min_docs_per_quarter", 40)), float(em.get("min_ratio_vs_prior_year", 3.0)), int(em.get("top_n", 25))
    quarters = sorted(by_q)
    erows = []
    for i, q in enumerate(quarters):
        prior = quarters[max(0, i - 4): i]
        if not prior:
            continue
        cand = []
        for bg, c in by_q[q].items():
            if c < min_docs:
                continue
            base = sum(by_q[p].get(bg, 0) for p in prior) / len(prior)
            r = c / max(base, 2.0)
            if r >= ratio_min:
                cand.append((bg, c, r))
        for bg, c, r in sorted(cand, key=lambda x: -x[2])[:top_n]:
            erows.append({"quarter": q, "term": bg, "n_docs": int(c), "ratio_vs_prior_year": float(r), "n_docs_all": int(docs_q.get(q, 0))})
    write_table("theme_emerging", pd.DataFrame(erows) if erows else pd.DataFrame(columns=["quarter", "term", "n_docs", "ratio_vs_prior_year", "n_docs_all"]))
    xw = build_timmer_weekly()
    rep = {"mentions": int(len(tm)), "theme_quarters": int(len(tq)), "emerging_terms": int(len(erows)), "timmer_weeks": int(len(xw))}
    print(f"[themes] {json.dumps(rep)}", flush=True)
    return rep


def _docs_per_quarter(path) -> dict[str, int]:
    import pyarrow.parquet as pq

    t = pq.read_table(path, columns=["security_id", "call_date"]).to_pandas()
    t["quarter"] = [_quarter(d) for d in t["call_date"]]
    return t.groupby("quarter")["security_id"].nunique().to_dict()


# --- Timmer's themes → the same buckets ----------------------------------------------------------------------
X_BUCKETS: list[tuple[str, str, list[str]]] = [
    ("ai_compute", "AI / accelerated computing", ["ai capex", "ai ", "artificial intelligence", "mag 7", "nvidia", "gpu", "semis"]),
    ("breadth", "Breadth / concentration", ["breadth", "broadening", "equal-weight", "concentration", "mag 7 leadership", "rotation"]),
    ("valuation", "Valuation (P/E, CAPE, ERP)", ["valuation", "p/e", "cape", "equity risk premium", "fed model", "multiple"]),
    ("inflation", "Inflation", ["inflation"]),
    ("rates", "Rates / Fed / liquidity", ["rates", "real rates", "10y", "yield", "term premium", "fed", "liquidity", "treasury", "duration", "bond"]),
    ("earnings", "Earnings, margins, revisions", ["earnings", "margins", "revisions", "estimate", "buyback", "payout", "profit"]),
    ("dollar_fx", "Dollar / FX", ["dollar", "fx", "yen", "currency"]),
    ("credit", "Credit", ["credit", "spreads", "private credit", "default"]),
    ("gold_crypto", "Gold / bitcoin", ["gold", "bitcoin", "btc", "crypto", "power law"]),
    ("oil_commodities", "Oil / commodities / geopolitics", ["oil", "commodit", "energy", "iran", "hormuz", "geopolit", "war"]),
    ("international", "International / EM", ["international", "emerging", "europe", "eurozone", "japan", "china", "ex-us", "acwi"]),
    ("correlations", "Correlations / diversification / 60-40", ["correlation", "diversification", "asset allocation", "60/40", "60-40", "stock-bond"]),
    ("sentiment", "Sentiment / positioning / momentum / vol", ["sentiment", "positioning", "momentum", "volatil", "vix", "flows", "drawdown", "seasonal"]),
    ("secular", "Secular cycle / analogs", ["secular", "analog", "cycle", "regime"]),
]


def bucket_for(theme: str) -> str | None:
    t = theme.lower()
    for key, _, kws in X_BUCKETS:
        if any(k in t for k in kws):
            return key
    return None


def build_timmer_weekly() -> pd.DataFrame:
    if not has_table("x_threads"):
        return pd.DataFrame()
    th = read_df("x_threads")
    th = th[th["analysis_status"] == "done"]
    rows = []
    for r in th.itertuples(index=False):
        themes = json.loads(r.themes) if isinstance(r.themes, str) else []
        buckets = {bucket_for(t) for t in themes} - {None}
        week = (pd.Timestamp(r.first_at) - pd.to_timedelta(pd.Timestamp(r.first_at).weekday(), unit="D")).normalize().date()
        for b in buckets:
            rows.append({"week": week, "bucket": b, "conversation_id": r.conversation_id, "summary": r.summary, "first_at": pd.Timestamp(r.first_at)})
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    out = df.groupby(["week", "bucket"]).agg(n_threads=("conversation_id", "nunique"), sample_summary=("summary", "first")).reset_index()
    write_table("x_theme_weekly", out)
    return out


# --- screen factors (point-in-time) ------------------------------------------------------------------------
def expanding_themes(as_of: pd.Timestamp, min_docs: int = 20, ratio: float = 1.5) -> dict[str, dict]:
    """Themes whose breadth in the last completed quarter before as_of is ≥ ratio × four quarters earlier."""
    if not has_table("theme_quarterly"):
        return {}
    tq = read_df("theme_quarterly")
    q_now = _quarter(as_of)
    done = tq[tq["quarter"] < q_now]
    out = {}
    for theme, g in done.groupby("theme"):
        g = g.sort_values("quarter")
        if len(g) < 5 or g["n_docs"].iloc[-1] < min_docs:
            continue
        b1, b0 = g["breadth_pct"].iloc[-1], g["breadth_pct"].iloc[-5]
        if b0 and b1 and b1 >= ratio * b0:
            out[theme] = {"breadth_now": float(b1), "breadth_4q_ago": float(b0), "quarter": g["quarter"].iloc[-1],
                          "new_entrants": int(g["n_new_entrants"].iloc[-1]), "n_sectors": int(g["n_sectors"].iloc[-1])}
    return out


def theme_factors_for(as_of: pd.Timestamp, security_ids: list[str]) -> dict[str, dict]:
    """Per name: exposure to expanding themes (mentions per 10k words in the two latest visible calls) and whether it is a
    new entrant (first mention within the last two calls). {} when no theme data."""
    exp = expanding_themes(as_of)
    if not exp or not has_table("theme_mentions") or not security_ids:
        return {}
    ids = ",".join("'" + s + "'" for s in security_ids)
    tm = read_df("theme_mentions", f"security_id IN ({ids}) AND available_from <= DATE '{as_of.date()}'")
    if tm.empty:
        return {}
    out: dict[str, dict] = {}
    for sid, g in tm.groupby("security_id"):
        g = g.sort_values("call_date")
        last_calls = sorted(g["call_date"].unique())[-2:]
        recent = g[g["call_date"].isin(last_calls)]
        expo = 0.0
        entrant = 0.0
        themes_hit = []
        for theme in exp:
            gt = recent[recent["theme"] == theme]
            if gt.empty:
                continue
            per10k = float((gt["count"] / gt["words"].clip(lower=2000) * 10_000).mean())
            expo += per10k
            themes_hit.append(theme)
            if g[g["theme"] == theme]["call_date"].min() in last_calls:
                entrant = 1.0
        if themes_hit:
            out[sid] = {"theme_exposure": expo, "theme_new_entrant": entrant, "themes_expanding_hit": themes_hit,
                        "theme_quote": str(recent[recent["theme"].isin(themes_hit)].sort_values("count", ascending=False)["quote"].iloc[0])[:300]}
    return out
