from __future__ import annotations
from datetime import datetime
from enum import Enum
from typing import Any, Optional
from pydantic import BaseModel, Field


class NodeKind(str, Enum):
    TASK = "task"
    LEAF = "leaf"


class EdgeType(str, Enum):
    DECOMPOSITION = "decomposition"
    DEPENDENCY = "dependency"


class Severity(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class Sensitivity(str, Enum):
    PUBLIC = "public"
    INTERNAL = "internal"
    CONFIDENTIAL = "confidential"
    RESTRICTED = "restricted"


class TriggerType(str, Enum):
    TIMEOUT = "timeout"
    CUMULATIVE = "cumulative"
    NODE_FIRED = "node_fired"


class Role(str, Enum):
    REVIEWER = "reviewer"
    PRIVILEGED = "privileged"


def severity_from_score(score: float) -> Severity:
    if score < 25:
        return Severity.LOW
    if score < 50:
        return Severity.MEDIUM
    if score < 75:
        return Severity.HIGH
    return Severity.CRITICAL


class DataBinding(BaseModel):
    adapter_id: str
    query: str = ""
    sensitivity: Sensitivity = Sensitivity.INTERNAL
    min_disclosure: Sensitivity = Sensitivity.INTERNAL


class ChangeEvent(BaseModel):
    source: str
    record_ref: str
    before: Any = None
    after: Any = None
    at: datetime
    sensitivity: Sensitivity = Sensitivity.INTERNAL


class Grounding(BaseModel):
    doc: str
    chunk: int = 0
    score: float = 0.0


class LLMVerdict(BaseModel):
    final_score: float
    severity: Severity
    rationale: str
    adjusted: bool = False
    model: str = "fake"
    raw_response: str = ""


class Assessment(BaseModel):
    node_id: str
    version: int
    computed_at: datetime
    rule_score: float
    rule_inputs: dict = Field(default_factory=dict)
    rule_version: str
    llm_verdict: LLMVerdict
    grounding: list[Grounding] = Field(default_factory=list)
    upstream_versions: dict[str, int] = Field(default_factory=dict)
    triggered_by: dict = Field(default_factory=dict)
    delta: float = 0.0
    sensitivity: Sensitivity = Sensitivity.INTERNAL
    change: Optional[ChangeEvent] = None


class DriverBullet(BaseModel):
    node_id: str
    severity: Severity
    line: str


class Report(BaseModel):
    node_id: str
    version: int
    generated_at: datetime
    severity: Severity
    overall: str
    drivers: list[DriverBullet] = Field(default_factory=list)
    changed_since: list[str] = Field(default_factory=list)
    watch_items: list[str] = Field(default_factory=list)
    grounding: list[Grounding] = Field(default_factory=list)
    disclosure: Sensitivity = Sensitivity.INTERNAL


class Node(BaseModel):
    id: str
    kind: NodeKind
    title: str
    data_binding: Optional[DataBinding] = None
    current: Optional[Assessment] = None
    history: list[int] = Field(default_factory=list)
    report: Optional[Report] = None
    raw: Any = None
    pending_change: Optional[ChangeEvent] = None
    pending_delta: float = 0.0
    description: str = ""
    trigger_threshold: float = 25.0
    delta_accumulator: float = 0.0


class Edge(BaseModel):
    src: str
    dst: str
    type: EdgeType


class Viewer(BaseModel):
    id: str
    role: Role
    clearances: set[str] = Field(default_factory=set)


class CrawlJob(BaseModel):
    id: str
    trigger: TriggerType
    scope: list[str]
    reason: str = ""
    priority: int = 0
