from datetime import datetime, timezone
from foursight.models import ChangeEvent, Sensitivity, TriggerType
from foursight.propagation import Engine, EPSILON


def _noop(node, store, llm):
    return None


def _change(score):
    return ChangeEvent(source="t", record_ref="r", after={"effect_score": score},
                       at=datetime.now(timezone.utc), sensitivity=Sensitivity.INTERNAL)


def test_propagates_to_root_once(diamond_store, llm, vector):
    eng = Engine(diamond_store, llm, vector, _noop)
    eng.on_data_change("leaf", _change(90))
    changed = eng.fire_node("leaf")
    assert "root" in changed and changed.count("root") == 1
    assert diamond_store.get_node("root").current.llm_verdict.final_score == 90.0


def test_small_change_stops_early(diamond_store, llm, vector):
    eng = Engine(diamond_store, llm, vector, _noop)
    eng.on_data_change("leaf", _change(0))
    eng.fire_node("leaf")
    eng.on_data_change("leaf", _change(EPSILON - 1))
    changed = eng.fire_node("leaf")
    assert "leaf" in changed and "root" not in changed
