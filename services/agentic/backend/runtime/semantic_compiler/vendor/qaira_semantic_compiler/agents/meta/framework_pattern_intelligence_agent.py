from __future__ import annotations
from qaira_semantic_compiler.core.context import AgentResult
from qaira_semantic_compiler.core.agent_contracts import RobustAgentMixin, AgentCapability
from qaira_semantic_compiler.core.framework_patterns import detect_repository_patterns

class FrameworkPatternIntelligenceAgent(RobustAgentMixin):
    name="FrameworkPatternIntelligenceAgent"
    capability=AgentCapability(writes=["reports/framework_pattern_intelligence.json","runtime/framework_patterns.json"], critical=True, phase="preflight")
    def __init__(self, ctx, logger): self.ctx=ctx; self.logger=logger
    def run(self):
        report=detect_repository_patterns(self.ctx.source, self.ctx.config)
        self.ctx.state["frameworkPatterns"]=report
        self.ctx.write_json("reports/framework_pattern_intelligence.json", report)
        self.ctx.write_json("runtime/framework_patterns.json", report)
        confidence=0.95
        if report.get("supportGaps"): confidence=0.82
        status="partial" if report.get("supportGaps") else "success"
        self.quality_signal(kind="framework_detection", frontend=len(report.get("frontendFrameworks",[])), backend=len(report.get("backendFrameworks",[])), gaps=report.get("supportGaps",[]))
        return AgentResult(self.name,status,confidence,{"frontendFrameworks":len(report.get("frontendFrameworks",[])),"backendFrameworks":len(report.get("backendFrameworks",[])),"supportGaps":len(report.get("supportGaps",[]))},{"report":"reports/framework_pattern_intelligence.json"})
