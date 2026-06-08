import asyncio
from fastmcp import Client
from foursight.fakes import FakeStore, FakeEngine, fake_get_report, fake_trace
from foursight.flatten import FlattenEngine
from foursight.llm import FakeLLM


def call(mcp, tool, args=None):
    async def _go():
        async with Client(mcp) as c:
            return await c.call_tool(tool, args or {})
    return asyncio.run(_go())


def list_tool_names(mcp):
    async def _go():
        async with Client(mcp) as c:
            return [t.name for t in await c.list_tools()]
    return asyncio.run(_go())


def test_batch_assess_discoverable():
    from foursight.mcp_server import build_mcp
    store = FakeStore()
    eng = FakeEngine(store)
    flatten = FlattenEngine(store)
    llm = FakeLLM()
    mcp = build_mcp(store, eng, fake_get_report, fake_trace,
                    flatten=flatten, llm=llm)
    tools = list_tool_names(mcp)
    assert "batch_assess" in tools


def test_batch_assess_returns_list():
    from foursight.mcp_server import build_mcp
    store = FakeStore()
    eng = FakeEngine(store)
    flatten = FlattenEngine(store)
    llm = FakeLLM()
    mcp = build_mcp(store, eng, fake_get_report, fake_trace,
                    flatten=flatten, llm=llm)
    result = call(mcp, "batch_assess", {"mode": "full"})
    assert isinstance(result.data, list)


def test_batch_assess_clears_accumulators():
    from foursight.mcp_server import build_mcp
    from foursight.models import Node, NodeKind
    store = FakeStore()
    store.add_node(Node(id="test", kind=NodeKind.TASK, title="Test",
                        delta_accumulator=60.0))
    eng = FakeEngine(store)
    flatten = FlattenEngine(store)
    llm = FakeLLM()
    mcp = build_mcp(store, eng, fake_get_report, fake_trace,
                    flatten=flatten, llm=llm)
    call(mcp, "batch_assess", {"mode": "full"})
    assert store.get_node("test").delta_accumulator == 0.0
