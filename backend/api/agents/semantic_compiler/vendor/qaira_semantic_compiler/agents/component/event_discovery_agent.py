from __future__ import annotations
from collections import defaultdict
from qaira_semantic_compiler.core.context import AgentResult
from .utils import extract_events_from_file
class ComponentEventDiscoveryAgent:
    name='ComponentEventDiscoveryAgent'
    def __init__(self,ctx,logger): self.ctx=ctx; self.logger=logger
    def run(self):
        comps=self.ctx.state.get('components') or self.ctx.read_json('generated/components/component_inventory.json',{}).get('components',[])
        by={}; total=0
        for c in comps:
            ev=extract_events_from_file(self.ctx.source,self.ctx.source/c['file'],c['name'])
            by[c['name']]=ev; total+=len(ev)
        self.ctx.state['component_events']=by
        self.ctx.write_json('generated/components/component_events.json',{'eventCount':total,'byComponent':by})
        return AgentResult(self.name,'success',0.85,{'events':total,'components':len(by)},{'events':'generated/components/component_events.json'})
