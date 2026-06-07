Implement the MCP stream for the `foursight` project.

Read `CLAUDE.md` first — it is the authoritative spec and takes priority over
anything you infer from the codebase.

Your deliverables are exactly two files:
- `src/foursight/mcp_server.py`
- `tests/test_mcp_server.py`

Start by reading these files in this order before writing any code:
1. `CLAUDE.md`
2. `src/foursight/models.py`
3. `src/foursight/fakes.py`
4. `src/foursight/reports.py`
5. `src/foursight/propagation.py`
6. `src/foursight/seed.py`
7. `src/foursight/sensitivity.py`
8. `src/foursight/mock_server.py`
9. `tests/test_load_company.py`
10. `tests/test_propagation.py`

Then run `pytest` to confirm the baseline is green.

Then implement. Do not write a single line of `mcp_server.py` until you have
read all of the above.

When finished, run the acceptance checklist in `CLAUDE.md` and report back with
the checklist output, the pytest result, and the final list of registered tools
with their docstrings.
