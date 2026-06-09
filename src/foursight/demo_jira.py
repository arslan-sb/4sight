from __future__ import annotations

from .api import build_app
from .seed import load_company
from .integrations.jira import attach_jira

app = build_app(seed_fn=load_company)
attach_jira(app, app.state.engine, app.state.store)
