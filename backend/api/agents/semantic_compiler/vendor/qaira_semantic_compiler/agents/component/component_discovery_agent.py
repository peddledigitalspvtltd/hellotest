from __future__ import annotations
from qaira_semantic_compiler.core.context import AgentResult
from .utils import iter_ui_files, extract_components_from_file
class ComponentDiscoveryAgent:
    name='ComponentDiscoveryAgent'
    def __init__(self,ctx,logger): self.ctx=ctx; self.logger=logger
    def run(self):
        components=[]; files=0
        for p in iter_ui_files(self.ctx.source,self.ctx.config):
            files+=1; components.extend(extract_components_from_file(self.ctx.source,p))
        seen={};
        for c in components:
            key=(c['name'],c['file']); seen[key]=c
        components=list(seen.values())
        self.ctx.state['components']=components
        self.ctx.write_json('generated/components/component_inventory.json', {'count':len(components),'components':components})
        return AgentResult(self.name,'success' if components else 'partial',0.92 if components else 0.35,{'components':len(components),'filesScanned':files},{'inventory':'generated/components/component_inventory.json'})
