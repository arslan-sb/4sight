from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from foursight.api import build_app
from foursight.integrations import FakeJiraClient, JiraConfig, attach_jira
from foursight.integrations.jira_client import DisabledJiraClient
from foursight.integrations.jira_notifier import (
    TicketLedger,
    make_jira_notifier,
    sync_or_create,
)
from foursight.models import ChangeEvent, DriverBullet, Report, Sensitivity, Severity
from foursight.seed import build_seed


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _config(threshold: str = "high", enabled: bool = True) -> JiraConfig:
    return JiraConfig(
        enabled=enabled,
        connected=enabled,
        base_url="https://fake.atlassian.net",
        email="test@example.com",
        api_token="tok",
        project_key="FAKE",
        issue_type="Task",
        threshold=threshold,
        public_url="http://localhost:8000",
    )


def _change(effect_score: float, source: str = "Leave Calendar") -> ChangeEvent:
    return ChangeEvent(
        source=source,
        record_ref="alice_owner",
        before=None,
        after={"effect_score": effect_score},
        at=datetime.now(timezone.utc),
        sensitivity=Sensitivity.CONFIDENTIAL,
    )


def _fire(eng, effect_score: float) -> list[str]:
    eng.on_data_change("alice_owner", _change(effect_score))
    return eng.fire_node("alice_owner")


def _seed_with_notifier(threshold: str = "high"):
    s, eng, _ = build_seed()
    fake = FakeJiraClient()
    ledger = TicketLedger()
    config = _config(threshold)
    eng.listeners.append(make_jira_notifier(s, fake, ledger, config))
    return s, eng, fake, ledger, config


# ---------------------------------------------------------------------------
# 1. Crossing threshold creates a ticket
# ---------------------------------------------------------------------------

def test_threshold_creates_ticket():
    s, eng, fake, ledger, config = _seed_with_notifier()
    _fire(eng, 90)

    root_issues = fake.issues_for_node("root")
    assert len(root_issues) == 1
    assert "4sight-node-root" in root_issues[0]["labels"]


# ---------------------------------------------------------------------------
# 2. No duplicate — firing the same change a second time creates no new issue
# ---------------------------------------------------------------------------

def test_no_duplicate():
    s, eng, fake, ledger, config = _seed_with_notifier()
    _fire(eng, 90)
    _fire(eng, 90)

    assert len(fake.issues_for_node("root")) == 1


# ---------------------------------------------------------------------------
# 3. Escalation — high → critical adds a comment, no new issue
# ---------------------------------------------------------------------------

def test_escalation():
    s, eng, fake, ledger, config = _seed_with_notifier()

    # First fire: high severity → ticket created
    _fire(eng, 60)
    root_issues = fake.issues_for_node("root")
    assert len(root_issues) == 1
    root_key = root_issues[0]["key"]

    # Second fire: critical → escalation comment, no new ticket
    _fire(eng, 90)
    assert len(fake.issues_for_node("root")) == 1
    assert len(fake.comments_for_issue(root_key)) == 1


# ---------------------------------------------------------------------------
# 4. Below threshold — small change creates no issue
# ---------------------------------------------------------------------------

def test_below_threshold():
    s, eng, fake, ledger, config = _seed_with_notifier(threshold="high")
    _fire(eng, 15)  # → low severity, below high threshold

    assert len(fake._issues) == 0


# ---------------------------------------------------------------------------
# 5. Restart dedup — fresh ledger, open issue already in Jira → no new create
# ---------------------------------------------------------------------------

def test_restart_dedup():
    s, eng, _ = build_seed()
    fake = FakeJiraClient()
    config = _config()

    # Fire so root has a current report
    _fire(eng, 90)
    node = s.get_node("root")

    # Pre-seed the fake client with an existing open issue for root
    fake._issues.append({
        "key": "FAKE-99",
        "id": "99",
        "url": "https://fake.atlassian.net/browse/FAKE-99",
        "summary": "existing issue",
        "description": "",
        "severity": "high",
        "status_category": "In Progress",
        "labels": ["4sight", "4sight-node-root", "4sight-sev-high"],
    })

    new_ledger = TicketLedger()
    result = sync_or_create(node, node.report, s, fake, new_ledger, config)

    assert result.get("deduped")
    assert len(fake._issues) == 1  # no new issue created


# ---------------------------------------------------------------------------
# 5b. Crawl notifier opens exactly one ticket — for the master (root) node
# ---------------------------------------------------------------------------

def test_only_root_node_gets_ticket():
    s, eng, fake, ledger, config = _seed_with_notifier()
    _fire(eng, 90)

    # Exactly one issue total, and it belongs to the crawl root.
    assert len(fake._issues) == 1
    assert len(fake.issues_for_node("root")) == 1
    # A non-root node that also crossed threshold gets no ticket of its own.
    assert fake.issues_for_node("platform_team") == []


