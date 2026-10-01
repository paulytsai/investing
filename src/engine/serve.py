"""`engine serve`: a tiny FastAPI app that serves reports/ (index of runs + static pages)."""
from __future__ import annotations

import re
import threading
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, Form, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from .config import REPORTS_DIR
from .reports.render import update_index

app = FastAPI(title="Paul Tsai investment engine — reports")
REPORTS_DIR.mkdir(parents=True, exist_ok=True)
JOBS: dict[str, dict] = {}


@app.get("/runs")
def runs():
    update_index()
    return RedirectResponse("/reports/index.html")


@app.get("/", response_class=HTMLResponse)
def home():
    """The front door: what the engine sees now, check my idea, how well it has worked."""
    import glob
    import json
    import os

    from .evaluate.ledger import history
    from .reports.plain import summary_parts
    from .reports.render import env, now
    from .screen.diff import full_runs, latest_diff

    board = None
    runs_ = full_runs()
    if runs_:
        run = runs_[-1]
        try:
            cands = json.loads((run / "candidates.json").read_text())
            sizing = json.loads((run / "sizing.json").read_text())
            sectors = json.loads((run / "sectors.json").read_text())
            meta = json.loads((run / "run.json").read_text())
            chosen = sorted([c for c in cands if c["security_id"] in (sizing.get("weights") or {})], key=lambda c: -(c.get("idea_strength") or 0))
            openings = {}
            if (run / "sections.json").exists():
                for sec in json.loads((run / "sections.json").read_text()):
                    for x in sec.get("stocks", []):
                        openings[x["symbol"]] = (x.get("pitch") or {}).get("opening")
            names = [{"symbol": c["symbol"], "thesis": openings.get(c["symbol"]) or summary_parts(c, sectors.get(c["theme_sector"]), sizing["weights"].get(c["security_id"]))["thesis"].split(" — ", 1)[-1]} for c in chosen[:8]]
            ai = [v for k, v in sectors.items() if k.startswith("ai_")]
            en = sectors.get("energy")
            barbell = ("tech end: " + ", ".join(f"{v['label'].split(' — ')[0]} {v['stance']}" for v in ai) + (f"; oil end: Energy {en['stance']}" + (f" — {en['cycle_read']['verdict']}" if en.get("cycle_read") else "") if en else ""))
            board = {"run": run.name, "as_of": meta.get("as_of"), "n_scored": meta.get("n_scored"), "names": names, "barbell": barbell, "changes": latest_diff()}
        except Exception as e:  # noqa: BLE001
            board = None
            print(f"[home] board summary failed: {e}")
    bt = None
    bts = sorted(glob.glob(str(REPORTS_DIR / "backtest" / "*" / "results.json")), key=os.path.getmtime)
    if bts:
        try:
            r = json.loads(open(bts[-1]).read())
            p = r.get("pooled") or {}
            bt = {"run": Path(bts[-1]).parent.name, "title": (r.get("params") or {}).get("hold_label", "backtest"), "cohorts": p.get("cohorts"), "mean_ret": p.get("mean_cohort_ret") or 0,
                  "hold": p.get("mean_hold_years") or 0, "excess": p.get("mean_excess") or 0, "beat": p.get("share_cohorts_beating") or 0, "kelly": p.get("mean_cohort_ret_kelly")}
        except Exception:  # noqa: BLE001
            bt = None
    return env().get_template("home.html.j2").render(title="Paul's engine", board=board, bt=bt, ledger=list(reversed(history(limit=6))), generated=now(), assets="/reports/assets/")


def _run_ideas_job(job_id: str, narrate: bool) -> None:
    from .screen.run import run_ideas

    try:
        JOBS[job_id]["note"] = "scoring the universe, sector calls, Kelly" + (", narratives" if narrate else "")
        r = run_ideas(top=20, narrate=narrate, quiet=True)
        if not r:
            raise RuntimeError("no candidates: pull and build data first")
        JOBS[job_id].update({"state": "done", "url": f"/reports/ideas/{r['run_id']}/board.html"})
    except Exception as e:  # noqa: BLE001
        JOBS[job_id].update({"state": "error", "error": str(e)[:300]})


@app.post("/ideas/generate")
async def ideas_generate(narrate: str = Form("")):
    if any(j.get("state") == "running" and j.get("kind") == "ideas" for j in JOBS.values()):
        return JSONResponse({"error": "a screen is already running"}, status_code=409)
    job_id = uuid.uuid4().hex[:10]
    JOBS[job_id] = {"state": "running", "kind": "ideas", "note": "starting"}
    threading.Thread(target=_run_ideas_job, args=(job_id, narrate == "1"), daemon=True).start()
    return {"job": job_id}


