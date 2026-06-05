from __future__ import annotations
from .models import Sensitivity, Node, Report, Viewer, Role, DriverBullet

ORDER = [Sensitivity.PUBLIC, Sensitivity.INTERNAL, Sensitivity.CONFIDENTIAL, Sensitivity.RESTRICTED]
ALLOWED = {Role.REVIEWER: Sensitivity.INTERNAL, Role.PRIVILEGED: Sensitivity.RESTRICTED}

def _idx(s): return ORDER.index(s)

def combine_sensitivity(levels: list[Sensitivity], node: Node) -> Sensitivity:
    cands = list(levels)
    if node.data_binding: cands.append(node.data_binding.sensitivity)
    if node.pending_change: cands.append(node.pending_change.sensitivity)
    return max(cands, key=_idx) if cands else Sensitivity.PUBLIC

def declassify(level: Sensitivity, contributors: int, min_contributors: int = 3) -> Sensitivity:
    if contributors >= min_contributors and _idx(level) > 0:
        return ORDER[_idx(level) - 1]
    return level

def can_view(viewer: Viewer, sensitivity: Sensitivity) -> bool:
    return _idx(sensitivity) <= _idx(ALLOWED[viewer.role])

def project_report(report: Report, viewer: Viewer) -> Report:
    if can_view(viewer, report.disclosure):
        return report
    return report.model_copy(update={
        "overall": "Confidential change affecting this area. Effect shown; source restricted.",
        "drivers": [DriverBullet(node_id="", severity=report.severity, line="[restricted] source hidden")],
        "watch_items": [], "grounding": []})
