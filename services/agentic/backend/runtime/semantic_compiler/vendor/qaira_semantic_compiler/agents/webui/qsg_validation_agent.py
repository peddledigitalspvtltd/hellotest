from __future__ import annotations
from qaira_semantic_compiler.core.context import AgentResult
from qaira_semantic_compiler.qsg import GraphKernel, NODE_TYPES, ALLOWED_EDGES
import json

class QsgValidationAgent:
    name = "QsgValidationAgent"
    def __init__(self, ctx, logger): self.ctx=ctx; self.logger=logger
    def run(self):
        kernel = GraphKernel(self.ctx.qsg_db_path())
        nodes = kernel.nodes(); edges = kernel.edges()
        node_types = {n["logical_id"]: n["type"] for n in nodes}
        issues = []
        duplicate_logical = []
        for n in nodes:
            if n.get("type") not in NODE_TYPES:
                issues.append({"kind":"invalid-node-type","logicalId":n.get("logical_id"),"type":n.get("type"),"severity":"critical"})
            if not n.get("physical_id"):
                issues.append({"kind":"missing-physical-id","logicalId":n.get("logical_id"),"severity":"medium"})
        for e in edges:
            st = node_types.get(e["source_logical_id"]); tt = node_types.get(e["target_logical_id"])
            allowed = ALLOWED_EDGES.get(e["type"], [])
            if not st or not tt:
                issues.append({"kind":"dangling-edge","edge":e,"severity":"critical"})
            elif (st, tt) not in allowed:
                issues.append({"kind":"invalid-edge-shape","edgeType":e["type"],"sourceType":st,"targetType":tt,"source":e["source_logical_id"],"target":e["target_logical_id"],"severity":"critical"})
        summary = kernel.summary(); kernel.close()
        report = {"status":"passed" if not any(i["severity"]=="critical" for i in issues) else "failed", "issueCount":len(issues), "issues":issues, "summary":summary}
        self.ctx.write_json("reports/qsg_validation_report.json", report)
        return AgentResult(self.name, "success" if report["status"]=="passed" else "partial", 0.95 if report["status"]=="passed" else 0.55, {"issues":len(issues), **summary}, {"report":"reports/qsg_validation_report.json"})
