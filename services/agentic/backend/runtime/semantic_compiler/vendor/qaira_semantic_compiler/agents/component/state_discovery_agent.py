from __future__ import annotations
from qaira_semantic_compiler.core.context import AgentResult
from .utils import read_text, extract_states_from_text
class ComponentStateDiscoveryAgent:
    name='ComponentStateDiscoveryAgent'
    def __init__(self,ctx,logger): self.ctx=ctx; self.logger=logger
    def run(self):
        comps=self.ctx.state.get('components') or self.ctx.read_json('generated/components/component_inventory.json',{}).get('components',[])
        by={}
        for c in comps:
            by[c['name']]=extract_states_from_text(read_text(self.ctx.source/c['file']))
        self.ctx.state['component_states']=by
        self.ctx.write_json('generated/components/component_states.json',{'byComponent':by})
        return AgentResult(self.name,'success',0.84,{'components':len(by),'states':sum(len(v) for v in by.values())},{'states':'generated/components/component_states.json'})
