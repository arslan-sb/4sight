from __future__ import annotations

import os
from types import SimpleNamespace
from typing import Any

from dotenv import load_dotenv

from .jira_client import DisabledJiraClient, FakeJiraClient, JiraClient
from .jira_notifier import TicketLedger, make_jira_notifier
from .jira_router import build_jira_router

load_dotenv()


class JiraConfig:
    def __init__(
        self,
        enabled: bool,
        connected: bool,
        base_url: str,
        email: str,
        api_token: str,
        project_key: str,
        issue_type: str,
        threshold: str,
        public_url: str,
    ) -> None:
        self.enabled = enabled
        self.connected = connected
        self.base_url = base_url
        self.email = email
        self.api_token = api_token
        self.project_key = project_key
        self.issue_type = issue_type
        self.threshold = threshold
        self.public_url = public_url

    @classmethod
    def from_env(cls) -> JiraConfig:
        enabled_str = os.getenv("JIRA_ENABLED", "false").lower()
        enabled = enabled_str in ("true", "1", "yes")

        base_url = os.getenv("JIRA_BASE_URL", "")
        email = os.getenv("JIRA_EMAIL", "")
        api_token = os.getenv("JIRA_API_TOKEN", "")
        project_key = os.getenv("JIRA_PROJECT_KEY", "")
        issue_type = os.getenv("JIRA_ISSUE_TYPE", "Task")
        threshold = os.getenv("JIRA_RISK_THRESHOLD", "high")
        public_url = os.getenv("FOURSIGHT_PUBLIC_URL", "http://localhost:8000")

        connected = enabled and bool(base_url and email and api_token and project_key)

        return cls(
            enabled=enabled,
            connected=connected,
            base_url=base_url,
            email=email,
            api_token=api_token,
            project_key=project_key,
            issue_type=issue_type,
            threshold=threshold,
            public_url=public_url,
        )


def make_client(config: JiraConfig) -> Any:
    if not config.connected:
        return DisabledJiraClient()
    return JiraClient(
        base_url=config.base_url,
        email=config.email,
        api_token=config.api_token,
        project_key=config.project_key,
        issue_type=config.issue_type,
    )


def attach_jira(app: Any, engine: Any, store: Any, client: Any = None, get_report: Any = None, config: Any = None) -> SimpleNamespace:
    if config is None:
        config = JiraConfig.from_env()
    client = client or make_client(config)
    ledger = TicketLedger()
    engine.listeners.append(make_jira_notifier(store, client, ledger, config))
    app.include_router(build_jira_router(store, client, ledger, config))
    return SimpleNamespace(config=config, client=client, ledger=ledger)
