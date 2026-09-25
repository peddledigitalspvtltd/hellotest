from __future__ import annotations
from collections import defaultdict
from qaira_semantic_compiler.core.context import AgentResult
from .utils import extract_api_deps_from_file
class ComponentApiMappingAgent:
    name='ComponentApiMappingAgent'
    def __init__(self,ctx,logger): self.ctx=ctx; self.logger=logger
    def run(self):
        comps=self.ctx.state.get('components') or self.ctx.read_json('generated/components/component_inventory.json',{}).get('components',[])
        deps=[]
        api_contracts=self.ctx.read_json('generated/api_contracts.json',[]) or self.ctx.read_json('generated/openapi.json',{})
        for c in comps:
            deps.extend(extract_api_deps_from_file(self.ctx.source/self._file(c), self.ctx.source/self._file(c), c['name']) if False else extract_api_deps_from_file(self.ctx.source, self.ctx.source/c['file'], c['name']))
        by=defaultdict(list)
        for d in deps: by[d['component']].append(d)
        data={'count':len(deps),'byComponent':dict(by),'apiGraphAvailable':bool(api_contracts)}
        self.ctx.state['component_api_dependencies']=dict(by)
        self.ctx.write_json('generated/components/component_api_dependencies.json',data)
        return AgentResult(self.name,'success',0.82,{'dependencies':len(deps),'componentsWithApi':len(by)},{'apiDependencies':'generated/components/component_api_dependencies.json'})
    def _file(self,c): return c.get('file','')
