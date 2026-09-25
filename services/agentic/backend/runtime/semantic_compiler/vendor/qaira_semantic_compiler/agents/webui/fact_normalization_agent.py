from __future__ import annotations
from qaira_semantic_compiler.core.context import AgentResult
from qaira_semantic_compiler.qsg import GraphKernel
from qaira_semantic_compiler.qsg.normalization import normalize_facts, safe_str, safe_list
import json

class FactNormalizationAgent:
    """Pre-analyzer guardrail: verifies and exports normalized parser facts.

    It intentionally does not mutate Base QSG. Analyzers consume normalized views so
    list-valued parser facts cannot crash accessibility/form/locator logic.
    """
    name = "FactNormalizationAgent"
    def __init__(self, ctx, logger):
        self.ctx = ctx; self.logger = logger
    def run(self):
        kernel = GraphKernel(self.ctx.output / (self.ctx.config.get("qsg", {}).get("db_path", "graph/qsg.sqlite")))
        normalized = []
        conversions = []
        for n in kernel.nodes():
            logical = n["logical_id"]
            raw = kernel.facts_flat(logical)
            nf = normalize_facts(raw)
            if raw != nf:
                conversions.append({"logicalId": logical, "type": n.get("type"), "changedKeys": sorted(set(raw.keys()) | set(nf.keys()))})
            if n.get("type") in {"UI_ELEMENT", "BUSINESS_FIELD", "VALIDATION_RULE", "ROUTE_ENTRY", "UI_CONTAINER"}:
                normalized.append({"logicalId": logical, "type": n.get("type"), "facts": nf})
        kernel.close()
        report = {"normalizedNodeCount": len(normalized), "conversionCount": len(conversions), "conversionsSample": conversions[:200], "artifact": "reports/qsg_normalized_facts.json"}
        self.ctx.write_json("reports/qsg_normalized_facts.json", {"nodes": normalized})
        self.ctx.write_json("reports/qsg_fact_normalization_report.json", report)
        self.ctx.state["factsNormalized"] = True
        return AgentResult(self.name, "success", 0.96, report, {"report":"reports/qsg_fact_normalization_report.json", "facts":"reports/qsg_normalized_facts.json"})
