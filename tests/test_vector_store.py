from foursight.vector_store import FakeVector, ChromaVectorStore


def test_fake_empty():
    assert FakeVector().query("x", k=3) == []


def test_chroma_add_query():
    v = ChromaVectorStore(collection="test")
    v.add("bcp", "Business continuity requires a documented backup owner per service.")
    v.add("leave", "Leave overlapping a release freeze must be escalated.")
    res = v.query("backup owner for a service", k=1)
    assert len(res) == 1 and res[0].doc == "bcp"
