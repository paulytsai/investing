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
