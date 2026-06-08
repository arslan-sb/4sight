from __future__ import annotations
import sqlite3
from .models import Node, NodeKind, EdgeType
from .graph_store import GraphStore


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS nodes (
            id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL,
            description TEXT DEFAULT '', trigger_threshold REAL DEFAULT 25.0,
            delta_accumulator REAL DEFAULT 0.0
        );
        CREATE TABLE IF NOT EXISTS edges (
            src TEXT NOT NULL, dst TEXT NOT NULL, type TEXT NOT NULL,
            PRIMARY KEY (src, dst, type)
        );
        CREATE TABLE IF NOT EXISTS assessments (
            node_id TEXT NOT NULL, version INTEGER NOT NULL,
            raw_json TEXT NOT NULL, PRIMARY KEY (node_id, version)
        );
        CREATE TABLE IF NOT EXISTS reports (
            node_id TEXT PRIMARY KEY, raw_json TEXT NOT NULL
        );
    """)
    conn.commit()


def save_graph(store: GraphStore, conn: sqlite3.Connection) -> None:
    conn.execute("DELETE FROM nodes")
    conn.execute("DELETE FROM edges")
    for nid, node in store.nodes.items():
        conn.execute(
            "INSERT OR REPLACE INTO nodes(id, kind, title, description, "
            "trigger_threshold, delta_accumulator) VALUES(?,?,?,?,?,?)",
            (node.id, node.kind.value, node.title, node.description,
             node.trigger_threshold, node.delta_accumulator))
    for e in store._edges:
        conn.execute("INSERT OR REPLACE INTO edges(src, dst, type) VALUES(?,?,?)",
                     (e.src, e.dst, e.type.value))
    conn.commit()


def load_graph(conn: sqlite3.Connection) -> GraphStore:
    store = GraphStore()
    rows = conn.execute(
        "SELECT id, kind, title, description, trigger_threshold, "
        "delta_accumulator FROM nodes"
    ).fetchall()
    for row in rows:
        nid, kind, title, desc, threshold, accumulator = row
        node = Node(id=nid, kind=NodeKind(kind), title=title,
                    description=desc or "",
                    trigger_threshold=threshold or 25.0,
                    delta_accumulator=accumulator or 0.0)
        store.add_node(node)
    for row in conn.execute("SELECT src, dst, type FROM edges").fetchall():
        store.add_edge(row[0], row[1], EdgeType(row[2]))
    return store
