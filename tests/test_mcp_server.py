from __future__ import annotations
import asyncio
from fastmcp import Client
from foursight.mcp_server import build_fake, build_real


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


def test_all_tools_discoverable():
    names = set(list_tool_names(build_fake()))
    assert {"list_nodes", "get_node_report", "trace_risk",
            "get_neighbors", "simulate_change"} <= names


def test_list_nodes_fields():
    rows = call(build_fake(), "list_nodes").data
    assert isinstance(rows, list) and rows
    for row in rows:
        assert set(row) == {"id", "title", "kind", "severity", "score"}
        assert isinstance(row["id"], str)
        assert row["kind"] in ("task", "leaf")
    ids = {r["id"] for r in rows}
    assert {"root", "comp_pool"} <= ids


def test_leave_act():
    mcp = build_real()
    changed = call(mcp, "simulate_change",
                   {"node_id": "alice_owner", "effect_score": 90,
                    "source": "Leave Calendar"}).data["changed"]
    assert "root" in changed

    trace = call(mcp, "trace_risk", {"node_id": "root"}).data
    assert trace["path"][-1] == "alice_owner"
    assert trace["origin"] is not None
    assert trace["origin"]["source"] == "Leave Calendar"


def test_sensitivity_act():
    mcp = build_real()
    call(mcp, "simulate_change", {"node_id": "comp_pool", "effect_score": 60})

    # Three contributors declassify the personnel budget rollup: not redacted.
    pb = call(mcp, "get_node_report",
              {"node_id": "personnel_budget", "role": "reviewer"}).data
    assert pb is not None
    assert not pb["overall"].startswith("Confidential")

    # The confidential leaf itself is redacted for a reviewer.
    cp = call(mcp, "get_node_report",
              {"node_id": "comp_pool", "role": "reviewer"}).data
    assert cp["overall"].startswith("Confidential")

    # A privileged viewer sees the full, unredacted report.
    cpp = call(mcp, "get_node_report",
               {"node_id": "comp_pool", "role": "privileged"}).data
    assert not cpp["overall"].startswith("Confidential")


def test_unknown_node_does_not_raise():
    result = call(build_real(), "get_node_report",
                  {"node_id": "nonexistent_node", "role": "reviewer"})
    assert result.data is None
