from __future__ import annotations
from datetime import datetime, timezone
from ..models import ChangeEvent, Sensitivity
from .base import SourceAdapter, LeafPayload


class PayrollRedactedAdapter(SourceAdapter):
    min_disclosure = Sensitivity.INTERNAL

    def __init__(self, target_node: str) -> None:
        self.target_node = target_node

    def fetch(self) -> list[LeafPayload]:
        return []

    def emit_comp_delta(self, amount: float) -> LeafPayload:
        effect = min(amount / 500.0, 100.0)
        raw = {"effect_score": effect, "category": "compensation"}
        return LeafPayload(
            target_node=self.target_node,
            raw=raw,
            change=ChangeEvent(
                source="Payroll (redacted)",
                record_ref="comp_pool",
                before=None,
                after=raw,
                at=datetime.now(timezone.utc),
                sensitivity=Sensitivity.INTERNAL,
            ),
        )
