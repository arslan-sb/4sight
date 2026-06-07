# 4sight — Claude Code working spec

## What this project is

Operational continuity risk assessment. A DAG of tasks and leaves. Data-source
changes propagate through the graph; the engine re-scores nodes and generates
risk reports. Sensitivity rules redact confidential sources by viewer role.

## Stream ownership — do not touch other streams' files

| Stream | Owner files | Hands off |
|---|---|---|
| Foundation | `models.py`, `fakes.py` | — |
| Core | `graph_store.py`, `propagation.py`, `assess.py`, `rules.py`, `reports.py`, `sensitivity.py`, `seed.py`, `vector_store.py`, `llm.py` | — |
| MCP | **`mcp_server.py`**, **`tests/test_mcp_server.py`** | everything else |
| Frontend API | `api.py` | — |
| Frontend Web | `web/` | — |

If a file you need to modify is not in your Owner column, stop and ask.

## Conventions (match exactly — no exceptions)

- `from __future__ import annotations` as the first non-comment line of every module
- All Pydantic models serialised with `.model_dump(mode="json")`
- Type hints on every function signature
- No new third-party packages — `fastmcp>=2.0` is already installed

## The seam — how the MCP server takes its dependencies

`GraphStore` and `FakeStore` share the same interface. Same for report/trace
functions and engines. Always use the injectable factory so the server is
testable with fakes and runnable with the real components.

**Store methods available on both `GraphStore` and `FakeStore`:**
`get_node(id)`, `children(id)`, `parents(id)`, `dependencies(id)`,
`dependents(id)`, `all_ids()`

**Report/trace — identical signatures across real and fake:**
- `get_report(node_id, store, viewer) -> Report | None`
- `trace(node_id, store) -> {"path": list[str], "origin": ChangeEvent | None}`

**Engine — identical signatures across `Engine` and `FakeEngine`:**
`on_data_change(node_id, change)`, `fire_node(node_id) -> list[str]`,
`run_full() -> list[str]`

**Required factory shape:**

```python
def build_mcp(store, engine, get_report, trace, name="4sight") -> FastMCP:
    mcp = FastMCP(name)
    # register tools as closures
    return mcp

def build_fake() -> FastMCP:
    from .fakes import fake_seed, fake_get_report, fake_trace
    store, engine, _ = fake_seed()
    return build_mcp(store, engine, fake_get_report, fake_trace)

def build_real() -> FastMCP:
    from .seed import load_company
    from .reports import get_report, trace_to_source
    store, engine, _ = load_company()
    return build_mcp(store, engine, get_report, trace_to_source)

mcp = build_real()

if __name__ == "__main__":
    mcp.run()
```

## Tools spec

Write a clear docstring for every tool — FastMCP exposes it to the calling LLM.
Handle unknown `node_id` gracefully (return `None` or error dict, no bare
`KeyError`).

| Tool | Signature | Returns | Notes |
|---|---|---|---|
| `list_nodes` | `() -> list[dict]` | `[{id, title, kind, severity, score}]` | `severity`/`score` `None` if no `current` |
| `get_node_report` | `(node_id, role="reviewer") -> dict\|None` | `report.model_dump(mode="json")` | role: `"reviewer"` or `"privileged"`; builds `Viewer(id="agent", role=Role(role))` |
| `trace_risk` | `(node_id) -> dict` | `{path, origin}` | origin serialised or `None` |
| `get_neighbors` | `(node_id) -> dict` | `{children, parents, dependencies, dependents}` | direct store calls |
| `simulate_change` | `(node_id, effect_score, source="Leave Calendar") -> dict` | `{changed: list[str]}` | builds `ChangeEvent(after={"effect_score": effect_score}, ...)`, then `on_data_change` + `fire_node` |

## Tests spec (`tests/test_mcp_server.py`)

Use FastMCP's in-memory `Client` — no subprocess, no ports.

```python
import asyncio
from fastmcp import Client

def call(mcp, tool, args=None):
    async def _go():
        async with Client(mcp) as c:
            return await c.call_tool(tool, args or {})
    return asyncio.run(_go())
```

Verify the actual return type from `Client.call_tool` at runtime before
asserting on it — do not assume a shape.

**Required test cases:**

1. All five tools discoverable via the client
2. `list_nodes` on `build_fake()` returns nodes with correct fields
3. **Leave act** on `build_real()`:
   - `simulate_change("alice_owner", 90, "Leave Calendar")` → `"root"` in `changed`
   - `trace_risk("root")` → path ends at `"alice_owner"`, `origin.source == "Leave Calendar"`
4. **Sensitivity act** on `build_real()`:
   - After `simulate_change("comp_pool", 60)`:
   - `get_node_report("personnel_budget", "reviewer")` → not redacted (three contributors declassify it)
   - `get_node_report("comp_pool", "reviewer")` → redacted (`overall` starts with `"Confidential"`)
   - `get_node_report("comp_pool", "privileged")` → full (not redacted)
5. `get_node_report("nonexistent_node", "reviewer")` → does not raise

Tests 3 and 4 are the canonical demo acts. They must pass.
Do not add `pytest-asyncio` — use `asyncio.run()` wrappers in sync test functions.

## Acceptance checklist (run before reporting back)

```
pytest                          # must be fully green, including pre-existing tests
python -c "from foursight.mcp_server import build_fake, build_real; build_fake(); build_real()"
python -m foursight.mcp_server --help 2>/dev/null || echo "startup ok"
```

## When you are done

Report: files created, `pytest` output, final tool list with docstrings, any
discrepancy between this spec and the actual repo code and how you resolved it.
