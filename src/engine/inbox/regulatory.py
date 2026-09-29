"""Pull Federal Register documents for the configured searches into the events table (security_id = 'MACRO')."""
from __future__ import annotations

import hashlib
import json
from datetime import date, timedelta

import pandas as pd
import yaml

from ..config import CONFIG_DIR
from ..connectors.federal_register import FederalRegister
from ..store import has_table, read_df, write_table


def pull_regulatory(today: date | None = None) -> int:
    cfg = yaml.safe_load((CONFIG_DIR / "federal_register.yaml").read_text(encoding="utf-8"))
    today = today or date.today()
    start = (today - timedelta(days=int(cfg["lookback_days"]))).isoformat()
    fr = FederalRegister()
    rows = []
    for s in cfg["searches"]:
        try:
            docs = fr.search(s["term"], start=start)
        except Exception as e:  # noqa: BLE001
            print(f"[federal register] {s['id']}: {str(e)[:120]}")
            continue
        for d in docs:
            dn = d.get("document_number") or d.get("html_url")
            eid = hashlib.sha1(f"MACRO|regulatory|{d.get('publication_date')}|{dn}".encode()).hexdigest()[:16]
            rows.append({"event_id": eid, "security_id": "MACRO", "event_date": d.get("publication_date"), "available_from": d.get("publication_date"),
                         "event_type": "regulatory", "payload": json.dumps({"title": d.get("title"), "type": d.get("type"), "abstract": (d.get("abstract") or "")[:600],
                                                                            "agencies": [a.get("name") or a.get("raw_name") or "" for a in (d.get("agencies") or []) if isinstance(a, dict)],
                                                                            "url": d.get("html_url"), "search_id": s["id"], "sectors": s.get("sectors", []),
                                                                            "themes": s.get("themes", []), "significant": d.get("significant")}),
                         "source": "federal_register", "source_ref": str(dn)})
    if not rows:
        return 0
    new = pd.DataFrame(rows).drop_duplicates("event_id")
    if has_table("events"):
        old = read_df("events")
        old = old[old.event_type != "regulatory"]
        new = pd.concat([old, new], ignore_index=True)
    write_table("events", new)
    print(f"[federal register] stored {len(rows)} regulatory documents from {len(cfg['searches'])} searches")
    return len(rows)
