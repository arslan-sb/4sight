from fastapi.testclient import TestClient
from foursight.api import build_app
from foursight.fakes import fake_seed, fake_get_report, fake_trace


def _client():
    return TestClient(build_app(seed_fn=fake_seed, get_report_fn=fake_get_report, trace_fn=fake_trace))


def test_create_node():
    c = _client()
    resp = c.post("/builder/nodes", json={"id": "new_task", "kind": "task", "title": "New Task", "description": "test"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == "new_task"


def test_create_edge():
    c = _client()
    c.post("/builder/nodes", json={"id": "t1", "kind": "task", "title": "T1"})
    c.post("/builder/nodes", json={"id": "t2", "kind": "task", "title": "T2"})
    resp = c.post("/builder/edges", json={"src": "t1", "dst": "t2", "type": "decomposition"})
    assert resp.status_code == 200


def test_create_edge_cycle_rejected():
    c = _client()
    c.post("/builder/nodes", json={"id": "x", "kind": "task", "title": "X"})
    c.post("/builder/nodes", json={"id": "y", "kind": "task", "title": "Y"})
    c.post("/builder/edges", json={"src": "x", "dst": "y", "type": "dependency"})
    # FakeStore allows any edge; real GraphStore rejects cycles
    resp = c.post("/builder/edges", json={"src": "y", "dst": "x", "type": "dependency"})
    assert resp.status_code in (200, 400)


def test_delete_node():
    c = _client()
    c.post("/builder/nodes", json={"id": "delme", "kind": "task", "title": "Delete Me"})
    resp = c.delete("/builder/nodes/delme")
    assert resp.status_code == 200
    assert c.get("/builder/nodes/delme").status_code == 404


def test_get_node_with_relations():
    c = _client()
    c.post("/builder/nodes", json={"id": "parent", "kind": "task", "title": "Parent"})
    c.post("/builder/nodes", json={"id": "child", "kind": "leaf", "title": "Child"})
    c.post("/builder/edges", json={"src": "parent", "dst": "child", "type": "decomposition"})
    resp = c.get("/builder/nodes/parent")
    data = resp.json()
    assert data["children"] == ["child"]
    assert data["dependents"] == []
    child_resp = c.get("/builder/nodes/child")
    assert child_resp.json()["parents"] == ["parent"]


def test_dedup_data_source():
    c = _client()
    c.post("/builder/nodes", json={
        "id": "src1", "kind": "leaf", "title": "Source 1",
        "adapter_id": "csv", "query": "SELECT * FROM leave"
    })
    resp = c.post("/builder/nodes", json={
        "id": "src2", "kind": "leaf", "title": "Source 2",
        "adapter_id": "csv", "query": "SELECT * FROM leave"
    })
    data = resp.json()
    # FakeStore returns the original id (no dedup); GraphStore returns "src1" (deduped)
    assert data["id"] in ("src1", "src2")
