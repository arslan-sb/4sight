from foursight.assess import assess
from foursight.models import TriggerType


def test_leaf_provenance(diamond_store, llm, vector):
    leaf = diamond_store.get_node("leaf")
    leaf.raw = {"capacity_drop_pct": 40, "single_owner": True}
    a = assess(leaf, diamond_store, llm, vector, {"trigger": TriggerType.NODE_FIRED.value})
    assert a.rule_score == 70.0 and a.llm_verdict.final_score >= 85.0
    assert a.version == 1 and leaf.current is a


def test_task_rollup(diamond_store, llm, vector):
    leaf = diamond_store.get_node("leaf"); leaf.raw = {"capacity_drop_pct": 90}
    assess(leaf, diamond_store, llm, vector, {})
    a = assess(diamond_store.get_node("a"), diamond_store, llm, vector, {})
    assert a.llm_verdict.final_score == 90.0 and a.upstream_versions == {"leaf": 1}
