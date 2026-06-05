from foursight.models import (
    Node, NodeKind, Edge, EdgeType, Severity, Sensitivity,
    severity_from_score, Viewer, Role,
)


def test_severity_thresholds():
    assert severity_from_score(10) == Severity.LOW
    assert severity_from_score(40) == Severity.MEDIUM
    assert severity_from_score(70) == Severity.HIGH
    assert severity_from_score(90) == Severity.CRITICAL


def test_node_defaults():
    n = Node(id="t1", kind=NodeKind.TASK, title="Task 1")
    assert n.current is None and n.history == [] and n.pending_change is None


def test_viewer_defaults():
    assert Viewer(id="u1", role=Role.REVIEWER).clearances == set()
