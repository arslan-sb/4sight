from foursight.fakes import fake_seed, fake_get_report, fake_trace
from foursight.models import Viewer, Role, Sensitivity


def test_fake_seed_and_fire():
    store, eng, _ = fake_seed()
    before = fake_get_report("root", store, Viewer(id="u", role=Role.REVIEWER))
    assert before.severity.value == "medium"
    eng.fire_node("anything")
    after = fake_get_report("root", store, Viewer(id="u", role=Role.REVIEWER))
    assert after.severity.value == "high"


def test_fake_redacts_confidential_for_reviewer():
    store, eng, _ = fake_seed()
    store.set_report("comp_pool", store.report("comp_pool").model_copy(
        update={"disclosure": Sensitivity.CONFIDENTIAL, "overall": "secret salary detail"}))
    out = fake_get_report("comp_pool", store, Viewer(id="u", role=Role.REVIEWER))
    assert "secret" not in out.overall
