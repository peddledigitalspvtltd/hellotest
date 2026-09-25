from __future__ import annotations
import re, json
from pathlib import Path
from qaira_semantic_compiler.core.context import AgentResult

COND_PATTERNS = [
    ("role", re.compile(r"(?:user|auth|session)\.role\s*={0,2}=+\s*['\"]([^'\"]+)['\"]")),
    ("featureFlag", re.compile(r"(?:featureFlags|flags)\.([A-Za-z0-9_]+)\s*={0,2}=+\s*(true|false)")),
    ("emptyState", re.compile(r"([A-Za-z0-9_]+)\.length\s*={0,2}=+\s*0")),
]
SKIP={"node_modules",".git","dist","build",".next","coverage","qaira-output","qaira-learning"}
class MockStateAgent:
    name="MockStateAgent"
    def __init__(self, ctx, logger): self.ctx=ctx; self.logger=logger
    def run(self):
        reqs=[]
        for p in self.ctx.source.rglob("*"):
            if not p.is_file() or p.suffix.lower() not in [".ts",".tsx",".js",".jsx"]: continue
            if any(part in SKIP for part in p.parts): continue
            if p.stat().st_size>512000: continue
            text=p.read_text(encoding="utf-8",errors="ignore")
            rel=str(p.relative_to(self.ctx.source))
            for kind,pat in COND_PATTERNS:
                for m in pat.finditer(text):
                    line=text[:m.start()].count("\n")+1
                    reqs.append({"kind":kind,"value":m.group(1),"extra":m.group(2) if len(m.groups())>1 else None,"file":rel,"line":line,"mockRequirement": requirement(kind,m)})
        self.ctx.write_json("generated/mock_state_requirements.json", {"count":len(reqs),"requirements":reqs})
        return AgentResult(self.name,"success",0.82,{"requirements":len(reqs)}, {"artifact":"generated/mock_state_requirements.json"})
def requirement(kind,m):
    if kind=="role": return {"auth":{"user":{"role":m.group(1)}}}
    if kind=="featureFlag": return {"featureFlags":{m.group(1):m.group(2)=="true"}}
    if kind=="emptyState": return {"apiMock":{"resource":m.group(1),"payload":[]}}
    return {}