@app.get("/ideas/job/{job_id}")
def ideas_job(job_id: str):
    return JOBS.get(job_id) or {"state": "error", "error": "unknown job"}


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/reports/")
def reports_index():
    update_index()
    return FileResponse(REPORTS_DIR / "index.html")


app.mount("/reports", StaticFiles(directory=str(REPORTS_DIR), html=True), name="reports")


# ---- the evaluator page: Paul's names + thesis in, a result page out (runs in a background thread; the page polls) ----


def _latest_screen_date() -> str | None:
    import glob
    import json
    import os

    runs = sorted(glob.glob(str(REPORTS_DIR / "ideas" / "*" / "run.json")), key=os.path.getmtime, reverse=True)
    for r in runs:
        try:
            m = json.loads(open(r).read())
            if int(m.get("n_scored") or 0) >= 200:
                return str(m.get("as_of"))
        except Exception:  # noqa: BLE001
            continue
    return None


@app.get("/evaluate", response_class=HTMLResponse)
def evaluate_form():
    from .evaluate.ledger import history
    from .reports.render import env, now

    rows = list(reversed(history(limit=60)))
    return env().get_template("evaluate_form.html.j2").render(title="Evaluate my ideas", ledger=rows, latest=_latest_screen_date(), generated=now(), assets="/reports/assets/")


def _scenarios_from_form(form) -> dict:
    out: dict = {}
    for k, v in form.items():
        m = re.fullmatch(r"scen_([A-Z0-9.\-]+)_(bull|base|bear)_(ret|prob)", k)
        if not m or not str(v).strip():
            continue
        sym, sc, kind = m.groups()
        try:
            x = float(str(v).replace("%", "").strip()) / 100.0
        except ValueError:
            continue
        out.setdefault(sym, {}).setdefault(sc, {})["return" if kind == "ret" else "prob"] = x
    complete = {}
    for sym, scs in out.items():
        if all(k in scs and "return" in scs[k] and "prob" in scs[k] for k in ("bull", "base", "bear")):
            complete[sym] = scs
    return complete


def _run_job(job_id: str, symbols: list[str], thesis: str, narrate: bool, as_of: str | None, scenarios: dict) -> None:
    from .evaluate.run import run_evaluate
    from .symbols import split_regions

    try:
        JOBS[job_id]["note"] = "scoring and placing the names"
        urls = []
        for reg, ss in split_regions(symbols).items():
            r = run_evaluate(ss, thesis=thesis or None, as_of=as_of or None, region=reg, narrate=narrate, scenarios=scenarios)
            if r:
                urls.append(f"/reports/evaluate/{r['run_id']}/index.html")
        if not urls:
            raise RuntimeError("no data for these names (not in the security master, or no filings visible at that date)")
        JOBS[job_id].update({"state": "done", "url": urls[0], "urls": urls})
    except Exception as e:  # noqa: BLE001
        JOBS[job_id].update({"state": "error", "error": str(e)[:300]})


@app.post("/evaluate/run")
async def evaluate_run(request: Request, symbols: str = Form(""), thesis: str = Form(""), narrate: str = Form(""), as_of: str = Form(""), csv: UploadFile | None = None):
    from .symbols import read_symbols

    form = await request.form()
    syms = read_symbols(symbols)
    if csv is not None and csv.filename:
        tmp = REPORTS_DIR / "_uploads"
        tmp.mkdir(parents=True, exist_ok=True)
        dest = tmp / f"{datetime.now().strftime('%H%M%S')}_{re.sub(r'[^A-Za-z0-9._-]', '_', csv.filename)}"
        dest.write_bytes(await csv.read())
        syms = read_symbols([*syms, str(dest)])
    if not syms:
        return JSONResponse({"error": "no symbols found"}, status_code=400)
    job_id = uuid.uuid4().hex[:10]
    JOBS[job_id] = {"state": "running", "note": "starting", "symbols": syms}
    threading.Thread(target=_run_job, args=(job_id, syms, thesis, narrate == "1", as_of.strip() or None, _scenarios_from_form(form)), daemon=True).start()
    return {"job": job_id, "symbols": syms}


@app.get("/evaluate/job/{job_id}")
def evaluate_job(job_id: str):
    return JOBS.get(job_id) or {"state": "error", "error": "unknown job"}
