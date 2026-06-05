import pytest
from foursight.models import Node, NodeKind, EdgeType
from foursight.graph_store import GraphStore
from foursight.llm import FakeLLM
from foursight.vector_store import FakeVector


@pytest.fixture
def llm(): return FakeLLM()


@pytest.fixture
def vector(): return FakeVector()


@pytest.fixture
def diamond_store():
    s = GraphStore()
    s.add_node(Node(id="root", kind=NodeKind.TASK, title="Root"))
    s.add_node(Node(id="a", kind=NodeKind.TASK, title="A"))
    s.add_node(Node(id="b", kind=NodeKind.TASK, title="B"))
    s.add_node(Node(id="leaf", kind=NodeKind.LEAF, title="Leaf"))
    s.add_edge("root", "a", EdgeType.DECOMPOSITION)
    s.add_edge("root", "b", EdgeType.DECOMPOSITION)
    s.add_edge("a", "leaf", EdgeType.DECOMPOSITION)
    s.add_edge("b", "leaf", EdgeType.DECOMPOSITION)
    return s
