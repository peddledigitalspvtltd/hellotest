from qaira_semantic_compiler.core.context import AgentResult
from qaira_semantic_compiler.core.agent_contracts import RobustAgentMixin, AgentCapability
import json, hashlib
class SelfLearningMemoryAgent(RobustAgentMixin):
    name="SelfLearningMemoryAgent"
    capability=AgentCapability(reads=["runtime/agent_outcomes.jsonl","reports/agent_outcome_review.json"], writes=["runtime/self_learning_summary.json"], phase="learning")
    def __init__(self,ctx,logger): self.ctx=ctx; self.logger=logger
    def run(self):
        outcomes=[]; p=self.ctx.output/'runtime/agent_outcomes.jsonl'
        if not p.exists(): p=self.ctx.output/'runtime/agent_results.jsonl'
        if p.exists():
            for line in p.read_text(encoding='utf-8',errors='ignore').splitlines():
                try: outcomes.append(json.loads(line))
                except Exception: pass
        lessons=[]
        for o in outcomes:
            if o.get('status') in ('partial','failed_open','failed'):
                lessons.append({"agent":o.get('agent'),"status":o.get('status'),"inputFingerprint":o.get('inputFingerprint'),"suggestion":"prefer deterministic fallback, preserve evidence, and add parser/config mapping if repeated"})
        summary={"outcomes":len(outcomes),"lessons":lessons[-100:],"memoryVersion":"2026.07.08-pro-agentic"}
        self.ctx.write_json('runtime/self_learning_summary.json',summary)
        self.ctx.write_learning_json('pipeline/self_learning_summary.latest.json',summary)
        return AgentResult(self.name,"success",0.88,{"lessons":len(lessons)}, {"summary":"runtime/self_learning_summary.json"})
