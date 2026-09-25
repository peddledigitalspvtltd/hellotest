from __future__ import annotations
import sqlite3, json, hashlib, datetime, re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

ONTOLOGY_VERSION = "1.0.0"
NODE_TYPES = {
    "ROUTE_ENTRY","UI_CONTAINER","UI_ELEMENT","FIELD_ALIAS","STATE_MUTATION","DATA_RESOURCE",
    "BUSINESS_ENTITY","BUSINESS_FIELD","VALIDATION_RULE","API_ENDPOINT","BACKEND_CONTROLLER",
    "SERVICE_FUNCTION","DATABASE_MODEL","DATABASE_COLUMN","TEST_CASE"
}
ALLOWED_EDGES = {
    "HAS_FIELD": [("BUSINESS_ENTITY", "BUSINESS_FIELD")],
    "HAS_RULE": [("BUSINESS_FIELD", "VALIDATION_RULE"), ("BUSINESS_ENTITY", "VALIDATION_RULE")],
    "BINDS_FIELD": [("UI_ELEMENT", "BUSINESS_FIELD")],
    "USES_FIELD_ALIAS": [("UI_ELEMENT", "FIELD_ALIAS")],
    "RESOLVES_TO": [("FIELD_ALIAS", "BUSINESS_FIELD")],
    "TRIGGERS": [("UI_ELEMENT", "STATE_MUTATION")],
    "CALLS_ENDPOINT": [("STATE_MUTATION", "API_ENDPOINT")],
    "USES_ENTITY": [("API_ENDPOINT", "BUSINESS_ENTITY")],
    "CONTAINS": [("ROUTE_ENTRY", "UI_CONTAINER"), ("UI_CONTAINER", "UI_CONTAINER"), ("UI_CONTAINER", "UI_ELEMENT")],
    "ROUTES_TO": [("ROUTE_ENTRY", "API_ENDPOINT"), ("API_ENDPOINT", "BACKEND_CONTROLLER")],
    "CALLS_FUNCTION": [("BACKEND_CONTROLLER", "SERVICE_FUNCTION"), ("STATE_MUTATION", "SERVICE_FUNCTION")],
    "MUTATES_DATA": [("SERVICE_FUNCTION", "DATA_RESOURCE"), ("STATE_MUTATION", "DATA_RESOURCE")],
    "MAPS_FIELD": [("BUSINESS_FIELD", "DATABASE_COLUMN"), ("UI_ELEMENT", "DATABASE_COLUMN")],
    "DEPENDS_ON": [("TEST_CASE", "UI_ELEMENT"), ("TEST_CASE", "API_ENDPOINT"), ("UI_ELEMENT", "DATA_RESOURCE")],
    "REQUIRES_ROLE": [("UI_ELEMENT", "BUSINESS_ENTITY"), ("ROUTE_ENTRY", "BUSINESS_ENTITY")],
    "REQUIRES_FLAG": [("UI_ELEMENT", "DATA_RESOURCE"), ("ROUTE_ENTRY", "DATA_RESOURCE")],
    "USES_QUERY": [("UI_ELEMENT", "DATA_RESOURCE"), ("UI_CONTAINER", "DATA_RESOURCE")],
}

def now() -> str:
    return datetime.datetime.utcnow().isoformat() + "Z"

def stable_id(*parts: Any) -> str:
    raw = "::".join(str(p) for p in parts if p is not None)
    return hashlib.sha256(raw.encode("utf-8", errors="ignore")).hexdigest()

def safe_slug(text: str) -> str:
    text = text or "unknown"
    text = re.sub(r"[^A-Za-z0-9_\-./:]+", "-", text).strip("-")
    return text[:180] or "unknown"

class OntologyError(ValueError):
    pass

