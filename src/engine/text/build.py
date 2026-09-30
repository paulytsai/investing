"""Tier 1 build: run the lexical extractor over every stored transcript and filing item → `text_signals` (dated, PIT)."""
from __future__ import annotations

import re

import pandas as pd

from ..store import has_table, read_df, write_table
from .lexical import SIGNALS, counts, extract


def _iter_transcripts(batch_rows: int = 2000):
    """Stream the (2+ GB) transcripts table in row batches instead of loading it whole."""
    import pyarrow.parquet as pq

    from ..store import table_path

    pf = pq.ParquetFile(table_path("transcripts"))
    for batch in pf.iter_batches(batch_size=batch_rows):
        df = batch.to_pandas()
        yield from df.itertuples(index=False)


def build_text_signals() -> int:
    rows: list[dict] = []
    if has_table("transcripts"):
        tr = _iter_transcripts()
        for r in tr:
            hits = extract(r.content or "")
            words = len(re.findall(r"\w+", r.content or ""))
            c = counts(hits)
            first = {}
            for h in hits:
                first.setdefault(h.category, h.quote)
            for cat, rid, d, _ in SIGNALS:
                if c.get(cat, 0):
                    rows.append({"security_id": r.security_id, "doc_type": "transcript", "doc_ref": f"Q{r.quarter} FY{r.fiscal_year}", "doc_date": r.call_date,
                                 "available_from": r.available_from, "category": cat, "rule_id": rid, "direction": d, "count": int(c[cat]), "words": words,
                                 "quote": first.get(cat, ""), "source": "fmp transcript"})
    if has_table("filings_text"):
        fl = read_df("filings_text")
        for r in fl.itertuples(index=False):
            hits = extract(r.text or "")
            c = counts(hits)
            first = {}
            for h in hits:
                first.setdefault(h.category, h.quote)
            for cat, rid, d, _ in SIGNALS:
                if c.get(cat, 0):
                    rows.append({"security_id": r.security_id, "doc_type": f"{r.form} Item {r.item}", "doc_ref": r.accession, "doc_date": r.filed,
                                 "available_from": r.available_from, "category": cat, "rule_id": rid, "direction": d, "count": int(c[cat]), "words": int(r.words or 0),
                                 "quote": first.get(cat, ""), "source": "EDGAR"})
    df = pd.DataFrame(rows)
    if df.empty:
        print("[text build] no documents; run `engine text pull` first")
        return 0
    write_table("text_signals", df)
    print(f"[text build] {len(df)} signal rows over {df['doc_ref'].nunique()} documents, {df['security_id'].nunique()} names")
    return len(df)


def signals_for(as_of: pd.Timestamp, security_ids: list[str], lookback_days: int = 400) -> pd.DataFrame:
    """Signal rows visible at as_of for the given names (available_from ≤ as_of, document date within lookback)."""
    if not has_table("text_signals") or not security_ids:
        return pd.DataFrame()
    ids = ",".join("'" + s + "'" for s in security_ids)
    return read_df("text_signals", f"security_id IN ({ids}) AND available_from <= DATE '{as_of.date()}' AND doc_date >= DATE '{(as_of - pd.Timedelta(days=lookback_days)).date()}'")


def text_factors(sig: pd.DataFrame) -> dict:
    """Aggregate one name's visible signal rows into factors: the two most recent transcripts and the latest filing items,
    each scored per 10k words, averaged. Returns {} when there is no document (coverage, never imputed)."""
    if sig is None or sig.empty:
        return {}
    docs = sig.groupby(["doc_type", "doc_ref", "doc_date"])
    per_doc = []
    order = sorted(docs.groups.keys(), key=lambda k: pd.Timestamp(k[2]), reverse=True)
    n_tr = 0
    for key in order:
        g = docs.get_group(key)
        is_tr = key[0] == "transcript"
        if is_tr:
            n_tr += 1
            if n_tr > 2:
                continue
        words = float(g["words"].iloc[0] or 0)
        k = 10_000.0 / max(words, 2_000.0)
        c = dict(zip(g["category"], g["count"]))
        per_doc.append({
            "text_demand": (c.get("demand_up", 0) - c.get("demand_down", 0)) * k, "text_pricing": (c.get("pricing_up", 0) - c.get("pricing_down", 0)) * k,
            "text_guidance": (c.get("guidance_up", 0) - c.get("guidance_down", 0)) * k, "text_leadership": c.get("leadership", 0) * k,
            "text_red_flags": c.get("red_flag", 0) * k, "text_concentration": c.get("concentration", 0) * k, "text_ai_receipts": c.get("ai_receipts", 0) * k,
        })
    if not per_doc:
        return {}
    out = {k: float(sum(d[k] for d in per_doc) / len(per_doc)) for k in per_doc[0]}
    out["text_docs_n"] = float(len(per_doc))
    q = sig.sort_values("doc_date", ascending=False)
    out["text_quotes"] = [{"category": r.category, "rule_id": r.rule_id, "doc": f"{r.doc_type} {r.doc_ref} ({r.doc_date})", "quote": r.quote}
                          for r in q.drop_duplicates("category").itertuples(index=False)][:8]
    return out
