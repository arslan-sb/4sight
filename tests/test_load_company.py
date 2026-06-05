from datetime import datetime, timezone
from foursight.seed import load_company
from foursight.models import Viewer, Role, ChangeEvent, Sensitivity
from foursight.reports import get_report


def test_load_company_declassifies_budget_but_hides_comp():
    store, eng, _ = load_company()
    assert store.get_node("root").report is not None
    # drive a confidential comp change and recrawl
    eng.on_data_change("comp_pool", ChangeEvent(source="Payroll (redacted)", record_ref="comp_pool",
        after={"effect_score": 60.0}, at=datetime.now(timezone.utc), sensitivity=Sensitivity.INTERNAL))
    eng.fire_node("comp_pool")
    reviewer = Viewer(id="u", role=Role.REVIEWER)
    # budget aggregates 3 contributors -> CONFIDENTIAL declassifies to INTERNAL -> visible
    budget = get_report("personnel_budget", store, reviewer)
    assert budget is not None and not budget.overall.startswith("Confidential")
    # the comp pool leaf itself stays CONFIDENTIAL -> redacted for a reviewer
    comp = get_report("comp_pool", store, reviewer)
    assert comp.overall.startswith("Confidential")
