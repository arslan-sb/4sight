from __future__ import annotations
from pathlib import Path
from datetime import datetime, timezone
from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from .fakes import fake_seed, fake_get_report, fake_trace
from .models import Viewer, Role, ChangeEvent, Sensitivity

WEB = Path(__file__).parent / "web"
store, eng, _ = fake_seed()
app = FastAPI(title="4sight-mock")

@app.get("/report/{node_id}")
def report(node_id: str, role: str = "reviewer"):
    rep = fake_get_report(node_id, store, Viewer(id="anon", role=Role(role)))
    return rep.model_dump(mode="json") if rep else None

@app.get("/trace/{node_id}")
def trace(node_id: str):
    t = fake_trace(node_id, store)
    return {"path": t["path"], "origin": t["origin"].model_dump(mode="json") if t["origin"] else None}

@app.post("/simulate-change")
def simulate(body: dict):
    eng.on_data_change("x", ChangeEvent(source="Leave Calendar", record_ref="alice", after={},
                   at=datetime.now(timezone.utc), sensitivity=Sensitivity.INTERNAL))
    return {"changed": eng.fire_node("x")}

if WEB.exists():
    app.mount("/static", StaticFiles(directory=str(WEB)), name="static")

@app.get("/", response_class=HTMLResponse)
def index():
    f = WEB / "index.html"
    return f.read_text() if f.exists() else "<h1>4sight mock (web not built yet)</h1>"
