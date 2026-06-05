from datetime import datetime, timezone

from foursight.models import ChangeEvent, Sensitivity
from foursight.propagation import Engine
from foursight.reports import generate_report, trace_to_source


def _change(score):
    return ChangeEvent(source="Leave Calendar", record_ref="alice", after={"effect_score": score},
                       at=datetime.now(timezone.utc), sensitivity=Sensitivity.INTERNAL)


def test_report_drivers_and_trace(diamond_store, llm, vector):
    eng = Engine(diamond_store, llm, vector, generate_report)
    eng.on_data_change("leaf", _change(90))
    eng.fire_node("leaf")
    root = diamond_store.get_node("root")
    assert root.report is not None and root.report.severity.value == "critical"
    assert any(d.node_id in ("a", "b") for d in root.report.drivers)
    trace = trace_to_source("root", diamond_store)
    assert trace["path"][0] == "root" and trace["path"][-1] == "leaf"
    assert trace["origin"].source == "Leave Calendar"
