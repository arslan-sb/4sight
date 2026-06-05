from __future__ import annotations
import json
import networkx as nx
from .models import Node, Edge, EdgeType


class GraphStore:
    def __init__(self) -> None:
        self.nodes: dict[str, Node] = {}
        self._edges: list[Edge] = []
        self._infl = nx.DiGraph()   # u -> v means "v depends on u"

    def add_node(self, node: Node) -> None:
        self.nodes[node.id] = node
        self._infl.add_node(node.id)

    def get_node(self, node_id: str) -> Node:
        return self.nodes[node_id]

    def _influence_edge(self, edge: Edge) -> tuple[str, str]:
        if edge.type == EdgeType.DECOMPOSITION:
            return (edge.dst, edge.src)   # child influences parent
        return (edge.src, edge.dst)       # source influences target

    def add_edge(self, src: str, dst: str, type: EdgeType) -> None:
        edge = Edge(src=src, dst=dst, type=type)
        u, v = self._influence_edge(edge)
        if u == v or nx.has_path(self._infl, v, u):
            raise ValueError(f"edge {src}->{dst} ({type.value}) would create a cycle")
        self._edges.append(edge)
        self._infl.add_edge(u, v)

    def children(self, node_id: str) -> list[str]:
        return [e.dst for e in self._edges if e.src == node_id and e.type == EdgeType.DECOMPOSITION]

    def parents(self, node_id: str) -> list[str]:
        return [e.src for e in self._edges if e.dst == node_id and e.type == EdgeType.DECOMPOSITION]

    def dependencies(self, node_id: str) -> list[str]:
        return [e.src for e in self._edges if e.dst == node_id and e.type == EdgeType.DEPENDENCY]

    def dependents(self, node_id: str) -> list[str]:
        return [e.dst for e in self._edges if e.src == node_id and e.type == EdgeType.DEPENDENCY]

    def has_children(self, node_id: str) -> bool:
        return len(self.children(node_id)) > 0

    def influence_predecessors(self, node_id: str) -> list[str]:
        return list(self._infl.predecessors(node_id))

    def closure(self, scope: list[str]) -> set[str]:
        seen, stack = set(scope), list(scope)
        while stack:
            n = stack.pop()
            for s in self._infl.successors(n):
                if s not in seen:
                    seen.add(s)
                    stack.append(s)
        return seen

    def topo_order(self, subset: set[str]) -> list[str]:
        return list(nx.topological_sort(self._infl.subgraph(subset)))

    def all_ids(self) -> list[str]:
        return list(self.nodes.keys())

    def snapshot(self, path: str) -> None:
        data = {"nodes": [n.model_dump(mode="json") for n in self.nodes.values()],
                "edges": [e.model_dump(mode="json") for e in self._edges]}
        with open(path, "w") as f:
            json.dump(data, f, indent=2, default=str)
