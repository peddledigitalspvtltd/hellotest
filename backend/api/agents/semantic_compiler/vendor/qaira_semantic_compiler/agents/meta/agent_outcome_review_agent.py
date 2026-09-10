from qaira_semantic_compiler.core.context import AgentResult
from qaira_semantic_compiler.core.agent_contracts import RobustAgentMixin, AgentCapability
import json
class AgentOutcomeReviewAgent(RobustAgentMixin):
    name="AgentOutcomeReviewAgent"
    capability=AgentCapability(reads=["runtime/agent_results.jsonl"], writes=["reports/agent_outcome_review.json"], phase="quality")
    def __init__(self,ctx,logger): self.ctx=ctx; self.logger=logger
    def run(self):
        p=self.ctx.output/'runtime/agent_results.jsonl'; rows=[]
        if p.exists():
            for line in p.read_text(encoding='utf-8',errors='ignore').splitlines():
                try: rows.append(json.loads(line))
                except Exception: pass
        failed=[r for r in rows if r.get('status') in ('failed','failed_open')]
        partial=[r for r in rows if r.get('status')=='partial']
        low=[r for r in rows if float(r.get('confidence') or 0)<0.55 and r.get('status') not in ('skipped',)]
        report={"totalAgents":len(rows),"failedOrFailedOpen":len(failed),"partial":len(partial),"lowConfidence":len(low),"byPhase":phase_summary(rows),"failedAgents":[r.get('name') for r in failed],"lowConfidenceAgents":[r.get('name') for r in low],"recommendations":[]}
        if failed: report['recommendations'].append('Inspect runtime/agent_progress.jsonl and agents/<agent>/result.json before trusting generated tests.')
        if low: report['recommendations'].append('Use LLM review or custom org pattern config for low-confidence agents.')
        self.ctx.write_json('reports/agent_outcome_review.json',report)
        status='partial' if failed else 'success'
        return AgentResult(self.name,status,0.9,report,{"report":"reports/agent_outcome_review.json"})


def phase_summary(rows):
    out={}
    for r in rows:
        n=r.get("name","")
        if "Component" in n: phase="component"
        elif "Qsg" in n or "WebUi" in n or n in {"LocatorAgent","AccessibilityAgent","FormIntelligenceAgent"}: phase="webui"
        elif n.endswith("Agent"): phase="api"
        else: phase="meta"
        out.setdefault(phase,{"total":0,"success":0,"partial":0,"failed":0,"skipped":0})
        out[phase]["total"]+=1
        st=r.get("status")
        if st=="success": out[phase]["success"]+=1
        elif st=="partial": out[phase]["partial"]+=1
        elif st in {"failed","failed_open","blocked"}: out[phase]["failed"]+=1
        elif st=="skipped": out[phase]["skipped"]+=1
    return out
