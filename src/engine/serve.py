"""`engine serve`: a tiny FastAPI app that serves reports/ (index of runs + static pages)."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from .config import REPORTS_DIR
from .reports.render import update_index

app = FastAPI(title="Paul Tsai investment engine — reports")
REPORTS_DIR.mkdir(parents=True, exist_ok=True)


@app.get("/")
def root():
    update_index()
    return RedirectResponse("/reports/index.html")


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/reports/")
def reports_index():
    update_index()
    return FileResponse(REPORTS_DIR / "index.html")


app.mount("/reports", StaticFiles(directory=str(REPORTS_DIR), html=True), name="reports")


# ---- the evaluator page: Paul's names + thesis in, a result page out (runs in a background thread; the page polls) ----
import re  # noqa: E402
import threading  # noqa: E402
import uuid  # noqa: E402
from datetime import datetime  # noqa: E402

from fastapi import Form, Request, UploadFile  # noqa: E402
from fastapi.responses import HTMLResponse, JSONResponse  # noqa: E402

JOBS: dict[str, dict] = {}


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
