from __future__ import annotations
from qaira_semantic_compiler.core.context import AgentResult
class ComponentAssertionMiningAgent:
    name='ComponentAssertionMiningAgent'
    def __init__(self,ctx,logger): self.ctx=ctx; self.logger=logger
    def run(self):
        elements=self.ctx.state.get('component_ranked_elements') or self.ctx.read_json('generated/components/component_ranked_locators.json',{}).get('byComponent',{})
        states=self.ctx.state.get('component_states') or self.ctx.read_json('generated/components/component_states.json',{}).get('byComponent',{})
        assertions={}; total=0
        for comp, els in elements.items():
            out=[]
            stable=[e for e in els if e.get('primaryLocator')]
            if stable:
                out.append({'type':'render','assertion':f"expect({stable[0]['primaryLocator']}).toBeVisible()",'reason':'primary stable element visible'})
            if any('error' in s for s in states.get(comp,[])):
                out.append({'type':'error','assertion':"expect(page.getByRole('alert').or(page.getByText(/error|failed|invalid/i))).toBeVisible()",'reason':'error state detected'})
            if any('loading' in s for s in states.get(comp,[])):
                out.append({'type':'loading','assertion':"expect(page.getByText(/loading|processing|submitting/i)).toBeVisible()",'reason':'loading state detected'})
            assertions[comp]=out; total+=len(out)
        self.ctx.state['component_assertions']=assertions
        self.ctx.write_json('generated/components/component_assertions.json',{'assertionCount':total,'byComponent':assertions})
        return AgentResult(self.name,'success',0.84,{'assertions':total},{'assertions':'generated/components/component_assertions.json'})
