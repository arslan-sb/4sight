from __future__ import annotations
import csv
from datetime import datetime, timezone
from ..models import ChangeEvent, Sensitivity
from .base import SourceAdapter, LeafPayload


def _coerce(v: str):
    low = v.strip().lower()
    if low in ("true", "false"):
        return low == "true"
    try:
        return float(v)
    except ValueError:
        return v


class CsvLeaveAdapter(SourceAdapter):
    min_disclosure = Sensitivity.INTERNAL

    def __init__(self, path: str) -> None:
        self.path = path

    def fetch(self) -> list[LeafPayload]:
        out = []
        with open(self.path, newline="") as f:
            for row in csv.DictReader(f):
                target = row.pop("target_node")
                raw = {k: _coerce(v) for k, v in row.items()}
                out.append(
                    LeafPayload(
                        target_node=target,
                        raw=raw,
                        change=ChangeEvent(
                            source="Leave Calendar",
                            record_ref=target,
                            before=None,
                            after=raw,
                            at=datetime.now(timezone.utc),
                            sensitivity=Sensitivity.INTERNAL,
                        ),
                    )
                )
        return out