def test_resync_same_state_adds_no_comment():
    s, eng, fake, ledger, config = _seed_with_notifier()
    _fire(eng, 90)
    _fire(eng, 90)

    root_issues = fake.issues_for_node("root")
    assert len(fake._issues) == 1
    assert len(root_issues) == 1
    # Identical re-fire → signature unchanged → no refresh comment.
    assert fake.comments_for_issue(root_issues[0]["key"]) == []


def test_existing_ticket_receives_update_comment():
    s, eng, _ = build_seed()
    node = s.get_node("root")
    fake = FakeJiraClient()
    ledger = TicketLedger()
    config = _config(threshold="high")

    def _report(line: str) -> Report:
        return Report(
            node_id="root",
            version=1,
            generated_at=datetime.now(timezone.utc),
            severity=Severity.HIGH,
            overall="overall",
            drivers=[DriverBullet(node_id="root", severity=Severity.HIGH, line=line)],
        )

    first = sync_or_create(node, _report("driver A"), s, fake, ledger, config)
    assert first.get("created")

    # Same severity, different driver line → signature changes → update comment.
    second = sync_or_create(node, _report("driver B"), s, fake, ledger, config)
    assert second.get("updated") is True
    assert second.get("deduped") is True
    assert len(fake._issues) == 1
    assert len(fake.comments_for_issue(first["issue_key"])) == 1


# ---------------------------------------------------------------------------
# 6. Router integration tests
# ---------------------------------------------------------------------------

def _make_router_app(fake=None, threshold="high"):
    s, eng, _ = build_seed()
    fake = fake or FakeJiraClient()
    config = _config(threshold=threshold)
    app = build_app(seed_fn=lambda: (s, eng, {}))
    attach_jira(app, app.state.engine, app.state.store, client=fake, config=config)
    return TestClient(app), s, eng, fake


def test_router_status_enabled():
    c, *_ = _make_router_app()
    r = c.get("/jira/status")
    assert r.status_code == 200
    data = r.json()
    assert data["enabled"] is True
    assert "threshold" in data


def test_router_sync_creates_then_dedupes():
    c, s, eng, fake = _make_router_app()

    # Push root to critical via the simulate-change endpoint
    c.post("/simulate-change", json={"node_id": "alice_owner", "kind": "leave", "effect_score": 90})

    r1 = c.post("/jira/sync/root")
    assert r1.status_code == 200
    d1 = r1.json()
    # After simulate-change, the notifier may have already created the ticket
    assert d1.get("created") or d1.get("deduped"), f"Unexpected first sync result: {d1}"
    assert "issue_key" in d1

    r2 = c.post("/jira/sync/root")
    assert r2.status_code == 200
    assert r2.json().get("deduped")


def test_router_tickets_list():
    c, s, eng, fake = _make_router_app()
    c.post("/simulate-change", json={"node_id": "alice_owner", "kind": "leave", "effect_score": 90})
    c.post("/jira/sync/root")

    tickets = c.get("/jira/tickets").json()
    assert isinstance(tickets, list)
    assert any(t["node_id"] == "root" for t in tickets)


def test_router_ticket_by_node():
    c, s, eng, fake = _make_router_app()
    c.post("/simulate-change", json={"node_id": "alice_owner", "kind": "leave", "effect_score": 90})
    c.post("/jira/sync/root")

    r = c.get("/jira/tickets/root")
    assert r.status_code == 200
    data = r.json()
    assert data is not None
    assert data["node_id"] == "root"


def test_router_scan():
    c, *_ = _make_router_app()
    # simulate high severity
    c.post("/simulate-change", json={"node_id": "alice_owner", "kind": "leave", "effect_score": 90})

    r = c.post("/jira/scan")
    assert r.status_code == 200
    data = r.json()
    assert "created" in data and "deduped" in data and "skipped" in data


def test_router_unknown_node_404():
    c, *_ = _make_router_app()
    r = c.post("/jira/sync/this_node_does_not_exist")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# 7. Disabled mode
# ---------------------------------------------------------------------------

def test_disabled_mode():
    s, eng, _ = build_seed()
    disabled_config = _config(enabled=False)
    disabled_config.connected = False
    disabled_client = DisabledJiraClient()

    app = build_app(seed_fn=lambda: (s, eng, {}))
    attach_jira(app, app.state.engine, app.state.store, client=disabled_client, config=disabled_config)
    c = TestClient(app)

    # Status shows disabled
    status = c.get("/jira/status").json()
    assert status["enabled"] is False

    # Simulate high severity
    c.post("/simulate-change", json={"node_id": "alice_owner", "kind": "leave", "effect_score": 90})

    # Sync returns disabled
    r = c.post("/jira/sync/root")
    assert r.status_code == 200
    assert r.json().get("disabled")

    # The regular report endpoint is unaffected
    r_report = c.get("/report/root")
    assert r_report.status_code == 200
    assert r_report.json() is not None
