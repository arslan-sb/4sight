from __future__ import annotations
from .graph_store import GraphStore
from .models import Node


class FlattenEngine:
    def __init__(self, store: GraphStore) -> None:
        self.store = store

    def _render_node(self, node: Node) -> str:
        children = self.store.children(node.id)
        deps = self.store.dependencies(node.id)
        lines = [
            f"Node: {node.title} (kind={node.kind.value}, id={node.id})",
            f"Description: {node.description or 'none'}",
        ]
        if children:
            lines.append(f"Decomposition children: {', '.join(children)}")
        if deps:
            lines.append(f"Dependencies: {', '.join(deps)}")
        if node.current:
            cur = node.current
            lines.append(
                f"Current score: {cur.llm_verdict.final_score:.0f} "
                f"({cur.llm_verdict.severity.value})"
            )
        if node.delta_accumulator:
            lines.append(f"Accumulated delta: {node.delta_accumulator:.0f}")
        if node.data_binding:
            lines.append(f"Data source: {node.data_binding.adapter_id}")
        return "\n".join(lines)

    def flatten_full(self) -> str:
        order = self.store.topo_order(set(self.store.all_ids()))
        blocks = []
        for nid in order:
            blocks.append(self._render_node(self.store.get_node(nid)))
        return "\n---\n".join(blocks)

    def flatten_delta(self) -> str:
        order = self.store.topo_order(set(self.store.all_ids()))
        blocks = []
        for nid in order:
            node = self.store.get_node(nid)
            if node.delta_accumulator > 0:
                blocks.append(self._render_node(node))
        return "\n---\n".join(blocks) if blocks else ""

    def build_batch_prompt(self, mode: str = "full") -> tuple[str, list[dict]]:
        graph_text = self.flatten_full() if mode == "full" else self.flatten_delta()
        system = (
            "You are an operational risk assessor. You will receive a flattened "
            "graph of tasks and data sources in topological order. For every node, "
            "return a JSON object with: node_id, final_score (0-100), severity "
            "(low/medium/high/critical), rationale, and summary (1-2 sentences). "
            "Consider the entire graph structure. Decomposition children aggregate "
            "risk upward. Dependency edges propagate risk sideways. "
            "Reply with a JSON array of assessments, one per node in the graph."
        )
        prompt = (
            "Assess every node in this graph. Return a JSON array with one "
            f"object per node.\n\n{graph_text}"
        )
        return system, [{"role": "user", "content": prompt}]

    def parse_batch_response(self, raw: str) -> list[dict]:
        import json
        text = raw.strip()
        if text.startswith("```"):
            lines = text.split("\n")
            text = "\n".join(lines[1:])
            if text.endswith("```"):
                text = text[:-3]
        return json.loads(text)