class GraphKernel:
    def __init__(self, db_path: Path, ontology_version: str = ONTOLOGY_VERSION):
        self.db_path = Path(db_path)
        self.ontology_version = ontology_version
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(self.db_path))
        self.conn.row_factory = sqlite3.Row
        self._setup()
        self.current_snapshot_id: Optional[str] = None
        self.current_tx_id: Optional[str] = None

    def close(self):
        self.conn.close()

    def _setup(self):
        c = self.conn.cursor()
        c.execute("PRAGMA journal_mode = WAL")
        c.execute("PRAGMA synchronous = NORMAL")
        c.execute("PRAGMA foreign_keys = ON")
        c.execute("PRAGMA busy_timeout = 5000")
        c.executescript("""
        CREATE TABLE IF NOT EXISTS nodes (
          id TEXT PRIMARY KEY,
          physical_id TEXT,
          logical_id TEXT UNIQUE NOT NULL,
          type TEXT NOT NULL,
          ontology_version TEXT NOT NULL,
          metadata_json TEXT,
          lifecycle TEXT,
          snapshot_id TEXT,
          created_at TEXT,
          updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS edges (
          id TEXT PRIMARY KEY,
          source_logical_id TEXT NOT NULL,
          target_logical_id TEXT NOT NULL,
          type TEXT NOT NULL,
          confidence_score REAL DEFAULT 1.0,
          metadata_json TEXT,
          lifecycle TEXT,
          snapshot_id TEXT,
          created_at TEXT,
          updated_at TEXT,
          UNIQUE(source_logical_id, target_logical_id, type)
        );
        CREATE TABLE IF NOT EXISTS facts (
          id TEXT PRIMARY KEY,
          owner_logical_id TEXT NOT NULL,
          property TEXT NOT NULL,
          value_json TEXT,
          evidence_json TEXT,
          confidence_score REAL DEFAULT 1.0,
          snapshot_id TEXT,
          UNIQUE(owner_logical_id, property, value_json)
        );
        CREATE TABLE IF NOT EXISTS transactions (
          id TEXT PRIMARY KEY,
          commit_sha TEXT,
          status TEXT,
          started_at TEXT,
          committed_at TEXT
        );
        CREATE TABLE IF NOT EXISTS snapshots (
          id TEXT PRIMARY KEY,
          repository_id TEXT,
          commit_sha TEXT,
          ontology_version TEXT,
          created_at TEXT
        );
        CREATE TABLE IF NOT EXISTS overlays (
          id TEXT PRIMARY KEY,
          snapshot_id TEXT,
          overlay_type TEXT,
          target_logical_id TEXT,
          payload_json TEXT,
          created_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_nodes_logical_id ON nodes(logical_id);
        CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
        CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_logical_id);
        CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_logical_id);
        CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(type);
        CREATE INDEX IF NOT EXISTS idx_facts_owner ON facts(owner_logical_id);
        CREATE INDEX IF NOT EXISTS idx_facts_property ON facts(property);
        CREATE INDEX IF NOT EXISTS idx_overlays_target ON overlays(target_logical_id);
        """)
        self.conn.commit()

    def begin_transaction(self, commit_sha: str = "local", repository_id: str = "local-workspace") -> str:
        tx_id = "tx://" + stable_id(repository_id, commit_sha, now())
        snapshot_id = "snapshot://" + stable_id(repository_id, commit_sha, tx_id)
        self.conn.execute("INSERT OR REPLACE INTO transactions(id,commit_sha,status,started_at) VALUES(?,?,?,?)", (tx_id, commit_sha, "started", now()))
        self.conn.execute("INSERT OR REPLACE INTO snapshots(id,repository_id,commit_sha,ontology_version,created_at) VALUES(?,?,?,?,?)", (snapshot_id, repository_id, commit_sha, self.ontology_version, now()))
        self.conn.commit()
        self.current_tx_id = tx_id
        self.current_snapshot_id = snapshot_id
        return tx_id

    def commit(self, tx_id: Optional[str] = None):
        self.conn.execute("UPDATE transactions SET status=?, committed_at=? WHERE id=?", ("committed", now(), tx_id or self.current_tx_id))
        self.conn.commit()

    def rollback(self, tx_id: Optional[str] = None):
        self.conn.execute("UPDATE transactions SET status=? WHERE id=?", ("rolled_back", tx_id or self.current_tx_id))
        self.conn.commit()

    def validate_node(self, node: Dict[str, Any]):
        t = node.get("type")
        if t not in NODE_TYPES:
            raise OntologyError(f"Invalid node type {t}")
        if not node.get("logical_id"):
            raise OntologyError("Node logical_id is required")

    def node_type(self, logical_id: str) -> Optional[str]:
        row = self.conn.execute("SELECT type FROM nodes WHERE logical_id=?", (logical_id,)).fetchone()
        return row["type"] if row else None

    def validate_edge(self, edge: Dict[str, Any]):
        et = edge.get("type")
        src = edge.get("source_logical_id")
        tgt = edge.get("target_logical_id")
        if et not in ALLOWED_EDGES:
            raise OntologyError(f"Invalid edge type {et}")
        st = self.node_type(src)
        tt = self.node_type(tgt)
        if not st or not tt:
            raise OntologyError(f"Edge references unknown nodes: {src} -> {tgt}")
        if (st, tt) not in ALLOWED_EDGES[et]:
            raise OntologyError(f"Invalid edge {et}: {st} -> {tt}")

    def upsert_node(self, node: Dict[str, Any]):
        self.validate_node(node)
        logical = node["logical_id"]
        physical = node.get("physical_id") or "sha256:" + stable_id(logical)
        metadata = json.dumps(node.get("metadata", {}), default=str)
        sid = node.get("snapshot_id") or self.current_snapshot_id
        node_id = node.get("id") or "node://" + stable_id(logical)
        created = now()
        self.conn.execute("""
        INSERT INTO nodes(id,physical_id,logical_id,type,ontology_version,metadata_json,lifecycle,snapshot_id,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(logical_id) DO UPDATE SET
          physical_id=excluded.physical_id, type=excluded.type, metadata_json=excluded.metadata_json,
          lifecycle=excluded.lifecycle, snapshot_id=excluded.snapshot_id, updated_at=excluded.updated_at
        """, (node_id, physical, logical, node["type"], self.ontology_version, metadata, node.get("lifecycle", "active"), sid, created, created))

    def upsert_edge(self, edge: Dict[str, Any]):
        self.validate_edge(edge)
        sid = edge.get("snapshot_id") or self.current_snapshot_id
        eid = edge.get("id") or "edge://" + stable_id(edge["source_logical_id"], edge["type"], edge["target_logical_id"])
        metadata = json.dumps(edge.get("metadata", {}), default=str)
        ts = now()
        self.conn.execute("""
        INSERT INTO edges(id,source_logical_id,target_logical_id,type,confidence_score,metadata_json,lifecycle,snapshot_id,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(source_logical_id,target_logical_id,type) DO UPDATE SET
          confidence_score=excluded.confidence_score, metadata_json=excluded.metadata_json,
          lifecycle=excluded.lifecycle, snapshot_id=excluded.snapshot_id, updated_at=excluded.updated_at
        """, (eid, edge["source_logical_id"], edge["target_logical_id"], edge["type"], float(edge.get("confidence_score", 1.0)), metadata, edge.get("lifecycle", "active"), sid, ts, ts))

    def add_fact(self, fact: Dict[str, Any]):
        fid = fact.get("id") or "fact://" + stable_id(fact.get("owner_logical_id"), fact.get("property"), json.dumps(fact.get("value"), sort_keys=True, default=str))
        self.conn.execute("""
        INSERT OR IGNORE INTO facts(id,owner_logical_id,property,value_json,evidence_json,confidence_score,snapshot_id)
        VALUES(?,?,?,?,?,?,?)
        """, (fid, fact["owner_logical_id"], fact["property"], json.dumps(fact.get("value"), default=str), json.dumps(fact.get("evidence", {}), default=str), float(fact.get("confidence_score", 1.0)), fact.get("snapshot_id") or self.current_snapshot_id))

    def add_overlay(self, overlay_type: str, target_logical_id: str, payload: Dict[str, Any]):
        oid = "overlay://" + stable_id(overlay_type, target_logical_id, json.dumps(payload, sort_keys=True, default=str), now())
        self.conn.execute("INSERT INTO overlays(id,snapshot_id,overlay_type,target_logical_id,payload_json,created_at) VALUES(?,?,?,?,?,?)", (oid, self.current_snapshot_id, overlay_type, target_logical_id, json.dumps(payload, default=str), now()))

    def finalize(self):
        self.conn.commit()

    def nodes(self, type_: Optional[str] = None) -> List[Dict[str, Any]]:
        sql = "SELECT * FROM nodes" + (" WHERE type=?" if type_ else "")
        rows = self.conn.execute(sql, (type_,) if type_ else ()).fetchall()
        return [self._row_to_dict(r) for r in rows]

    def edges(self, type_: Optional[str] = None) -> List[Dict[str, Any]]:
        sql = "SELECT * FROM edges" + (" WHERE type=?" if type_ else "")
        rows = self.conn.execute(sql, (type_,) if type_ else ()).fetchall()
        return [self._row_to_dict(r) for r in rows]

    def facts_for(self, logical_id: str) -> Dict[str, List[Any]]:
        rows = self.conn.execute("SELECT property,value_json,evidence_json,confidence_score FROM facts WHERE owner_logical_id=?", (logical_id,)).fetchall()
        out: Dict[str, List[Any]] = {}
        for r in rows:
            try: value = json.loads(r["value_json"])
            except Exception: value = r["value_json"]
            out.setdefault(r["property"], []).append(value)
        return out

    def facts_flat(self, logical_id: str) -> Dict[str, Any]:
        raw = self.facts_for(logical_id)
        return {k: (v[-1] if len(v) == 1 else v) for k, v in raw.items()}

    def dump_json(self) -> Dict[str, Any]:
        return {"nodes": self.nodes(), "edges": self.edges(), "facts": self._facts(), "snapshots": self._table("snapshots")}

    def summary(self) -> Dict[str, Any]:
        by_type = {r["type"]: r["c"] for r in self.conn.execute("SELECT type, COUNT(*) c FROM nodes GROUP BY type")}
        by_edge = {r["type"]: r["c"] for r in self.conn.execute("SELECT type, COUNT(*) c FROM edges GROUP BY type")}
        return {"dbPath": str(self.db_path), "nodesByType": by_type, "edgesByType": by_edge, "nodeCount": sum(by_type.values()), "edgeCount": sum(by_edge.values())}

    def _facts(self):
        return self._table("facts")

    def _table(self, name: str):
        return [self._row_to_dict(r) for r in self.conn.execute(f"SELECT * FROM {name}").fetchall()]

    def _row_to_dict(self, r):
        d = dict(r)
        for k in ["metadata_json", "value_json", "evidence_json", "payload_json"]:
            if k in d and d[k]:
                try: d[k.replace("_json", "")] = json.loads(d[k])
                except Exception: pass
        return d

class GraphEmitter:
    def __init__(self, kernel: GraphKernel):
        self.kernel = kernel
        self.rejected: List[Dict[str, Any]] = []
    def node(self, node: Dict[str, Any]):
        try: self.kernel.upsert_node(node)
        except Exception as e: self.rejected.append({"kind": "node", "item": node, "error": str(e)})
    def edge(self, edge: Dict[str, Any]):
        try: self.kernel.upsert_edge(edge)
        except Exception as e: self.rejected.append({"kind": "edge", "item": edge, "error": str(e)})
    def fact(self, fact: Dict[str, Any]):
        try: self.kernel.add_fact(fact)
        except Exception as e: self.rejected.append({"kind": "fact", "item": fact, "error": str(e)})
