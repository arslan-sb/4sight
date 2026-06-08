from foursight.triggers import TriggerEngine
from foursight.graph_store import GraphStore
from foursight.models import Node, NodeKind, EdgeType


def _build_chain():
    s = GraphStore()
    for nid, kind in [("root", NodeKind.TASK), ("mid", NodeKind.TASK), ("leaf", NodeKind.LEAF)]:
        s.add_node(Node(id=nid, kind=kind, title=nid, trigger_threshold=25.0))
    s.add_edge("root", "mid", EdgeType.DECOMPOSITION)
    s.add_edge("mid", "leaf", EdgeType.DECOMPOSITION)
    return s


def test_accumulator_below_threshold_does_not_fire():
    store = _build_chain()
    leaf = store.get_node("leaf")
    leaf.delta_accumulator = 10.0
    eng = TriggerEngine(store)
    fired = eng.check_and_fire()
    assert "leaf" not in fired


def test_accumulator_at_threshold_fires():
    store = _build_chain()
    leaf = store.get_node("leaf")
    leaf.delta_accumulator = 30.0
    eng = TriggerEngine(store)
    fired = eng.check_and_fire()
    assert "leaf" in fired
    assert leaf.delta_accumulator == 0.0


def test_accumulate_delta_adds_to_existing():
    store = _build_chain()
    leaf = store.get_node("leaf")
    eng = TriggerEngine(store)
    eng.accumulate("leaf", 15.0)
    assert leaf.delta_accumulator == 15.0
    eng.accumulate("leaf", 12.0)
    assert leaf.delta_accumulator == 27.0
    fired = eng.check_and_fire()
    assert "leaf" in fired
