from __future__ import annotations
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional
import hashlib, json, time, re

STATUS_ORDER = {"success": 5, "partial": 4, "skipped": 3, "blocked": 2, "failed_open": 1, "failed": 0}

@dataclass
class AgentCapability:
    reads: List[str] = field(default_factory=list)
    writes: List[str] = field(default_factory=list)
    fallback_reads: List[str] = field(default_factory=list)
    critical: bool = False
    phase: str = "semantic"
    contract_version: str = "2026.07.08"

@dataclass
class ArtifactCheck:
    path: str
    exists: bool
    count: Optional[int] = None
    reason: str = ""

@dataclass
class AgentOutcome:
    agent: str
    status: str
    confidence: float
    seconds: float
    attempt: int
    input_fingerprint: str
    output_fingerprint: str
    artifact_checks: List[Dict[str, Any]] = field(default_factory=list)
    fallback_used: bool = False
    fallback_reason: str = ""
    quality_signals: Dict[str, Any] = field(default_factory=dict)
    error_class: str = ""

class RobustAgentMixin:
    """Small SOLID-oriented contract mixin for QAira agents.

    Agents keep one responsibility: discover, enrich, generate, validate, or package.
    Cross-cutting concerns such as artifact checks, fingerprints and fallback selection stay here.
    """
    capability = AgentCapability()

    def expected_outputs(self) -> List[str]:
        return list(getattr(self, "capability", AgentCapability()).writes or [])

    def input_fingerprint(self) -> str:
        cap = getattr(self, "capability", AgentCapability())
        h = hashlib.sha256()
        for rel in cap.reads + cap.fallback_reads:
            p = self.ctx.output / rel
            if p.exists() and p.is_file():
                try: h.update(rel.encode()); h.update(p.read_bytes()[:2_000_000])
                except Exception: pass
        return h.hexdigest()

    def output_fingerprint(self) -> str:
        h = hashlib.sha256()
        for rel in self.expected_outputs():
            p = self.ctx.output / rel
            if p.exists() and p.is_file():
                try: h.update(rel.encode()); h.update(p.read_bytes()[:2_000_000])
                except Exception: pass
        return h.hexdigest()

    def artifact_checks(self) -> List[Dict[str, Any]]:
        checks=[]
        for rel in self.expected_outputs():
            p=self.ctx.output/rel
            check={"path":rel,"exists":p.exists()}
            if p.exists() and p.is_file() and p.suffix.lower()=='.json':
                try:
                    data=json.loads(p.read_text(encoding='utf-8'))
                    if isinstance(data, list): check['count']=len(data)
                    elif isinstance(data, dict): check['topLevelKeys']=len(data.keys())
                except Exception as e: check['reason']=f'json_parse_warning:{e}'
            checks.append(check)
        return checks

    def safe_read_json(self, rel: str, default=None):
        return self.ctx.read_json(rel, default)

    def quality_signal(self, **kwargs):
        self.ctx.append_jsonl('runtime/quality_signals.jsonl', {"agent": getattr(self,'name',self.__class__.__name__), **kwargs})


def fingerprint_obj(obj: Any) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, default=str).encode()).hexdigest()

BAD_LOCATOR_PATTERNS = [
    re.compile(r"set[A-Z]\w*\("), re.compile(r"handle[A-Z]\w*\("), re.compile(r"event\."),
    re.compile(r"\$\{"), re.compile(r"=>"), re.compile(r"\bcurrent\)"), re.compile(r"^getByText\('(?:\d+|::|\)\)|,|;)'\)")
]

def locator_risk(locator: str) -> tuple[str, float, list[str]]:
    locator = locator or ""
    reasons=[]
    if "getByTestId" in locator: return "low", .98, []
    if "getByRole" in locator and "name:" in locator: base=("low", .92)
    elif "getByLabel" in locator: base=("low", .90)
    elif "getByPlaceholder" in locator: base=("medium", .82)
    elif "getByText" in locator: base=("medium", .70)
    elif "locator(" in locator and ("nth" in locator or "nth-child" in locator or "xpath" in locator.lower()): base=("high", .35)
    else: base=("medium", .60)
    for pat in BAD_LOCATOR_PATTERNS:
        if pat.search(locator): reasons.append(f"bad_expression:{pat.pattern}")
    risk, score = base
    if reasons:
        risk='high'; score=min(score, .38)
    return risk, score, reasons
