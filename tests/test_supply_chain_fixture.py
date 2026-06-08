from foursight.supply_chain_fixture import parse_supply_chain
from foursight.models import EdgeType


def test_fixture_has_required_structures():
    spec = parse_supply_chain()
    parents, children, has_dep, has_conf = {}, {}, False, False
    for src, dst, etype in spec.edges:
        if etype == EdgeType.DECOMPOSITION:
            parents[dst] = parents.get(dst, 0) + 1
            children[src] = children.get(src, 0) + 1
        else:
            has_dep = True
    for n in spec.nodes:
        if n.data_binding and n.data_binding.sensitivity.value == "confidential":
            has_conf = True
    assert any(c >= 2 for c in parents.values())
    assert has_dep
    assert any(c >= 3 for c in children.values())
    assert has_conf
    assert spec.policy_docs
    assert len(spec.nodes) >= 19
    assert len(spec.edges) >= 23
