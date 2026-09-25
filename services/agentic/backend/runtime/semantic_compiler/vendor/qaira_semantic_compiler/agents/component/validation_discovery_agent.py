from __future__ import annotations
from qaira_semantic_compiler.core.context import AgentResult
from .utils import extract_validations_from_text
class ComponentValidationDiscoveryAgent:
    name='ComponentValidationDiscoveryAgent'
    def __init__(self,ctx,logger): self.ctx=ctx; self.logger=logger
    def run(self):
        comps=self.ctx.state.get('components') or self.ctx.read_json('generated/components/component_inventory.json',{}).get('components',[])
        by={}; total=0
        for c in comps:
            vals=extract_validations_from_text(self.ctx.source,self.ctx.source/c['file'],c['name'])
            by[c['name']]=vals; total+=len(vals)
        self.ctx.state['component_validations']=by
        self.ctx.write_json('generated/components/component_validations.json',{'validationCount':total,'byComponent':by})
        return AgentResult(self.name,'success',0.82,{'validations':total},{'validations':'generated/components/component_validations.json'})
