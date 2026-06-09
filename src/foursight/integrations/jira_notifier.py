from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Callable

from ..reports import trace_to_source

logger = logging.getLogger(__name__)

SEVERITY_RANK: dict[str, int] = {"low": 0, "medium": 1, "high": 2, "critical": 3}


class TicketLedger:
    """In-process dedup ledger: node_id -> ticket record."""

    def __init__(self) -> None:
        self._data: dict[str, dict[str, Any]] = {}

    def get(self, node_id: str) -> dict[str, Any] | None:
        return self._data.get(node_id)

    def set(self, node_id: str, issue_key: str, url: str, severity: str) -> None:
        self._data[node_id] = {
            "node_id": node_id,
            "issue_key": issue_key,
            "url": url,
            "severity": severity,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

    def all(self) -> list[dict[str, Any]]:
        return list(self._data.values())

    def __contains__(self, node_id: str) -> bool:
        return node_id in self._data


def _build_description(node: Any, report: Any, store: Any, public_url: str) -> str:
    trace = trace_to_source(node.id, store)
    origin = trace.get("origin")

    lines = [
        f"Severity: {report.severity.value}",
        f"Score: {report.drivers[0].line if report.drivers else 'n/a'}",
        "",
        f"Summary: {report.overall}",
        "",
        "Top drivers:",
    ]
    for d in report.drivers[:3]:
        lines.append(f"  - {d.line} [{d.severity.value}]")

    if origin:
        lines += [
            "",
            "Origin:",
            f"  Source: {origin.source}",
            f"  Record: {origin.record_ref}",
            f"  At: {origin.at.isoformat() if hasattr(origin.at, 'isoformat') else str(origin.at)}",
        ]

    lines += ["", f"Report: {public_url}/report/{node.id}"]
    return "\n".join(lines)


def sync_or_create(node: Any, report: Any, store: Any, client: Any, ledger: TicketLedger, config: Any) -> dict[str, Any]:
    try:
        sev = report.severity.value
        rank = SEVERITY_RANK.get(sev, 0)
        threshold_rank = SEVERITY_RANK.get(config.threshold, 2)

        if rank < threshold_rank:
            return {"skipped": "below_threshold"}

        if node.id in ledger:
            entry = ledger.get(node.id)
            existing_rank = SEVERITY_RANK.get(entry["severity"], 0)
            if rank > existing_rank:
                # Escalation: comment and update ledger
                comment = (
                    f"Risk escalated to {sev} "
                    f"(was {entry['severity']}). "
                    f"Score: {report.drivers[0].line if report.drivers else 'n/a'}"
                )
                client.add_comment(entry["issue_key"], comment)
                ledger.set(node.id, entry["issue_key"], entry["url"], sev)
                return {"deduped": True, "escalated": True, "issue_key": entry["issue_key"], "url": entry["url"]}
            return {"deduped": True, "issue_key": entry["issue_key"], "url": entry["url"]}

        # Not in ledger — check Jira for an existing open issue (restart dedup)
        existing = client.find_open_issue_for_node(node.id)
        if existing:
            ledger.set(node.id, existing["key"], existing["url"], sev)
            return {"deduped": True, "issue_key": existing["key"], "url": existing["url"]}

        # Create new ticket
        summary = f"[{sev.upper()}] {node.title} — operational risk"
        description = _build_description(node, report, store, config.public_url)
        labels = ["4sight", f"4sight-node-{node.id}", f"4sight-sev-{sev}"]
        result = client.create_issue(summary, description, sev, labels, config.public_url)

        if result.get("disabled"):
            return {"disabled": True}

        ledger.set(node.id, result["key"], result["url"], sev)
        return {"created": True, "issue_key": result["key"], "url": result["url"]}

    except Exception as exc:
        logger.exception("Jira sync_or_create failed for %s: %s", node.id, exc)
        return {"error": str(exc)}


def make_jira_notifier(store: Any, client: Any, ledger: TicketLedger, config: Any) -> Callable[[list[str]], None]:
    def _listener(changed: list[str]) -> None:
        for node_id in changed:
            try:
                node = store.get_node(node_id)
                if node.report is None:
                    continue
                sync_or_create(node, node.report, store, client, ledger, config)
            except Exception as exc:
                logger.exception("Jira notifier error for %s: %s", node_id, exc)

    return _listener
