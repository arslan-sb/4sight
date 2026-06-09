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

    def set(self, node_id: str, issue_key: str, url: str, severity: str, signature: str = "") -> None:
        self._data[node_id] = {
            "node_id": node_id,
            "issue_key": issue_key,
            "url": url,
            "severity": severity,
            "signature": signature,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

    def all(self) -> list[dict[str, Any]]:
        return list(self._data.values())

    def __contains__(self, node_id: str) -> bool:
        return node_id in self._data


def _signature(report: Any) -> str:
    """Stable content fingerprint (ignores timestamps): severity + top drivers."""
    drivers = "|".join(d.line for d in report.drivers[:3])
    return f"{report.severity.value}|{drivers}"


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

        new_sig = _signature(report)
        description = _build_description(node, report, store, config.public_url)

        if node.id in ledger:
            entry = ledger.get(node.id)
            existing_rank = SEVERITY_RANK.get(entry["severity"], 0)
            if rank > existing_rank:
                # Escalation: severity rose → comment and update ledger.
                comment = f"Risk escalated to {sev} (was {entry['severity']}).\n\n{description}"
                client.add_comment(entry["issue_key"], comment)
                ledger.set(node.id, entry["issue_key"], entry["url"], sev, signature=new_sig)
                return {"deduped": True, "escalated": True, "issue_key": entry["issue_key"], "url": entry["url"]}
            if new_sig != entry.get("signature", ""):
                # Same/lower severity but content changed → refresh comment.
                comment = f"Risk status update ({sev}).\n\n{description}"
                client.add_comment(entry["issue_key"], comment)
                ledger.set(node.id, entry["issue_key"], entry["url"], entry["severity"], signature=new_sig)
                return {"deduped": True, "updated": True, "issue_key": entry["issue_key"], "url": entry["url"]}
            # Nothing changed → no network call.
            return {"deduped": True, "issue_key": entry["issue_key"], "url": entry["url"]}

        # Not in ledger — check Jira for an existing open issue (restart dedup)
        existing = client.find_open_issue_for_node(node.id)
        if existing:
            ledger.set(node.id, existing["key"], existing["url"], sev, signature=new_sig)
            comment = f"Risk status update ({sev}).\n\n{description}"
            client.add_comment(existing["key"], comment)
            return {"deduped": True, "updated": True, "issue_key": existing["key"], "url": existing["url"]}

        # Create new ticket
        summary = f"[{sev.upper()}] {node.title} — operational risk"
        labels = ["4sight", f"4sight-node-{node.id}", f"4sight-sev-{sev}"]
        result = client.create_issue(summary, description, sev, labels, config.public_url)

        if result.get("disabled"):
            return {"disabled": True}

        ledger.set(node.id, result["key"], result["url"], sev, signature=new_sig)
        return {"created": True, "issue_key": result["key"], "url": result["url"]}

    except Exception as exc:
        logger.exception("Jira sync_or_create failed for %s: %s", node.id, exc)
        return {"error": str(exc)}


def make_jira_notifier(store: Any, client: Any, ledger: TicketLedger, config: Any) -> Callable[[list[str]], None]:
    def _listener(changed: list[str]) -> None:
        try:
            if not changed:
                return
            # One ticket per crawl, for the master (top) node only.
            #
            # On a full crawl `changed` is topo-ordered leaves-first, so
            # `changed[-1]` is the master node. But an *identical* re-fire
            # short-circuits (deltas stay below EPSILON), so propagation never
            # reaches the top and `changed` collapses to just the trigger node.
            # Keying off `changed[-1]` there would open a second ticket for the
            # trigger instead of refreshing the master's. So we resolve the true
            # master the same way the engine does — the top of the crawl's
            # influence closure — which equals `changed[-1]` on a full crawl and
            # maps re-fires back to the same master so dedup holds.
            master_id = store.topo_order(store.closure(changed))[-1]
            node = store.get_node(master_id)
            if node.report is None:
                return
            sync_or_create(node, node.report, store, client, ledger, config)
        except Exception as exc:
            logger.exception("Jira notifier error for crawl %s: %s", changed, exc)

    return _listener
