from foursight.seed import build_seed


def test_seed_dag_and_baseline():
    store, eng, _ = build_seed()
    # Diamond: platform_team has two parents (customer_portal, payments)
    assert any(len(store.parents(nid)) >= 2 for nid in store.all_ids())
    # Cross-branch dependency: alice_owner -> payments_team
    assert any(store.dependencies(nid) for nid in store.all_ids())
    eng.run_full()
    assert store.get_node("root").report is not None
