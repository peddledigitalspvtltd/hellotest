from __future__ import annotations
import csv, json
from qaira_semantic_compiler.core.context import AgentResult
class ComponentArtifactPackagingAgent:
    name='ComponentArtifactPackagingAgent'
    def __init__(self,ctx,logger): self.ctx=ctx; self.logger=logger
    def run(self):
        contracts=self.ctx.state.get('component_test_contracts') or self.ctx.read_json('generated/components/component_test_contracts.json',{}).get('contracts',[])
        tests=self.ctx.read_json('generated/components/component_playwright_tests.json',{})
        rows=[]
        for c in contracts:
            for t in c.get('testCases',[]):
                rows.append({'component':c['component'],'component_kind':c.get('componentKind',''),'page':c.get('page') or '', 'file':c.get('file'), 'test_name':t.get('name'), 'test_type':t.get('type'), 'priority':t.get('priority'), 'maturity_score':t.get('maturity',{}).get('score'), 'risks': ','.join(t.get('maturity',{}).get('risks',[]))})
        p=self.ctx.out('generated/components/component_tests.csv')
        with p.open('w', newline='', encoding='utf-8') as f:
            w=csv.DictWriter(f, fieldnames=['component','component_kind','page','file','test_name','test_type','priority','maturity_score','risks']); w.writeheader(); w.writerows(rows)
        summary={'componentCount':len(contracts),'testCaseCount':len(rows),'testFileCount':tests.get('testFileCount',0),'csv':'generated/components/component_tests.csv','contracts':'generated/components/component_test_contracts.json','playwrightTests':'generated/component-tests','htmlReportAfterExecution':'component-html-report/index.html'}
        self.ctx.write_json('generated/components/component_generation_summary.json', summary)
        return AgentResult(self.name,'success' if contracts else 'partial',0.94 if contracts else 0.4,{'componentCount':len(contracts),'testCaseCount':len(rows),'testFileCount':tests.get('testFileCount',0)}, {'summary':'generated/components/component_generation_summary.json','csv':'generated/components/component_tests.csv','contracts':'generated/components/component_test_contracts.json','playwrightTests':'generated/component-tests'})
