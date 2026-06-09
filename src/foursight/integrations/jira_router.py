from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .jira_notifier import SEVERITY_RANK, sync_or_create, TicketLedger


class ConfigUpdate(BaseModel):
    threshold: str | None = None
    enabled: bool | None = None


def build_jira_router(store: Any, client: Any, ledger: TicketLedger, config: Any) -> APIRouter:
    router = APIRouter(prefix="/jira", tags=["jira"])

    def _status() -> dict[str, Any]:
        return {
            "enabled": config.enabled,
            "connected": config.connected,
            "project_key": config.project_key,
            "threshold": config.threshold,
            "ticket_count": len(ledger.all()),
        }

    @router.get("/status")
    def get_status() -> dict[str, Any]:
        return _status()

    @router.get("/tickets")
    def get_tickets() -> list[dict[str, Any]]:
        return ledger.all()

    @router.get("/tickets/{node_id}")
    def get_ticket(node_id: str) -> dict[str, Any] | None:
        return ledger.get(node_id)

    @router.post("/sync/{node_id}")
    def sync_node(node_id: str) -> dict[str, Any]:
        if node_id not in store.nodes:
            raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found")
        node = store.get_node(node_id)
        if node.report is None:
            return {"skipped": "no_report"}
        return sync_or_create(node, node.report, store, client, ledger, config)

    @router.post("/scan")
    def scan_all() -> dict[str, Any]:
        threshold_rank = SEVERITY_RANK.get(config.threshold, 2)
        created: list[str] = []
        deduped: list[str] = []
        skipped = 0
        for node_id in store.all_ids():
            node = store.get_node(node_id)
            if node.report is None:
                skipped += 1
                continue
            sev_rank = SEVERITY_RANK.get(node.report.severity.value, 0)
            if sev_rank < threshold_rank:
                skipped += 1
                continue
            result = sync_or_create(node, node.report, store, client, ledger, config)
            if result.get("created"):
                created.append(node_id)
            elif result.get("deduped"):
                deduped.append(node_id)
            else:
                skipped += 1
        return {"created": created, "deduped": deduped, "skipped": skipped}

    @router.put("/config")
    def update_config(body: ConfigUpdate) -> dict[str, Any]:
        if body.threshold is not None:
            if body.threshold not in SEVERITY_RANK:
                raise HTTPException(status_code=400, detail=f"Invalid threshold '{body.threshold}'")
            config.threshold = body.threshold
        if body.enabled is not None:
            config.enabled = body.enabled
        return _status()

    return router
