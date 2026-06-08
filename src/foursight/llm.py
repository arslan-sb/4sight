from __future__ import annotations
import os
from typing import Protocol
from .models import Node, LLMVerdict, Grounding, DriverBullet, severity_from_score


class LLM(Protocol):
    model: str

    def verify_score(self, node: Node, rule_score: float, rule_inputs: dict,
                     grounding: list[Grounding]) -> LLMVerdict: ...

    def generate_overall(self, node: Node, drivers: list[DriverBullet]) -> str: ...


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
        top = drivers[0].line if drivers else "no active drivers"
        return f"{node.title} is at {sev} risk. Primary driver: {top}."


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
        prompt = (f"Verify an operational-risk score (0-100) for task '{node.title}'.\n"
                  f"Rule score: {rule_score}. Inputs: {json.dumps(rule_inputs)}.\nGrounding:\n{ctx}\n"
                  'Reply JSON: {"final_score": number, "rationale": string, "adjusted": bool}.')
        resp = self._client.messages.create(
            model=self.model,
            max_tokens=2048,
            thinking={"type": "enabled", "budget_tokens": 32000},
            messages=[{"role": "user", "content": prompt}],
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
            messages=[{"role": "user", "content":
                       f"Write a 2-sentence risk summary for '{node.title}'. Drivers:\n{lines}\n"
                       "Do not invent specifics beyond the drivers."}],
        )
        return self._extract_text(resp).strip()
