from __future__ import annotations
from qaira_semantic_compiler.core.context import AgentResult
from .utils import maturity_score
class ComponentTestContractAgent:
    name='ComponentTestContractAgent'
    def __init__(self,ctx,logger): self.ctx=ctx; self.logger=logger
    def run(self):
        comps=self.ctx.state.get('components') or self.ctx.read_json('generated/components/component_inventory.json',{}).get('components',[])
        elements=self.ctx.state.get('component_ranked_elements') or self.ctx.read_json('generated/components/component_ranked_locators.json',{}).get('byComponent',{})
        apis=self.ctx.state.get('component_api_dependencies') or self.ctx.read_json('generated/components/component_api_dependencies.json',{}).get('byComponent',{})
        states=self.ctx.state.get('component_states') or self.ctx.read_json('generated/components/component_states.json',{}).get('byComponent',{})
        events=self.ctx.state.get('component_events') or self.ctx.read_json('generated/components/component_events.json',{}).get('byComponent',{})
        vals=self.ctx.state.get('component_validations') or self.ctx.read_json('generated/components/component_validations.json',{}).get('byComponent',{})
        fixtures=self.ctx.state.get('component_fixtures') or self.ctx.read_json('generated/components/component_fixtures_and_mocks.json',{}).get('byComponent',{})
        contracts=[]
        for c in comps:
            comp=c['name']; els=elements.get(comp,[]); stable=[e for e in els if e.get('primaryLocator')]
            if not stable and c.get('kind') not in {'route_page','form_component','dialog','table_component'}: continue
            test_cases=[]
            test_cases.append({'name':f'renders {comp}','type':'render','priority':'high','state':'default','stableLocators':bool(stable),'assertions':['primary element is visible']})
            if vals.get(comp) or any(e.get('required') for e in els): test_cases.append({'name':f'{comp} validates required fields','type':'validation','priority':'high','state':'validation error','stableLocators':bool(stable),'assertions':['validation message or invalid state is visible']})
            if apis.get(comp): test_cases.append({'name':f'{comp} handles API success','type':'happy_path','priority':'high','state':'success','stableLocators':bool(stable),'apiMocks':apis.get(comp),'assertions':['success state is visible']}); test_cases.append({'name':f'{comp} handles API error','type':'api_error','priority':'high','state':'apiError','stableLocators':bool(stable),'apiMocks':apis.get(comp),'assertions':['error state is visible']})
            for t in test_cases: t['maturity']=maturity_score(t)
            contracts.append({'component':comp,'componentKind':c.get('kind'),'page':c.get('route'),'purpose':f'Validate {comp} behavior from repository semantic graph','file':c.get('file'),'framework':c.get('framework'),'elements':stable[:30],'apiDependencies':apis.get(comp,[]),'states':states.get(comp,[]),'events':events.get(comp,[]),'validations':vals.get(comp,[]),'fixtures':fixtures.get(comp,{}),'testCases':test_cases,'maturityScore': round(sum(t['maturity']['score'] for t in test_cases)/max(1,len(test_cases)),2)})
        self.ctx.state['component_test_contracts']=contracts
        self.ctx.write_json('generated/components/component_test_contracts.json',{'contractCount':len(contracts),'contracts':contracts})
        return AgentResult(self.name,'success' if contracts else 'partial',0.9 if contracts else 0.4,{'contracts':len(contracts),'testCases':sum(len(c['testCases']) for c in contracts)},{'contracts':'generated/components/component_test_contracts.json'})
