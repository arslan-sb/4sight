from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

SEVERITY_TO_PRIORITY = {
    "low": "Low",
    "medium": "Medium",
    "high": "High",
    "critical": "Highest",
}


class JiraClient:
    """Real Jira HTTP client using REST v2 (create/comment) and v3/search/jql (search)."""

    def __init__(self, base_url: str, email: str, api_token: str, project_key: str, issue_type: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.project_key = project_key
        self.issue_type = issue_type
        self._auth = (email, api_token)

    def _client(self) -> httpx.Client:
        return httpx.Client(auth=self._auth, timeout=15.0)

    def create_issue(self, summary: str, description: str, severity: str, labels: list[str], public_url: str) -> dict[str, Any]:
        fields: dict[str, Any] = {
            "project": {"key": self.project_key},
            "summary": summary,
            "description": description,
            "issuetype": {"name": self.issue_type},
            "labels": labels,
            "priority": {"name": SEVERITY_TO_PRIORITY.get(severity, "Medium")},
        }
        body = {"fields": fields}
        with self._client() as c:
            resp = c.post(f"{self.base_url}/rest/api/2/issue", json=body)
            if not resp.is_success:
                # Retry without priority if it looks priority-related
                text = resp.text.lower()
                if "priority" in text or resp.status_code == 400:
                    fields_no_priority = {k: v for k, v in fields.items() if k != "priority"}
                    resp = c.post(f"{self.base_url}/rest/api/2/issue", json={"fields": fields_no_priority})
            resp.raise_for_status()
        data = resp.json()
        key = data["key"]
        return {"key": key, "id": data["id"], "url": f"{self.base_url}/browse/{key}"}

    def find_open_issue_for_node(self, node_id: str) -> dict[str, Any] | None:
        jql = f'project = "{self.project_key}" AND labels = "4sight-node-{node_id}" AND statusCategory != Done'
        # Use the 2025 enhanced search endpoint (legacy /rest/api/2/search removed Oct 2025)
        body = {"jql": jql, "fields": ["key", "status"], "maxResults": 1}
        with self._client() as c:
            resp = c.post(f"{self.base_url}/rest/api/3/search/jql", json=body)
            resp.raise_for_status()
        data = resp.json()
        issues = data.get("issues", [])
        if not issues:
            return None
        key = issues[0]["key"]
        return {"key": key, "url": f"{self.base_url}/browse/{key}"}

    def add_comment(self, issue_key: str, body: str) -> None:
        with self._client() as c:
            resp = c.post(
                f"{self.base_url}/rest/api/2/issue/{issue_key}/comment",
                json={"body": body},
            )
            resp.raise_for_status()


class DisabledJiraClient:
    """Drop-in replacement when Jira integration is disabled or misconfigured."""

    def create_issue(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        return {"disabled": True}

    def find_open_issue_for_node(self, node_id: str) -> dict[str, Any] | None:
        return None

    def add_comment(self, issue_key: str, body: str) -> None:
        pass


class FakeJiraClient:
    """In-memory Jira client for tests — no network."""

    def __init__(self) -> None:
        self._issues: list[dict[str, Any]] = []
        self._comments: list[dict[str, str]] = []
        self._counter = 0

    def create_issue(self, summary: str, description: str, severity: str, labels: list[str], public_url: str) -> dict[str, Any]:
        self._counter += 1
        key = f"FAKE-{self._counter}"
        issue = {
            "key": key,
            "id": str(self._counter),
            "url": f"https://fake.atlassian.net/browse/{key}",
            "summary": summary,
            "description": description,
            "severity": severity,
            "labels": labels,
            "status_category": "In Progress",
        }
        self._issues.append(issue)
        return {"key": key, "id": issue["id"], "url": issue["url"]}

    def find_open_issue_for_node(self, node_id: str) -> dict[str, Any] | None:
        label = f"4sight-node-{node_id}"
        for issue in self._issues:
            if label in issue.get("labels", []) and issue.get("status_category") != "Done":
                return {"key": issue["key"], "url": issue["url"]}
        return None

    def add_comment(self, issue_key: str, body: str) -> None:
        self._comments.append({"issue_key": issue_key, "body": body})

    # Test helpers
    def issues_for_node(self, node_id: str) -> list[dict[str, Any]]:
        label = f"4sight-node-{node_id}"
        return [i for i in self._issues if label in i.get("labels", [])]

    def comments_for_issue(self, issue_key: str) -> list[dict[str, str]]:
        return [c for c in self._comments if c["issue_key"] == issue_key]
