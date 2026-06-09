# Jira Integration — Implementation Report

**Stream:** Integrations (Jira)
**Date:** 2026-06-09
**Author:** Arslan Shaukat
**Status:** Complete — 99/99 tests passing

---

## Contents

1. [What was built](#1-what-was-built)
2. [New files](#2-new-files)
3. [Modified files](#3-modified-files)
4. [Architecture](#4-architecture)
5. [Configuration](#5-configuration)
6. [HTTP API — frontend integration reference](#6-http-api--frontend-integration-reference)
7. [Jira search endpoint (2025 note)](#7-jira-search-endpoint-2025-note)
8. [Dedup algorithm](#8-dedup-algorithm)
9. [Ticket content](#9-ticket-content)
10. [Starting the server](#10-starting-the-server)
11. [Using in another entrypoint](#11-using-in-another-entrypoint)
12. [Testing in your own tests](#12-testing-in-your-own-tests)
13. [Test coverage summary](#13-test-coverage-summary)

---

## 1. What was built

When a node's risk severity crosses a configurable threshold, 4sight automatically opens a Jira issue. If the risk worsens further, it escalates by commenting on the existing issue rather than creating a new one. It never creates duplicate tickets for the same ongoing risk, even across process restarts. An HTTP API allows the frontend to check status, list tickets, force a sync, or scan all nodes on demand.

Scope is Jira only. The module is self-contained under `src/foursight/integrations/` so Slack or other channels can be added later as sibling modules without touching this code.

---

## 2. New files

```
src/foursight/integrations/__init__.py      re-exports attach_jira, JiraConfig, FakeJiraClient
src/foursight/integrations/jira_client.py   JiraClient (real httpx), DisabledJiraClient, FakeJiraClient
src/foursight/integrations/jira_notifier.py TicketLedger, sync_or_create, make_jira_notifier
src/foursight/integrations/jira_router.py   FastAPI APIRouter (6 endpoints)
src/foursight/integrations/jira.py          JiraConfig.from_env(), attach_jira() facade
src/foursight/demo_jira.py                  uvicorn entrypoint
tests/test_jira_integration.py              12 tests — zero real network calls
```

---

## 3. Modified files

### `src/foursight/api.py` — 2 lines only

Immediately after `store, eng, _ = seed_fn()`, these two lines were added:

```python
app.state.engine = eng
app.state.store = store
```

No other logic was changed. This is the only authorised modification to `api.py`.

### `pyproject.toml`

`httpx>=0.27` moved from `[project.optional-dependencies] dev` into the runtime `[project] dependencies` list. It was already installed; this formalises the runtime requirement.

### `.env.example`

Eight new Jira variables appended (see [Section 5](#5-configuration)).

---

## 4. Architecture

```
Engine.listeners
      │
      └─► make_jira_notifier(store, client, ledger, config)
                │
                │  called with list[node_id] after every crawl
                │
                └─► sync_or_create(node, report, store, client, ledger, config)
                          │
                          ├─ below threshold?             → {skipped: "below_threshold"}
                          ├─ in ledger, same severity?    → {deduped: true, issue_key: ...}
                          ├─ in ledger, higher severity?  → add_comment + {deduped: true, escalated: true}
                          ├─ not in ledger, open in Jira? → record in ledger + {deduped: true}
                          └─ new                          → create_issue + {created: true, issue_key: ...}
```

### Key design decisions

**Two-layer dedup.** The `TicketLedger` (in-memory dict) is the fast path — no network call needed for repeat events. On process restart the ledger is empty, so `find_open_issue_for_node` queries Jira by label as a durable backstop. Restarts never create duplicates.

**Errors never reach the engine.** Every Jira and network call is wrapped in try/except. An outage logs the error and returns `{"error": "..."}` to the caller; risk propagation is never interrupted. This matches the `_broadcast` pattern already used in `api.py`.

**Disabled mode is zero-config.** If `JIRA_ENABLED` is false or any required credential is missing, `make_client()` returns a `DisabledJiraClient` whose methods are no-ops or return `{"disabled": true}`. The router still mounts and all endpoints respond. No credentials are needed to run the app, import it, or run its tests.

**REST v2 for write, v3/search/jql for search.** The legacy search endpoints were removed from Jira Cloud in October 2025. Issue creation and comments use the REST v2 API (plain-string description body). Search uses the current enhanced endpoint — see [Section 7](#7-jira-search-endpoint-2025-note).

---

## 5. Configuration

Copy these into your `.env` file. The app starts and runs without any of them set (disabled mode).

```bash
JIRA_ENABLED=true                               # "true" | "1" | "yes" to enable; anything else = disabled
JIRA_BASE_URL=https://your-domain.atlassian.net
JIRA_EMAIL=you@example.com
JIRA_API_TOKEN=                                 # Atlassian API token — NOT your password
                                                # Generate at: https://id.atlassian.com/manage-profile/security/api-tokens
JIRA_PROJECT_KEY=OPS                            # must already exist in your Jira instance
JIRA_ISSUE_TYPE=Task                            # "Task" is available in every project; "Bug" may not be
JIRA_RISK_THRESHOLD=high                        # low | medium | high | critical
FOURSIGHT_PUBLIC_URL=http://localhost:8000      # used to build the /report/<id> link inside tickets
```

**Disabled mode** is active when `JIRA_ENABLED` is false OR when any of `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, or `JIRA_PROJECT_KEY` is empty. The `connected` flag in `/jira/status` distinguishes the two: `enabled=true, connected=false` means the feature is turned on but credentials are incomplete.

---

## 6. HTTP API — frontend integration reference

All endpoints are under the `/jira` prefix. The API token lives server-side only — no endpoint exposes it.

---

### `GET /jira/status`

Returns current runtime config and ledger size.

**Response:**
```json
{
  "enabled": true,
  "connected": true,
  "project_key": "OPS",
  "threshold": "high",
  "ticket_count": 3
}
```

---

### `GET /jira/tickets`

Returns all tickets currently tracked in the in-process ledger.

**Response:**
```json
[
  {
    "node_id": "root",
    "issue_key": "OPS-42",
    "url": "https://your-domain.atlassian.net/browse/OPS-42",
    "severity": "critical",
    "created_at": "2026-06-09T10:23:41.123456+00:00"
  }
]
```

---

### `GET /jira/tickets/{node_id}`

Returns the ledger entry for one node, or `null` if it has never been synced.

**Response (found):**
```json
{
  "node_id": "root",
  "issue_key": "OPS-42",
  "url": "https://your-domain.atlassian.net/browse/OPS-42",
  "severity": "critical",
  "created_at": "2026-06-09T10:23:41.123456+00:00"
}
```

**Response (not found):** `null`

---

### `POST /jira/sync/{node_id}`

Forces an immediate sync for a single node. Idempotent — safe to call repeatedly.

**Possible response bodies:**

| Outcome | Body |
|---|---|
| New ticket created | `{"created": true, "issue_key": "OPS-42", "url": "..."}` |
| Existing ticket, no change | `{"deduped": true, "issue_key": "OPS-42", "url": "..."}` |
| Escalated (severity increased) | `{"deduped": true, "escalated": true, "issue_key": "OPS-42", "url": "..."}` |
| Below threshold | `{"skipped": "below_threshold"}` |
| Node has no report yet | `{"skipped": "no_report"}` |
| Integration disabled | `{"disabled": true}` |
| Jira/network error | `{"error": "<message>"}` |
| Node not found | HTTP 404 |

---

### `POST /jira/scan`

Iterates every node that has a report at or above the current threshold and syncs each.

**Response:**
```json
{
  "created": ["root", "payments"],
  "deduped": ["customer_portal"],
  "skipped": 6
}
```

`skipped` counts nodes with no report, or nodes whose severity is below threshold.

---

### `PUT /jira/config`

Updates runtime configuration without a server restart. Both fields are optional.

**Request body:**
```json
{ "threshold": "medium", "enabled": true }
```

**Response:** same shape as `GET /jira/status`.

Returns HTTP 400 if `threshold` is not one of `low | medium | high | critical`.

---

### curl examples

```bash
# Status
curl http://localhost:8000/jira/status

# List all synced tickets
curl http://localhost:8000/jira/tickets

# Ticket for a specific node
curl http://localhost:8000/jira/tickets/root

# Force sync a node — creates a ticket or returns deduped
curl -XPOST http://localhost:8000/jira/sync/root

# Second call on same node — always returns deduped
curl -XPOST http://localhost:8000/jira/sync/root

# Scan all nodes at or above threshold
curl -XPOST http://localhost:8000/jira/scan

# Lower the threshold at runtime
curl -XPUT http://localhost:8000/jira/config \
  -H 'Content-Type: application/json' \
  -d '{"threshold": "medium"}'
```

---

## 7. Jira search endpoint (2025 note)

The legacy search endpoints (`GET /rest/api/2/search` and `POST /rest/api/3/search`) were
removed from Jira Cloud in October 2025. This integration uses the current enhanced endpoint.

**Endpoint:**
```
POST {JIRA_BASE_URL}/rest/api/3/search/jql
```

**Request body:**
```json
{
  "jql": "project = \"OPS\" AND labels = \"4sight-node-root\" AND statusCategory != Done",
  "fields": ["key", "status"],
  "maxResults": 1
}
```

**Response shape:**
```json
{
  "issues": [
    { "key": "OPS-42", "fields": { "status": { "statusCategory": { "key": "indeterminate" } } } }
  ],
  "nextPageToken": "..."
}
```

Only `issues[0].key` is read. Token-based pagination (`nextPageToken`) is not used because `maxResults: 1` is sufficient for the dedup check.

Issue creation and comments use the v2 API with plain-string description bodies:

```
POST {JIRA_BASE_URL}/rest/api/2/issue
POST {JIRA_BASE_URL}/rest/api/2/issue/{key}/comment
```

Atlassian Document Format (v3 ADF) is intentionally avoided to keep the description a simple readable string.

---

## 8. Dedup algorithm

`sync_or_create(node, report, store, client, ledger, config)` — called for every node after each crawl.

```
SEVERITY_RANK = { low: 0, medium: 1, high: 2, critical: 3 }
```

1. **Threshold check.** If `SEVERITY_RANK[report.severity] < SEVERITY_RANK[config.threshold]` → return `{skipped: "below_threshold"}`. No network call.

2. **Ledger hit.** If `node_id` is in the `TicketLedger`:
   - Same or lower severity → return `{deduped: true}`. No network call.
   - Higher severity → call `add_comment` with the escalation message, update the ledger entry's severity, return `{deduped: true, escalated: true}`. One network call.

3. **Restart dedup.** Node is not in the ledger (process restart or first run) → call `find_open_issue_for_node` (JQL search on the `4sight-node-<id>` label). If an open issue exists, record it in the ledger and return `{deduped: true}`. No new issue created.

4. **Create.** No open issue found → build ticket content, call `create_issue`, record in ledger, return `{created: true, issue_key, url}`.

All exceptions are caught. On error the function returns `{error: str(e)}` and logs; it never raises into the engine.

---

## 9. Ticket content

**Summary format:**
```
[CRITICAL] Q3 Launch Readiness — operational risk
```

**Labels:**
```
["4sight", "4sight-node-root", "4sight-sev-critical"]
```

The `4sight-node-<id>` label is the durable dedup key used by the JQL search on restart.

**Description (plain text):**
```
Severity: critical
Score: Alice (payroll ownership): effect 90 [critical]

Summary: <LLM-generated overall assessment>

Top drivers:
  - Alice (payroll ownership): effect 90 [critical]
  - Platform Team: score 82 [critical]
  - Payments Team: score 78 [critical]

Origin:
  Source: Leave Calendar
  Record: alice_owner
  At: 2026-06-09T10:23:41+00:00

Report: http://localhost:8000/report/root
```

**Severity → Jira priority mapping:**

| 4sight severity | Jira priority |
|---|---|
| low | Low |
| medium | Medium |
| high | High |
| critical | Highest |

If Jira returns an error on the `priority` field (some projects use custom priority schemes or restrict the field), the client automatically retries once without it.

**Escalation comment format:**
```
Risk escalated to critical (was high). Score: Alice (payroll ownership): effect 90 [critical]
```

---

## 10. Starting the server

```bash
# Development (with auto-reload)
uvicorn foursight.demo_jira:app --reload

# Production
uvicorn foursight.demo_jira:app --host 0.0.0.0 --port 8000
```

The entrypoint (`src/foursight/demo_jira.py`) loads the full company fixture and attaches the Jira integration in three lines:

```python
from .api import build_app
from .seed import load_company
from .integrations.jira import attach_jira

app = build_app(seed_fn=load_company)
attach_jira(app, app.state.engine, app.state.store)
```

If no Jira credentials are set in `.env`, the server starts in disabled mode — all `/jira/*` endpoints respond but take no action.

---

## 11. Using in another entrypoint

If your stream has its own `build_app` call, attach the integration with two lines:

```python
from foursight.integrations.jira import attach_jira

# app, engine, store already exist
jira = attach_jira(app, engine, store)
# jira.config, jira.client, jira.ledger are available if you need a handle
```

`attach_jira` signature:

```python
def attach_jira(
    app,
    engine,
    store,
    client=None,       # pass FakeJiraClient() in tests; omit for real
    get_report=None,   # reserved for future use
    config=None,       # pass a JiraConfig() to override env; omit for real
) -> SimpleNamespace
```

The function is safe to call with no credentials — it falls back to disabled mode automatically.

---

## 12. Testing in your own tests

Use `FakeJiraClient` — it is fully in-memory, requires no credentials, and never touches the network.

```python
from foursight.integrations import FakeJiraClient, attach_jira

fake = FakeJiraClient()
attach_jira(app, engine, store, client=fake)

# After triggering a change:
issues  = fake.issues_for_node("root")        # list of issues created for that node
comments = fake.comments_for_issue("FAKE-1")  # comments added via escalation
```

To test disabled mode explicitly, pass a `JiraConfig` with `enabled=False`:

```python
from foursight.integrations import JiraConfig, attach_jira
from foursight.integrations.jira_client import DisabledJiraClient

config = JiraConfig(enabled=False, connected=False, ...)
attach_jira(app, engine, store, client=DisabledJiraClient(), config=config)
```

---

## 13. Test coverage summary

All 12 tests are in `tests/test_jira_integration.py`. None make real network calls.

| Test | What it verifies |
|---|---|
| `test_threshold_creates_ticket` | Effect score 90 → critical severity; exactly 1 issue for `root`; label `4sight-node-root` present |
| `test_no_duplicate` | Same change fired twice → still 1 issue, no second create |
| `test_escalation` | high → critical: 1 comment added on existing issue, no new issue created |
| `test_below_threshold` | Effect score 15 → low severity; 0 issues created |
| `test_restart_dedup` | Fresh `TicketLedger` with pre-existing open issue in Jira → deduped, no new issue |
| `test_router_status_enabled` | `GET /jira/status` returns `enabled: true` and `threshold` field |
| `test_router_sync_creates_then_dedupes` | `POST /jira/sync/root` → `issue_key` present; second call → `deduped: true` |
| `test_router_tickets_list` | `GET /jira/tickets` lists the synced entry for `root` |
| `test_router_ticket_by_node` | `GET /jira/tickets/root` returns the correct entry |
| `test_router_scan` | `POST /jira/scan` returns `{created, deduped, skipped}` |
| `test_router_unknown_node_404` | `POST /jira/sync/<nonexistent>` returns HTTP 404 |
| `test_disabled_mode` | `enabled: false` in status; sync returns `{disabled: true}`; `GET /report/root` unaffected |

**Full suite result:**
```
99 passed, 2 warnings in 1.84s
```
(87 pre-existing tests + 12 new Jira tests, all green)
