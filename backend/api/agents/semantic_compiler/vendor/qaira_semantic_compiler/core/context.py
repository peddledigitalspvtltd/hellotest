from __future__ import annotations
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Dict, List
import json, datetime, hashlib, time, os


def now() -> str:
    return datetime.datetime.utcnow().isoformat() + "Z"


def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", errors="ignore")).hexdigest()


@dataclass
class Evidence:
    source: str
    detail: Dict[str, Any] = field(default_factory=dict)
    confidence: float = 1.0


@dataclass
class GeneratedArtifact:
    path: str
    kind: str
    description: str = ""
    count: int | None = None


@dataclass
class AgentResult:
    name: str
    status: str = "success"  # success | partial | skipped | blocked | failed_open | failed
    confidence: float = 0.0
    metrics: Dict[str, Any] = field(default_factory=dict)
    outputs: Dict[str, Any] = field(default_factory=dict)
    errors: List[Dict[str, Any]] = field(default_factory=list)
    artifacts: List[Dict[str, Any]] = field(default_factory=list)
    graph_references: List[str] = field(default_factory=list)
    evidence: List[Dict[str, Any]] = field(default_factory=list)
    recommendations: List[Dict[str, Any]] = field(default_factory=list)
    started_at: str = field(default_factory=now)
    ended_at: str = ""

    def finish(self):
        self.ended_at = now()
        return self

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class RunContext:
    source: Path
    output: Path
    learning: Path
    config: Dict[str, Any]
    state: Dict[str, Any] = field(default_factory=dict)
    results: List[AgentResult] = field(default_factory=list)

    def out(self, rel: str) -> Path:
        p = self.output / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        return p

    def write_json(self, rel: str, obj: Any):
        p = self.out(rel)
        p.write_text(json.dumps(obj, indent=2, default=str), encoding="utf-8")
        return p

    def append_jsonl(self, rel: str, obj: Any):
        p = self.out(rel)
        with p.open("a", encoding="utf-8") as f:
            f.write(json.dumps(obj, default=str) + "\n")
        return p

    def read_json(self, rel: str, default=None):
        p = self.output / rel
        if not p.exists():
            return default
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            return default

    def write_text(self, rel: str, text: str):
        p = self.out(rel)
        p.write_text(text, encoding="utf-8")
        return p

    def learning_path(self, rel: str) -> Path:
        p = self.learning / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        return p

    def write_learning_json(self, rel: str, obj: Any):
        p = self.learning_path(rel)
        p.write_text(json.dumps(obj, indent=2, default=str), encoding="utf-8")
        return p

    def qsg_db_path(self) -> Path:
        return self.output / (self.config.get("qsg", {}).get("db_path", "graph/qsg.sqlite"))

    def has_openai_key(self) -> bool:
        key_env = (self.config.get("llm") or {}).get("api_key_env", "OPENAI_API_KEY")
        return bool(os.environ.get(key_env) or os.environ.get("OPENAI_API_KEY"))
