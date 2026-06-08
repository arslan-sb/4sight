from fastapi.testclient import TestClient
from foursight.api import build_app


def test_real_core_leave_demo():
    client = TestClient(build_app())
    before = client.get("/report/root", params={"role": "reviewer"}).json()
    client.post("/simulate-change", json={"kind": "leave"})
    after = client.get("/report/root", params={"role": "reviewer"}).json()
    order = ["low", "medium", "high", "critical"]
    assert order.index(after["severity"]) >= order.index(before["severity"])
    assert after["severity"] in ("high", "critical")
    assert client.get("/trace/root").json()["origin"]["source"] == "Leave Calendar"


def test_real_core_salary_effect_only_for_reviewer():
    client = TestClient(build_app())
    client.post("/simulate-change", json={"kind": "salary"})
    rep = client.get("/report/personnel_budget", params={"role": "reviewer"}).json()
    assert rep is not None and "salary" not in rep["overall"].lower()
