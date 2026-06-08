from foursight.models import DataBinding, Sensitivity
from foursight.graph_store import content_hash


def test_content_hash_same_query_same_hash():
    b1 = DataBinding(adapter_id="csv", query="SELECT * FROM leave", sensitivity=Sensitivity.INTERNAL)
    b2 = DataBinding(adapter_id="csv", query="SELECT * FROM leave", sensitivity=Sensitivity.INTERNAL)
    assert content_hash(b1) == content_hash(b2)


def test_content_hash_diff_query_diff_hash():
    b1 = DataBinding(adapter_id="csv", query="SELECT * FROM leave", sensitivity=Sensitivity.INTERNAL)
    b2 = DataBinding(adapter_id="csv", query="SELECT * FROM salary", sensitivity=Sensitivity.INTERNAL)
    assert content_hash(b1) != content_hash(b2)


def test_content_hash_normalized():
    b1 = DataBinding(adapter_id="csv", query="  SELECT * FROM leave  ", sensitivity=Sensitivity.INTERNAL)
    b2 = DataBinding(adapter_id="csv", query="select * from leave", sensitivity=Sensitivity.INTERNAL)
    assert content_hash(b1) == content_hash(b2)
