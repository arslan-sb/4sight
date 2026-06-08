from fastapi.testclient import TestClient
from foursight.api import build_app
from foursight.fakes import fake_seed, fake_get_report, fake_trace

def _client():
    return TestClient(build_app(seed_fn=fake_seed, get_report_fn=fake_get_report, trace_fn=fake_trace))

def test_simulate_raises_root_and_traces():
    c = _client()
    before = c.get("/report/root", params={"role": "reviewer"}).json()
    assert c.post("/simulate-change", json={"kind": "leave"}).status_code == 200
    after = c.get("/report/root", params={"role": "reviewer"}).json()
    order = ["low", "medium", "high", "critical"]
    assert order.index(after["severity"]) > order.index(before["severity"])
    assert c.get("/trace/root").json()["origin"]["source"] == "Leave Calendar"

def test_report_returns_json_shape():
    rep = _client().get("/report/root", params={"role": "reviewer"}).json()
    assert set(["node_id", "severity", "overall", "drivers"]).issubset(rep.keys())
