from __future__ import annotations
import subprocess, json
from qaira_semantic_compiler.core.context import AgentResult
from qaira_semantic_compiler.qsg import GraphKernel

class ImpactAnalysisAgent:
    name="ImpactAnalysisAgent"
    def __init__(self, ctx, logger): self.ctx=ctx; self.logger=logger
    def run(self):
        changed=changed_files(self.ctx.source)
        kernel=GraphKernel(self.ctx.output/(self.ctx.config.get("qsg",{}).get("db_path","graph/qsg.sqlite")))
        impacted=[]
        for n in kernel.nodes():
            meta=n.get("metadata") or json.loads(n.get("metadata_json") or "{}")
            file=meta.get("file")
            if file and (file in changed or any(file.endswith(c) or c.endswith(file) for c in changed)):
                impacted.append({"logicalId":n["logical_id"],"type":n["type"],"file":file,"reason":"changed-file"})
        kernel.close()
        self.ctx.write_json("reports/impact_report.json", {"changedFiles":changed,"impactedNodes":impacted,"impactedCount":len(impacted)})
        return AgentResult(self.name,"success",0.8,{"changedFiles":len(changed),"impacted":len(impacted)}, {"report":"reports/impact_report.json"})
def changed_files(path):
    try:
        p=subprocess.run(["git","-C",str(path),"diff","--name-only","HEAD"],capture_output=True,text=True,timeout=5)
        if p.returncode==0: return [x for x in p.stdout.splitlines() if x.strip()]
    except Exception: pass
    return []
