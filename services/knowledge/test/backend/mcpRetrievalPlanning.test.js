const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createRequire}=require('node:module');
const execution=require('../../backend/services/knowledgeExecution.service');
const realPlanning=require('../../backend/services/knowledgeIntentPlanning.service');

function fixture(){
 const file=require.resolve('../../backend/services/knowledgeRetrieval.service'),local=createRequire(file),module={exports:{}};
 const calls=[];
 const mocked={
  '@hellotest/platform/backend/src/db':{prepare:()=>({get:async()=>({count:0})})},
  './knowledgeRag.service':{},'@hellotest/ai/backend/services/aiContextOrchestrator.service':{},
  './knowledgeAuthorization.service':{},
  './knowledgeIntentPlanning.service':{normalizePlan:realPlanning.normalizePlan,planIntent:async()=>assert.fail('Public reads must not make a generative intent-planning call.')},
  './knowledgeContextEngine.service':{retrieve:async input=>{calls.push(input);return {packet:{project_id:input.request.project_id,evidence:[],retrieval:{}},retrieval:{context_packet:{},retrieval_round_count:0}};}}
 };
 new Function('require','module','exports',fs.readFileSync(file,'utf8'))(name=>Object.hasOwn(mocked,name)?mocked[name]:local(name),module,module.exports);
 return {service:module.exports,calls};
}

test('public deterministic context reads preserve original question, selectors and zero paid planning calls',async()=>{
 const f=fixture();
 const packet=await f.service.retrieveDirect({projectId:'project',query:'Explain checkout failures',user:{id:'reader'},planningMode:'deterministic',
  filters:{requested_scopes:['runs'],evidence_scope:{execution_id:'run'}},budgets:{max_query_cost_usd:0,max_tool_calls:3}});
 assert.equal(packet.retrieval.intent_planning_mode,'deterministic');
 assert.equal(packet.retrieval.intent_planning_model_used,false);assert.equal(packet.retrieval.intent_model_calls,0);
 assert.equal(f.calls[0].request.query,'Explain checkout failures');
 assert.deepEqual(f.calls[0].request.filters.evidence_scope,{execution_id:'run'});
 assert.equal(f.calls[0].request.budgets.max_cost_usd,0);
});

test('caller retrieval hints stay anchored to the original task and cannot replace access selectors',async()=>{
 const f=fixture(),question='Explain checkout failures';
 const packet=await f.service.retrieveDirect({projectId:'project',query:question,user:{id:'reader'},planningMode:'deterministic',
  filters:{requested_scopes:['runs'],evidence_scope:{execution_id:'run'},source_ids:['allowed-source']},
  intentPlan:{queries:['checkout failing step','unrelated records'],source_kinds:['execution'],information_needs:['Observed result']}});
 assert.equal(packet.retrieval.intent_planning_mode,'caller_supplied');assert.equal(packet.retrieval.intent_model_calls,0);
 assert.deepEqual(f.calls[0].intentPlan.queries,['checkout failing step']);
 assert.equal(f.calls[0].request.query,question);assert.deepEqual(f.calls[0].request.filters.source_ids,['allowed-source']);
 assert.deepEqual(f.calls[0].request.filters.evidence_scope,{execution_id:'run'});
 await assert.rejects(f.service.retrieveDirect({projectId:'project',query:question,user:{id:'reader'},planningMode:'deterministic',intentPlan:{queries:['unrelated records']}}),{code:'RETRIEVAL_PLAN_INVALID',statusCode:400});
});

test.after(()=>{assert.equal(execution.current(),undefined);});
