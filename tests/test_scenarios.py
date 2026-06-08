from fastapi.testclient import TestClient
from foursight.api import build_app
from foursight.seed import load_company


def _client():
    return TestClient(build_app(seed_fn=load_company))


def test_leave_act_raises_root_and_traces():
    c = _client()
    before = c.get("/report/root", params={"role": "reviewer"}).json()
    c.post("/simulate-change", json={"kind": "leave"})
    after = c.get("/report/root", params={"role": "reviewer"}).json()
    order = ["low", "medium", "high", "critical"]
    assert order.index(after["severity"]) > order.index(before["severity"])
    assert "Personnel" in c.get("/trace/root").json()["origin"]["source"]


def test_salary_act_effect_visible_source_hidden():
    c = _client()
    c.post("/simulate-change", json={"kind": "salary"})
    budget = c.get("/report/personnel_budget", params={"role": "reviewer"}).json()
    assert budget is not None and not budget["overall"].startswith("Confidential")
    comp = c.get("/report/comp_pool", params={"role": "reviewer"}).json()
    assert comp["overall"].startswith("Confidential")
    comp_priv = c.get("/report/comp_pool", params={"role": "privileged"}).json()
    assert not comp_priv["overall"].startswith("Confidential")
