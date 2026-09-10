from __future__ import annotations
from qaira_semantic_compiler.core.context import AgentResult
from qaira_semantic_compiler.core.agent_contracts import RobustAgentMixin, AgentCapability
import json

CRITICAL_ARTIFACTS={
  "api":["generated/postman_collection.json","generated/openapi.json"],
  "webui":["generated/html_page_locators.json","generated/webui/index.json","generated/webui/object_repository_import_payload.json"],
  "component":["generated/components/component_test_contracts.json","generated/components/component_playwright_tests.json"],
}

class CriticalPathReviewAgent(RobustAgentMixin):
    name="CriticalPathReviewAgent"
    capability=AgentCapability(reads=["runtime/agent_results.jsonl","runtime/execution_plan.json","reports/framework_pattern_intelligence.json"], writes=["reports/critical_path_review.json","runtime/critical_path_review.json"], critical=True, phase="quality")
    def __init__(self, ctx, logger): self.ctx=ctx; self.logger=logger
    def run(self):
        rows=[]; p=self.ctx.output/"runtime/agent_results.jsonl"
        if p.exists():
            for line in p.read_text(encoding="utf-8",errors="ignore").splitlines():
                try: rows.append(json.loads(line))
                except Exception: pass
        plan=self.ctx.read_json("runtime/execution_plan.json",{}) or {}
        test_type=plan.get("resolvedTestType") or self.ctx.state.get("testType") or "auto"
        phases=phase_map(rows)
        chain_issues=[]
        for phase,items in phases.items():
            streak=[]
            for r in items:
                if r.get("status") in {"failed","failed_open","partial","blocked"}: streak.append(r.get("name"))
                else:
                    if len(streak)>=2: chain_issues.append({"phase":phase,"consecutiveAgents":streak[:]})
                    streak=[]
            if len(streak)>=2: chain_issues.append({"phase":phase,"consecutiveAgents":streak[:]})
        expected=[]
        if test_type in {"api","both","all"}: expected += CRITICAL_ARTIFACTS["api"]
        if test_type in {"webui","both","all"}: expected += CRITICAL_ARTIFACTS["webui"]
        if test_type in {"component","all"}: expected += CRITICAL_ARTIFACTS["component"]
        missing=[rel for rel in expected if not (self.ctx.output/rel).exists()]
        low=[r for r in rows if float(r.get("confidence") or 0)<0.55 and r.get("status") not in {"skipped"}]
        framework=self.ctx.read_json("reports/framework_pattern_intelligence.json",{}) or {}
        score=max(0,100-len(chain_issues)*15-len(missing)*18-len(low)*5-len(framework.get("supportGaps",[]))*3)
        status="blocked" if missing and not bool((self.ctx.config.get("runtime") or {}).get("allow_missing_critical_artifacts", False)) else ("partial" if score<85 or chain_issues else "success")
        report={"status":status,"score":score,"testType":test_type,"criticalArtifactsExpected":expected,"missingCriticalArtifacts":missing,"consecutiveFailureChains":chain_issues,"lowConfidenceAgents":[r.get("name") for r in low],"frameworkSupportGaps":framework.get("supportGaps",[]),"recommendations":recommendations(missing,chain_issues,framework)}
        self.ctx.write_json("reports/critical_path_review.json",report)
        self.ctx.write_json("runtime/critical_path_review.json",report)
        self.quality_signal(kind="critical_path", status=status, score=score, missing=missing, chainIssues=len(chain_issues))
        return AgentResult(self.name,status,score/100,{"score":score,"missingCriticalArtifacts":len(missing),"failureChains":len(chain_issues)},{"report":"reports/critical_path_review.json"})

def phase_map(rows):
    out={}
    for r in rows:
        name=r.get("name","")
        if name.startswith("Component") or "Component" in name: phase="component"
        elif name in {"QsgBuildAgent","LocatorAgent","AccessibilityAgent","WebUiArtifactPackagingAgent"} or "Qsg" in name or "WebUi" in name: phase="webui"
        elif name.endswith("Agent"): phase="api"
        else: phase="meta"
        out.setdefault(phase,[]).append(r)
    return out

def recommendations(missing,chains,framework):
    rec=[]
    if missing: rec.append("Do not import generated assets until missing critical artifacts are fixed or intentionally waived.")
    if chains: rec.append("Inspect first failing agent in each consecutive chain; downstream agents are likely symptoms.")
    if framework.get("supportGaps"): rec.append("Add config/custom_patterns for organization route/page/design-system wrappers or enable runtime verification/codegen.")
    return rec
