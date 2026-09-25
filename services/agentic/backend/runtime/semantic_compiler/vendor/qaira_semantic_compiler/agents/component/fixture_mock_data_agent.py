from __future__ import annotations
from qaira_semantic_compiler.core.context import AgentResult
class ComponentFixtureMockDataAgent:
    name='ComponentFixtureMockDataAgent'
    def __init__(self,ctx,logger): self.ctx=ctx; self.logger=logger
    def run(self):
        deps=self.ctx.state.get('component_api_dependencies') or self.ctx.read_json('generated/components/component_api_dependencies.json',{}).get('byComponent',{})
        fixtures={}
        for comp, api_deps in deps.items():
            mocks=[]
            for d in api_deps:
                endpoint=d.get('endpoint') or '**/api/**'
                mocks.append({'endpoint':endpoint,'method':d.get('method','GET'),'status':200,'body':{'ok':True,'source':'QAira mock'},'failureStatus':500,'failureBody':{'message':'QAira mocked failure'}})
            fixtures[comp]={'validData':{'email':'qa.user@example.com','password':'Password@123','name':'QA User','search':'QAira'},'invalidData':{'email':'bad-email','password':'wrong'},'apiMocks':mocks}
        self.ctx.state['component_fixtures']=fixtures
        self.ctx.write_json('generated/components/component_fixtures_and_mocks.json',{'byComponent':fixtures})
        return AgentResult(self.name,'success',0.85,{'components':len(fixtures),'apiMocks':sum(len(v.get('apiMocks',[])) for v in fixtures.values())},{'fixtures':'generated/components/component_fixtures_and_mocks.json'})
