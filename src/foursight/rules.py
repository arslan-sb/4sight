from __future__ import annotations
from dataclasses import dataclass, field
from .models import Node, NodeKind, Assessment

RULE_VERSION = "ops-risk-v1"


@dataclass
class RuleResult:
    score: float
    inputs: dict = field(default_factory=dict)


def score_node(node: Node, children: list[Assessment], deps: list[Assessment]) -> RuleResult:
    if node.kind == NodeKind.LEAF:
        raw = node.raw or {}
        inputs: dict = {}
        score = 0.0
        cd = float(raw.get("capacity_drop_pct", 0))
        inputs["capacity_drop_pct"] = cd
        score += cd
        if raw.get("single_owner"):
            inputs["single_owner"] = True
            score += 30.0
        age = float(raw.get("data_age_h", 0))
        inputs["data_age_h"] = age
        if age > 120:
            score += 10.0
        eff = float(raw.get("effect_score", 0))
        if eff:
            inputs["effect_score"] = eff
            score = max(score, eff)
        return RuleResult(min(score, 100.0), inputs)
    contrib = [a.llm_verdict.final_score for a in (children + deps)]
    score = max(contrib) if contrib else 0.0
    return RuleResult(score, {"contributors": len(contrib), "max": score})
