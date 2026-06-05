from datetime import datetime, timezone
from foursight.models import (
    Sensitivity, Node, NodeKind, Report, Severity, Viewer, Role, DriverBullet
)
from foursight.sensitivity import combine_sensitivity, declassify, can_view, project_report


def test_combine_and_declassify():
    node = Node(id="n", kind=NodeKind.TASK, title="n")
    assert combine_sensitivity([Sensitivity.PUBLIC, Sensitivity.CONFIDENTIAL], node) == Sensitivity.CONFIDENTIAL
    assert declassify(Sensitivity.CONFIDENTIAL, 3) == Sensitivity.INTERNAL
    assert declassify(Sensitivity.CONFIDENTIAL, 1) == Sensitivity.CONFIDENTIAL


def test_projection():
    rep = Report(node_id="n", version=1, generated_at=datetime.now(timezone.utc),
                 severity=Severity.HIGH, overall="raw secret",
                 drivers=[DriverBullet(node_id="x", severity=Severity.HIGH, line="secret")],
                 disclosure=Sensitivity.RESTRICTED)
    assert not can_view(Viewer(id="u", role=Role.REVIEWER), Sensitivity.RESTRICTED)
    out = project_report(rep, Viewer(id="u", role=Role.REVIEWER))
    assert "secret" not in out.overall and out.drivers[0].line.startswith("[restricted]")
    assert project_report(rep, Viewer(id="a", role=Role.PRIVILEGED)).overall == "raw secret"
