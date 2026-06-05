from __future__ import annotations
from datetime import datetime, timezone
from .models import Node, Assessment
from .graph_store import GraphStore
from .rules import score_node, RULE_VERSION
from .sensitivity import combine_sensitivity, declassify


def _now(): return datetime.now(timezone.utc)


def assess(node: Node, store: GraphStore, llm, vector, triggered_by: dict) -> Assessment:
    child_ids = store.children(node.id)
    dep_ids = store.dependencies(node.id)
    children = [store.get_node(c).current for c in child_ids if store.get_node(c).current]
    deps = [store.get_node(d).current for d in dep_ids if store.get_node(d).current]

    rule = score_node(node, children, deps)
    grounding = vector.query(node.title, k=2)
    verdict = llm.verify_score(node=node, rule_score=rule.score, rule_inputs=rule.inputs, grounding=grounding)

    base = combine_sensitivity([a.sensitivity for a in (children + deps)], node)
    sensitivity = declassify(base, contributors=len(children) + len(deps))

    prev = node.current.llm_verdict.final_score if node.current else 0.0
    version = (node.current.version + 1) if node.current else 1
    upstream = {i: store.get_node(i).current.version
                for i in (child_ids + dep_ids) if store.get_node(i).current}

    a = Assessment(node_id=node.id, version=version, computed_at=_now(),
                   rule_score=rule.score, rule_inputs=rule.inputs, rule_version=RULE_VERSION,
                   llm_verdict=verdict, grounding=grounding, upstream_versions=upstream,
                   triggered_by=triggered_by, delta=abs(verdict.final_score - prev),
                   sensitivity=sensitivity, change=node.pending_change)
    node.current = a
    node.history.append(version)
    return a
