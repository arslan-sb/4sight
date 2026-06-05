from datetime import datetime, timezone
from foursight.models import Node, NodeKind, Assessment, LLMVerdict, Severity
from foursight.rules import score_node, RULE_VERSION


def _assessed(nid, score):
    return Assessment(node_id=nid, version=1, computed_at=datetime.now(timezone.utc),
                      rule_score=score, rule_version=RULE_VERSION,
                      llm_verdict=LLMVerdict(final_score=score, severity=Severity.HIGH, rationale="x"))


def test_leaf_single_owner_and_capacity():
    leaf = Node(id="l", kind=NodeKind.LEAF, title="leaf",
                raw={"capacity_drop_pct": 40, "single_owner": True, "data_age_h": 10})
    r = score_node(leaf, [], [])
    assert r.score == 70.0 and r.inputs["single_owner"] is True


def test_task_aggregates_max():
    r = score_node(Node(id="t", kind=NodeKind.TASK, title="t"),
                   [_assessed("c1", 30), _assessed("c2", 80)], [])
    assert r.score == 80.0 and r.inputs["contributors"] == 2
