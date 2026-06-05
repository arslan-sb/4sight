from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass
from ..models import ChangeEvent, Sensitivity


@dataclass
class LeafPayload:
    target_node: str
    raw: dict
    change: ChangeEvent


class AuthStrategy(ABC):
    @abstractmethod
    def headers(self) -> dict: ...


class NoAuth(AuthStrategy):
    def headers(self) -> dict:
        return {}


class ApiKeyAuth(AuthStrategy):
    def __init__(self, key: str) -> None:
        self.key = key

    def headers(self) -> dict:
        return {"Authorization": f"Bearer {self.key}"}


class SourceAdapter(ABC):
    target_node: str
    min_disclosure: Sensitivity = Sensitivity.INTERNAL

    @abstractmethod
    def fetch(self) -> list[LeafPayload]:
        ...
