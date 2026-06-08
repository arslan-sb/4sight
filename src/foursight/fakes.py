from __future__ import annotations
from datetime import datetime, timezone
from .models import (Node, NodeKind, Report, DriverBullet, Severity, Sensitivity,
                     ChangeEvent, Viewer, Role)


def _now():
    return datetime.now(timezone.utc)


def _report(node_id, severity, overall, drivers, disclosure=Sensitivity.INTERNAL):
    return Report(node_id=node_id, version=1, generated_at=_now(), severity=severity,
                  overall=overall,
                  drivers=[DriverBullet(node_id=i, severity=s, line=l) for (i, s, l) in drivers],
                  disclosure=disclosure)


class FakeStore:
    def __init__(self):
        self._children = {"root": ["customer_portal", "payments", "personnel_budget"],
                          "payments": ["platform_team"],
                          "personnel_budget": ["comp_pool"]}
        self.nodes = {nid: Node(id=nid, kind=NodeKind.TASK, title=nid)
                      for nid in ["root", "customer_portal", "payments", "platform_team",
                                  "personnel_budget", "comp_pool"]}
        self._reports = {
            "root": _report("root", Severity.MEDIUM, "Baseline operational risk.",
                            [("payments", Severity.MEDIUM, "Payments Platform: medium")]),
            "comp_pool": _report("comp_pool", Severity.LOW, "Compensation pool stable.", []),
        }
        self._origin = None

    def get_node(self, nid):
        return self.nodes[nid]

    def add_node(self, node):
        self.nodes[node.id] = node

    def children(self, nid):
        return self._children.get(nid, [])

    def parents(self, nid):
        return [p for p, cs in self._children.items() if nid in cs]

    def dependencies(self, nid):
        return []

    def dependents(self, nid):
        return []

    def all_ids(self):
        return list(self.nodes.keys())

    def topo_order(self, subset):
        return sorted(subset)

    def report(self, nid):
        return self._reports.get(nid)

    def set_report(self, nid, rep):
        self._reports[nid] = rep


class FakeEngine:
    def __init__(self, store):
        self.store = store
        self.listeners = []

    def on_data_change(self, nid, change):
        self.store._origin = change

    def run_full(self, trigger=None):
        return []

    def fire_node(self, nid, trigger=None):
        self.store.set_report("root", _report("root", Severity.HIGH,
            "Risk rose to high after a change.",
            [("payments", Severity.HIGH, "Payments Platform: high")]))
        changed = ["root"]
        for listener in self.listeners:
            listener(changed)
        return changed


def fake_seed(llm=None, vector=None):
    store = FakeStore()
    return store, FakeEngine(store), {}


def fake_get_report(node_id, store, viewer):
    rep = store.report(node_id)
    if rep is None:
        return None
    if viewer.role == Role.REVIEWER and rep.disclosure in (Sensitivity.CONFIDENTIAL, Sensitivity.RESTRICTED):
        return rep.model_copy(update={
            "overall": "Confidential change affecting this area. Effect shown; source restricted.",
            "drivers": [DriverBullet(node_id="", severity=rep.severity,
                                     line="[restricted] source hidden")]})
    return rep


def fake_trace(node_id, store):
    origin = store._origin or ChangeEvent(source="Leave Calendar", record_ref="alice",
                                          after={}, at=_now(),
                                          sensitivity=Sensitivity.INTERNAL)
    return {"path": [node_id, "payments", "leaf"], "origin": origin}
