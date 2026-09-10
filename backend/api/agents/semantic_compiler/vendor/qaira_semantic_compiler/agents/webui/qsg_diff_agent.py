from __future__ import annotations
from qaira_semantic_compiler.core.context import AgentResult
from qaira_semantic_compiler.qsg import GraphKernel
import json, hashlib

class QsgDiffAgent:
    name = "QsgDiffAgent"
    def __init__(self, ctx, logger): self.ctx=ctx; self.logger=logger
    def run(self):
        kernel = GraphKernel(self.ctx.qsg_db_path())
        current = kernel.dump_json(); kernel.close()
        prev_path = self.ctx.learning / "qsg" / "latest_graph_fingerprint.json"
        current_fp = fingerprint(current)
        added=[]; removed=[]; modified=[]
        if prev_path.exists():
            prev = json.loads(prev_path.read_text(encoding="utf-8"))
            prev_nodes = prev.get("nodes", {})
            cur_nodes = current_fp.get("nodes", {})
            added = sorted([k for k in cur_nodes if k not in prev_nodes])
            removed = sorted([k for k in prev_nodes if k not in cur_nodes])
            modified = sorted([k for k in cur_nodes if k in prev_nodes and cur_nodes[k] != prev_nodes[k]])
        self.ctx.write_learning_json("qsg/latest_graph_fingerprint.json", current_fp)
        report = {"addedNodes":added,"removedNodes":removed,"modifiedNodes":modified,"addedCount":len(added),"removedCount":len(removed),"modifiedCount":len(modified)}
        self.ctx.write_json("reports/qsg_diff_report.json", report)
        return AgentResult(self.name,"success",0.9,{"added":len(added),"removed":len(removed),"modified":len(modified)}, {"report":"reports/qsg_diff_report.json"})

def fingerprint(graph):
    nodes = {}
    for n in graph.get("nodes", []):
        logical = n.get("logical_id")
        payload = {"type":n.get("type"),"physical_id":n.get("physical_id"),"metadata":n.get("metadata")}
        nodes[logical] = hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()
    return {"nodes": nodes}
