from __future__ import annotations
import os
from typing import Protocol
from .models import Node, LLMVerdict, Grounding, DriverBullet, severity_from_score


class LLM(Protocol):
    model: str

    def verify_score(self, node: Node, rule_score: float, rule_inputs: dict,
                     grounding: list[Grounding]) -> LLMVerdict: ...

    def generate_overall(self, node: Node, drivers: list[DriverBullet]) -> str: ...

    def batch_assess(self, system: str, prompt: str) -> str: ...


class FakeLLM:
    model = "fake"

    def verify_score(self, node, rule_score, rule_inputs, grounding) -> LLMVerdict:
        score, adjusted = rule_score, False
        rationale = f"Rule score {rule_score:.0f} for {node.title}."
        if rule_inputs.get("single_owner"):
            score, adjusted = max(score, 85.0), True
            rationale = "Single-owner dependency raises severity. " + rationale
        return LLMVerdict(final_score=score, severity=severity_from_score(score),
                          rationale=rationale, adjusted=adjusted, model=self.model)

    def generate_overall(self, node, drivers) -> str:
        sev = node.current.llm_verdict.severity.value if node.current else "unknown"
        if not drivers:
            return f"{node.title} is at {sev} risk."
        first = drivers[0]
        if first.node_id == node.id:
            return f"{node.title} is at {sev} risk. {first.line}."
        return f"{node.title} is at {sev} risk. Primary driver: {first.line}."

    def batch_assess(self, system: str, prompt: str) -> str:
        import json, re
        ids = re.findall(r'id=(\S+)\)', prompt)
        results = []
        for nid in ids:
            results.append({"node_id": nid, "final_score": 20.0, "severity": "low",
                           "rationale": "batch fake", "summary": f"Fake summary for {nid}"})
        return json.dumps(results) if results else json.dumps([{"node_id": "root", "final_score": 20.0, "severity": "low", "rationale": "batch fake", "summary": "Fake"}])


class DeepSeekLLM:
    model = "deepseek-v4-flash"

    def __init__(self) -> None:
        from anthropic import Anthropic
        self._client = Anthropic(api_key=os.environ["DEEPSEEK_API_KEY"],
                                 base_url="https://api.deepseek.com/anthropic")

    def _extract_text(self, response) -> str:
        text = ""
        for block in response.content:
            if block.type == "text":
                text += block.text
        return text

    def verify_score(self, node, rule_score, rule_inputs, grounding) -> LLMVerdict:
        import json
        ctx = "\n".join(f"- {g.doc}" for g in grounding) or "none"
        resp = self._client.messages.create(
            model=self.model,
            max_tokens=2048,
            thinking={"type": "enabled", "budget_tokens": 32000},
            system=(
                "You are an operational risk assessor for a semiconductor supply chain. "
                "Your job is to verify or adjust a rule-based risk score (0-100) using "
                "qualitative context from policy documents and domain knowledge.\n\n"
                "Scoring framework:\n"
                "- 0-24: LOW risk. Normal operations. Minor fluctuations.\n"
                "- 25-49: MEDIUM risk. Notable disruption in one area. Monitor closely.\n"
                "- 50-74: HIGH risk. Significant disruption affecting multiple dependencies. "
                "Escalate to leadership.\n"
                "- 75-100: CRITICAL risk. Severe, cascading failure across the supply chain. "
                "Immediate action required.\n\n"
                "Adjustment rules:\n"
                "- Single-owner dependencies (no backup): raise score significantly, "
                "especially if the owner is unavailable.\n"
                "- Capacity drops exceeding 30% on a sole source: escalate to HIGH or CRITICAL.\n"
                "- Fuel or logistics volatility: factor into dependent freight lanes.\n"
                "- Yield rate degradation: assess impact on downstream fabs.\n"
                "- Redundancy (multiple suppliers or buffer stock) mitigates risk: "
                "reduce score when alternatives exist.\n"
                "- Cross-branch dependencies amplify impact: a problem in one area "
                "can cascade through dependency edges.\n\n"
                "Your rationale must reference specific risk factors from the rule inputs, "
                "explain why you adjusted or kept the score, and note any mitigating "
                "or amplifying factors. Be concise but thorough."
            ),
            messages=[{"role": "user", "content": (
                f"Task: '{node.title}'\n"
                f"Rule score: {rule_score}\n"
                f"Inputs: {json.dumps(rule_inputs)}\n"
                f"Relevant policies:\n{ctx}\n\n"
                'Reply with JSON only: {"final_score": <number 0-100>, '
                '"rationale": "<your reasoning>", "adjusted": <true|false>}'
            )}],
        )
        raw = self._extract_text(resp)
        data = json.loads(raw)
        score = float(data["final_score"])
        return LLMVerdict(final_score=score, severity=severity_from_score(score),
                          rationale=data.get("rationale", ""),
                          adjusted=bool(data.get("adjusted", False)),
                          model=self.model, raw_response=raw)

    def generate_overall(self, node, drivers) -> str:
        lines = "\n".join(f"- {d.line}" for d in drivers) or "none"
        resp = self._client.messages.create(
            model=self.model,
            max_tokens=512,
            thinking={"type": "enabled", "budget_tokens": 10000},
            system=(
                "You are a risk report writer for a semiconductor supply chain. "
                "Your audience is operations leadership. Write concise, factual summaries "
                "grounded in the driver bullets provided. Never invent specifics, names, "
                "or metrics beyond what the drivers contain. Use precise operational "
                "language. If drivers mention personnel issues, note the impact on "
                "coverage. If drivers mention supplier or logistics issues, note the "
                "supply chain implications. Keep to 2-3 sentences."
            ),
            messages=[{"role": "user", "content": (
                f"Write a risk summary for '{node.title}'. Top drivers:\n{lines}"
            )}],
        )
        return self._extract_text(resp).strip()

    def batch_assess(self, system: str, prompt: str) -> str:
        resp = self._client.messages.create(
            model=self.model,
            max_tokens=4096,
            thinking={"type": "enabled", "budget_tokens": 8000},
            system=system,
            messages=[{"role": "user", "content": prompt}],
        )
        return self._extract_text(resp)
