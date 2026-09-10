from qaira_semantic_compiler.core.context import AgentResult
from qaira_semantic_compiler.core.agent_contracts import RobustAgentMixin, AgentCapability
class PipelineRobustnessGateAgent(RobustAgentMixin):
    name="PipelineRobustnessGateAgent"
    capability=AgentCapability(reads=["reports/agent_outcome_review.json","runtime/execution_plan.json"], writes=["reports/pipeline_robustness_gate.json"], phase="quality")
    def __init__(self,ctx,logger): self.ctx=ctx; self.logger=logger
    def run(self):
        review=self.ctx.read_json('reports/agent_outcome_review.json',{}) or {}
        critical=self.ctx.read_json('reports/critical_path_review.json',{}) or {}
        hard_fail=review.get('failedOrFailedOpen',0)>0 and not bool((self.ctx.config.get('runtime') or {}).get('allow_unverified_artifacts', True))
        score=100 - review.get('failedOrFailedOpen',0)*20 - review.get('partial',0)*7 - review.get('lowConfidence',0)*5 - len(critical.get('missingCriticalArtifacts',[]))*10 - len(critical.get('consecutiveFailureChains',[]))*8
        score=max(0,score)
        report={"score":score,"status":"blocked" if hard_fail else ("partial" if score<85 else "success"),"review":review,"criticalPath":critical,"policy":{"allowUnverifiedArtifacts":bool((self.ctx.config.get('runtime') or {}).get('allow_unverified_artifacts', True))}}
        self.ctx.write_json('reports/pipeline_robustness_gate.json',report)
        return AgentResult(self.name,report['status'],score/100, {"score":score}, {"report":"reports/pipeline_robustness_gate.json"})
