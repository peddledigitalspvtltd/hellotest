from __future__ import annotations
from collections import defaultdict
from qaira_semantic_compiler.core.context import AgentResult
from .utils import extract_elements_from_file
class ComponentElementDiscoveryAgent:
    name='ComponentElementDiscoveryAgent'
    def __init__(self,ctx,logger): self.ctx=ctx; self.logger=logger
    def run(self):
        comps=self.ctx.state.get('components') or self.ctx.read_json('generated/components/component_inventory.json',{}).get('components',[])
        all_elements=[]; by={}
        for c in comps:
            p=self.ctx.source/c['file']
            els=extract_elements_from_file(self.ctx.source,p,c['name'])
            by[c['name']]=els; all_elements.extend(els)
        self.ctx.state['component_elements']=by
        self.ctx.write_json('generated/components/component_elements.json',{'componentCount':len(by),'elementCount':len(all_elements),'byComponent':by})
        return AgentResult(self.name,'success' if all_elements else 'partial',0.9 if all_elements else 0.45,{'elements':len(all_elements),'components':len(by)},{'elements':'generated/components/component_elements.json'})
