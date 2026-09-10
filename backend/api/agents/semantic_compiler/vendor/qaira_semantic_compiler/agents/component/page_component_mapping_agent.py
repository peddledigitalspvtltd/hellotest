from __future__ import annotations
from collections import defaultdict
from qaira_semantic_compiler.core.context import AgentResult
from .utils import read_text, route_from_file, is_page_file
from pathlib import Path
class PageComponentMappingAgent:
    name='PageComponentMappingAgent'
    def __init__(self,ctx,logger): self.ctx=ctx; self.logger=logger
    def run(self):
        comps=self.ctx.state.get('components') or self.ctx.read_json('generated/components/component_inventory.json',{}).get('components',[])
        by_name={c['name']:c for c in comps}; pages=[]
        for c in comps:
            p=self.ctx.source/c['file']
            if c.get('kind')=='route_page' or is_page_file(self.ctx.source,p):
                txt=read_text(p); used=[]
                for name in by_name:
                    if name!=c['name'] and (f'<{name}' in txt or f'{name}(' in txt): used.append(name)
                pages.append({'page':c['name'],'route':c.get('route') or route_from_file(self.ctx.source,p),'file':c['file'],'components':sorted(set([c['name']]+used))})
        self.ctx.state['page_component_map']=pages
        self.ctx.write_json('generated/components/page_component_map.json',{'count':len(pages),'pages':pages})
        return AgentResult(self.name,'success' if pages else 'partial',0.9 if pages else 0.4,{'pages':len(pages),'mappedComponents':sum(len(p['components']) for p in pages)},{'map':'generated/components/page_component_map.json'})
