from qaira_semantic_compiler.core.context import AgentResult
from qaira_semantic_compiler.core.agent_contracts import RobustAgentMixin, AgentCapability, locator_risk
class ComponentSemanticQualityGateAgent(RobustAgentMixin):
    name="ComponentSemanticQualityGateAgent"
    capability=AgentCapability(reads=["generated/components/component_test_contracts.json","generated/components/component_ranked_locators.json"], writes=["reports/component_semantic_quality_gate.json"], critical=False, phase="component-quality")
    def __init__(self,ctx,logger): self.ctx=ctx; self.logger=logger
    def run(self):
        contracts_payload=self.ctx.read_json('generated/components/component_test_contracts.json',[]) or []
        contracts=contracts_payload.get('contracts',[]) if isinstance(contracts_payload,dict) else contracts_payload
        locs_payload=self.ctx.read_json('generated/components/component_ranked_locators.json',[]) or []
        locs=locs_payload.get('locators',[]) if isinstance(locs_payload,dict) else locs_payload
        bad=[]; total=0
        def scan(item, owner):
            nonlocal total,bad
            loc=item.get('locator') or item.get('primaryLocator') or ''
            if loc:
                total+=1; risk,score,reasons=locator_risk(loc)
                if risk=='high': bad.append({"owner":owner,"locator":loc,"risk":risk,"score":score,"reasons":reasons})
        for c in contracts:
            for e in c.get('elements',[]): scan(e,c.get('component'))
        for r in locs if isinstance(locs,list) else []:
            scan(r,r.get('component') or r.get('screen'))
        score=100 if total==0 else max(0,100-int((len(bad)/max(1,total))*100))
        report={"totalLocatorsChecked":total,"highRiskLocators":len(bad),"score":score,"badLocatorExamples":bad[:100],"rules":["reject code expressions as accessible names","prefer test id/role/label","do not approve nth-child unless no alternative"]}
        self.ctx.write_json('reports/component_semantic_quality_gate.json',report)
        return AgentResult(self.name,'partial' if bad else 'success',score/100,{"score":score,"highRiskLocators":len(bad)}, {"report":"reports/component_semantic_quality_gate.json"})
