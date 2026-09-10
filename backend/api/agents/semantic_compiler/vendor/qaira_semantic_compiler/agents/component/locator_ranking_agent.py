from __future__ import annotations
from qaira_semantic_compiler.core.context import AgentResult
class ComponentLocatorRankingAgent:
    name='ComponentLocatorRankingAgent'
    def __init__(self,ctx,logger): self.ctx=ctx; self.logger=logger
    def run(self):
        by=self.ctx.state.get('component_elements') or self.ctx.read_json('generated/components/component_elements.json',{}).get('byComponent',{})
        ranked={}; low=med=high=0
        for comp,els in by.items():
            out=[]
            used=set()
            for e in els:
                cands=sorted(e.get('locatorCandidates') or [], key=lambda c: c.get('confidence',0), reverse=True)
                unique=[]
                for c in cands:
                    loc=c.get('locator')
                    if loc and loc not in used:
                        used.add(loc); unique.append(c)
                e={**e,'locatorCandidates':unique,'primaryLocator': unique[0]['locator'] if unique else None,'locatorConfidence': unique[0]['confidence'] if unique else 0,'locatorRisk': unique[0]['risk'] if unique else 'high'}
                if e['locatorRisk']=='low': low+=1
                elif e['locatorRisk']=='medium': med+=1
                else: high+=1
                out.append(e)
            ranked[comp]=out
        self.ctx.state['component_ranked_elements']=ranked
        self.ctx.write_json('generated/components/component_ranked_locators.json',{'byComponent':ranked,'summary':{'low':low,'medium':med,'high':high}})
        return AgentResult(self.name,'success',0.91,{'lowRisk':low,'mediumRisk':med,'highRisk':high},{'rankedLocators':'generated/components/component_ranked_locators.json'})
