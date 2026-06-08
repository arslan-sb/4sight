from __future__ import annotations
from pathlib import Path
from datetime import datetime, timezone
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from .models import ChangeEvent, Sensitivity, Viewer, Role

WEB = Path(__file__).parent / "web"


def build_app(seed_fn=None, get_report_fn=None, trace_fn=None) -> FastAPI:
    if seed_fn is None:
        from .seed import build_seed as seed_fn
    if get_report_fn is None:
        from .reports import get_report as get_report_fn
    if trace_fn is None:
        from .reports import trace_to_source as trace_fn

    store, eng, _ = seed_fn()
    app = FastAPI(title="4sight")
    app.state.sockets = []
    if WEB.exists():
        app.mount("/static", StaticFiles(directory=str(WEB)), name="static")

    def _broadcast(changed):
        import anyio
        for ws in list(app.state.sockets):
            try:
                anyio.from_thread.run(ws.send_json, {"changed": changed})
            except Exception:
                pass
    eng.listeners.append(_broadcast)

    @app.get("/", response_class=HTMLResponse)
    def index():
        f = WEB / "index.html"
        return f.read_text() if f.exists() else "<h1>4sight (web not built yet)</h1>"

    @app.get("/graph", response_class=HTMLResponse)
    def graph():
        f = WEB / "graph.html"
        return f.read_text() if f.exists() else "<h1>graph not built yet</h1>"

    @app.get("/raw", response_class=HTMLResponse)
    def raw_graph():
        f = WEB / "raw.html"
        return f.read_text() if f.exists() else "<h1>raw graph not built yet</h1>"

    @app.get("/graph-raw")
    def graph_raw(role: str = "reviewer"):
        viewer = Viewer(id="anon", role=Role(role))
        nodes = []
        for nid in store.all_ids():
            node = store.get_node(nid)
            entry = {
                "id": nid,
                "title": node.title,
                "kind": node.kind.value,
                "severity": None,
            }
            if node.current:
                entry["severity"] = node.current.llm_verdict.severity.value
            nodes.append(entry)
        edges = []
        for nid in store.all_ids():
            node = store.get_node(nid)
            for cid in store.children(nid):
                child = store.get_node(cid)
                edges.append({
                    "src": nid,
                    "dst": cid,
                    "src_title": node.title,
                    "dst_title": child.title,
                    "type": "decomposition",
                })
            for did in store.dependencies(nid):
                dep = store.get_node(did) if did in store.nodes else None
                edges.append({
                    "src": did,
                    "dst": nid,
                    "src_title": dep.title if dep else did,
                    "dst_title": node.title,
                    "type": "dependency",
                })
        return {"nodes": nodes, "edges": edges}

    @app.get("/graph-data")
    def graph_data(role: str = "reviewer"):
        viewer = Viewer(id="anon", role=Role(role))
        nodes = {}
        for nid in store.all_ids():
            node = store.get_node(nid)
            entry = {
                "id": nid,
                "title": node.title,
                "kind": node.kind.value,
                "children": store.children(nid),
                "dependencies": [d for d in store.dependencies(nid)],
                "severity": None,
            }
            if node.current:
                entry["severity"] = node.current.llm_verdict.severity.value
            nodes[nid] = entry
        return nodes

    @app.get("/report/{node_id}")
    def report(node_id: str, role: str = "reviewer"):
        rep = get_report_fn(node_id, store, Viewer(id="anon", role=Role(role)))
        return rep.model_dump(mode="json") if rep else None

    @app.get("/root")
    def get_root():
        for nid in store.all_ids():
            if not store.parents(nid):
                return {"node_id": nid}
        return {"node_id": store.all_ids()[0] if store.all_ids() else ""}

    @app.get("/trace/{node_id}")
    def trace(node_id: str):
        t = trace_fn(node_id, store)
        return {"path": t["path"], "origin": t["origin"].model_dump(mode="json") if t["origin"] else None}

    @app.post("/simulate-change")
    def simulate(body: dict):
        now = datetime.now(timezone.utc)
        kind = body.get("kind", "leave")
        source = body.get("source", "Leave Calendar")
        node_id = body.get("node_id", "alice_owner")
        effect_score = float(body.get("effect_score", 40))

        if kind == "salary":
            change = ChangeEvent(source=source, record_ref=node_id, before=None,
                                 after={"effect_score": effect_score, "category": "compensation"},
                                 at=now, sensitivity=Sensitivity.INTERNAL)
        elif kind == "leave":
            change = ChangeEvent(source=source, record_ref=node_id, before=None,
                                 after={"effect_score": effect_score,
                                        "capacity_drop_pct": effect_score,
                                        "single_owner": True, "data_age_h": 2},
                                 at=now, sensitivity=Sensitivity.INTERNAL)
        else:
            change = ChangeEvent(source=source, record_ref=node_id, before=None,
                                 after={"effect_score": effect_score}, at=now,
                                 sensitivity=Sensitivity.INTERNAL)
        eng.on_data_change(node_id, change)
        return {"changed": eng.fire_node(node_id)}

    @app.websocket("/ws")
    async def ws(socket: WebSocket):
        await socket.accept()
        app.state.sockets.append(socket)
        try:
            while True:
                await socket.receive_text()
        except WebSocketDisconnect:
            app.state.sockets.remove(socket)

    return app
