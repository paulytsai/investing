"""Build step: aggregate quarterly revenue, operating income, operating cash flow and capex for each commodity group
(config/commodity.yaml) from the first-filed quarterly rows, keyed to calendar quarter ends; `available_from` is the date the
last member's figures became public, so a screen at `as_of` only sees quarters that were fully reported by then."""
from __future__ import annotations

import yaml
import pandas as pd

from ..config import ROOT
from ..store import has_table, read_df, write_table

FIELDS = ("revenue", "operating_income", "ocf", "capex")


def cfg() -> dict:
    return yaml.safe_load((ROOT / "config" / "commodity.yaml").read_text(encoding="utf-8"))


def members(master: pd.DataFrame) -> dict[str, list[str]]:
    k = cfg()
    out: dict[str, list[str]] = {}
    for g, spec in k["groups"].items():
        inds = set(spec.get("industries") or [])
        syms = set(spec.get("symbols") or [])
        sel = master[(master["industry"].isin(inds)) | (master["symbol"].isin(syms))]
        sel = sel[~sel.get("is_fund", pd.Series(False, index=sel.index)).fillna(False).astype(bool)] if "is_fund" in sel.columns else sel
        out[g] = sorted(sel["security_id"].tolist())
    return out


def build_commodity_cycles(region: str = "US") -> int:
    if not has_table("fundamentals_long"):
        return 0
    master = read_df("security_master")
    master = master[master["security_id"].str.startswith(region + ":")]
    rows = []
    for g, ids in members(master).items():
        if not ids:
            continue
        idl = ",".join("'" + s + "'" for s in ids)
        f = read_df("fundamentals_long", f"security_id IN ({idl}) AND period_type = 'Q' AND field IN ('revenue','operating_income','ocf','capex') AND restatement_rank = 0")
        if f.empty:
            continue
        f["period_end"] = pd.to_datetime(f["period_end"])
        f["quarter_end"] = f["period_end"] + pd.offsets.QuarterEnd(0)
        f = f.sort_values("available_from").drop_duplicates(["security_id", "quarter_end", "field"], keep="first")   # first-filed
        piv = f.pivot_table(index=["security_id", "quarter_end"], columns="field", values="value", aggfunc="first")
        av = f.groupby(["security_id", "quarter_end"])["available_from"].max()
        piv = piv.join(av)
        piv = piv.dropna(subset=["revenue", "operating_income"])
        for qe, grp in piv.groupby(level="quarter_end"):
            n = len(grp)
            if n < int(cfg()["groups"][g].get("min_members") or cfg()["params"]["min_members"]):
                continue
            rows.append({"group": g, "quarter_end": qe.date(), "n": n, "revenue": float(grp["revenue"].sum()), "op_income": float(grp["operating_income"].sum()),
                         "ocf": float(grp["ocf"].sum()) if "ocf" in grp else None, "capex": float(grp["capex"].abs().sum()) if "capex" in grp else None,
                         "available_from": pd.Timestamp(grp["available_from"].max()).date()})
    df = pd.DataFrame(rows)
    if df.empty:
        print("[commodity] no rows")
        return 0
    write_table("commodity_cycle_quarterly", df)
    print(f"[commodity] {len(df)} group-quarters over {df['group'].nunique()} groups")
    return len(df)
