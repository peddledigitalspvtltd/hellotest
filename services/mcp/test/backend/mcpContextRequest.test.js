const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createRequire}=require('node:module');
const {contextSchema,requestTimeoutMs,packetBudgets}=require('../../backend/contextRequest');
const filename=path.resolve(__dirname,'../../backend/backplane.js');
const original=createRequire(filename);
const actor={user:{id:'user'},projectId:'project',clientId:'test'};
const fail=(message,statusCode=403,code='MCP_ACCESS_DENIED')=>Object.assign(new Error(message),{statusCode,code});
function backplane(retrieveDirect){
 const module={exports:{}};
 const mocks={
  '@hellotest/platform/backend/src/db':{prepare:()=>({get:async()=>({project_id:'project'})})},
  './auth':{permit:async()=>{},fail},
  '@hellotest/knowledge/backend/services/knowledgeRetrieval.service':{retrieveDirect}
 };
 new Function('require','module','exports',fs.readFileSync(filename,'utf8'))(id=>Object.hasOwn(mocks,id)?mocks[id]:original(id),module,module.exports);
 return module.exports;
}

test('the public MCP context contract represents source selection, evidence scope and bounded budgets',()=>{
 const input={question:'Explain checkout failures',app_type_id:'app',integration_id:'model',
  filters:{requested_scopes:['stories','runs','knowledge'],evidence_scope:{story_id:'story',execution_id:'run'},
   collection_ids:['collection'],source_ids:['source'],source_kinds:['text'],agent_id:'failure-analyst'},
  budgets:{deadline_ms:60000,max_context_tokens:8000,max_evidence_items:12,max_query_cost_usd:0,max_tool_calls:4}};
 const parsed=contextSchema.parse(input);
 assert.deepEqual(parsed.filters,input.filters);assert.deepEqual(parsed.budgets,input.budgets);
 for(const bad of [
  {...input,project_id:'foreign'},
  {...input,filters:{...input.filters,user_id:'admin'}},
  {...input,filters:{requested_scopes:['credentials']}},
  {...input,filters:{evidence_scope:{test_case_id:'case',approved:true}}},
  {...input,filters:{evidence_scope:{execution_id:'run',build:'unsupported-selector'}}},
  {...input,budgets:{deadline_ms:60001}},
  {...input,budgets:{max_tool_calls:21}},
  {...input,budgets:{max_cost_usd:-1}}
 ])assert.equal(contextSchema.safeParse(bad).success,false);
 assert.equal(contextSchema.parse({question:'x'.repeat(8000)}).question.length,8000,'Valid chatbot questions retain their complete intent across MCP');
 assert.equal(contextSchema.safeParse({question:'x'.repeat(8001)}).success,false);
});

test('retrieval hints are bounded data and cannot add model, identity or permission arguments',()=>{
 const input={question:'Explain checkout failures',intent_plan:{queries:['checkout observed failures'],source_kinds:['execution'],information_needs:['Recorded failing step'],stop_if_sufficient:true}};
 assert.deepEqual(contextSchema.parse(input).intent_plan,input.intent_plan);
 for(const intent_plan of [{},{...input.intent_plan,user_id:'admin'},{...input.intent_plan,source_kinds:['credentials']},{...input.intent_plan,queries:['x'.repeat(701)]},{...input.intent_plan,tools:['execute_sql']}])assert.equal(contextSchema.safeParse({...input,intent_plan}).success,false);
 for(const value of [NaN,Infinity,-Infinity,'not-a-number'])assert.throws(()=>packetBudgets({deadline_ms:value}),{code:'MCP_INVALID_ARGUMENT'});
 assert.equal(packetBudgets({max_queries:2.9}).max_queries,2);
});

test('public retrieval forwards exact evidence/source selections and preserves zero activity budgets',async()=>{
 let input;
 const active=backplane(async value=>{input=value;return {project_id:'project',evidence:[]};});
 const controller=new AbortController();
 const filters={requested_scopes:[],evidence_scope:{test_case_id:'case',execution_id:'run'},source_ids:['source-b','source-c'],source_kinds:['text']};
 await active.context(actor,contextSchema.parse({question:'Check the pinned case',app_type_id:'app',source_ids:['source-a','source-b'],filters,
  token_budget:1000,budgets:{deadline_ms:60000,max_context_tokens:0,max_tool_calls:0,max_evidence_items:0,max_query_cost_usd:0}}),controller.signal);
 assert.equal(input.projectId,'project');assert.equal(input.user,actor.user);assert.equal(input.signal,controller.signal);
 assert.deepEqual(input.filters,{...filters,source_ids:['source-b']});
 assert.equal(input.budgets.max_context_tokens,0);assert.equal(input.budgets.max_tool_calls,0);
 assert.equal(input.budgets.max_evidence_items,0);assert.equal(input.budgets.max_query_cost_usd,0);assert.equal(input.budgets.deadline_ms,60000);
 assert.equal(input.planningMode,'deterministic');
});

test('public context forwards retrieval hints separately from source authorization and the original question',async()=>{
 let received;
 const active=backplane(async value=>{received=value;return {project_id:'project',evidence:[]};});
 const intent_plan={queries:['checkout expected outcome'],source_kinds:['requirement'],information_needs:['Acceptance outcome']};
 await active.context(actor,contextSchema.parse({question:'Inspect checkout',filters:{requested_scopes:['stories'],evidence_scope:{story_id:'story'}},intent_plan}));
 assert.equal(received.query,'Inspect checkout');assert.deepEqual(received.intentPlan,intent_plan);
 assert.equal(received.user,actor.user);assert.deepEqual(received.filters.evidence_scope,{story_id:'story'});
 assert.equal(received.planningMode,'deterministic');
});

test('disjoint source filters and foreign private context cannot widen the project read',async()=>{
 let calls=0;const active=backplane(async()=>{calls++;return {};});
 await assert.rejects(active.context(actor,{question:'Inspect',source_ids:['one'],filters:{source_ids:['two']}}),{code:'MCP_INVALID_ARGUMENT'});
 await assert.rejects(active.context({...actor,packetInput:{projectId:'foreign'}},{question:'Inspect'}),{code:'MCP_ACCESS_DENIED'});
 await assert.rejects(active.context({...actor,retrievalInput:{request:{project_id:'foreign'}}},{question:'Inspect'}),{code:'MCP_ACCESS_DENIED'});
 assert.equal(calls,0);
});

test('context deadlines follow the read budget without extending action calls',()=>{
 const request=(name,args)=>({method:'tools/call',params:{name,arguments:args}});
 assert.equal(requestTimeoutMs(request('hellotest_context_build',{budgets:{deadline_ms:60000}})),62000);
 assert.equal(requestTimeoutMs(request('hellotest_context_build',{budgets:{deadline_ms:0}})),2000);
 assert.equal(requestTimeoutMs(request('hellotest_context_build',{budgets:{deadline_ms:Infinity}})),22000);
 assert.equal(requestTimeoutMs(request('hellotest_operation_execute',{budgets:{deadline_ms:60000}})),30000);
 assert.deepEqual(packetBudgets({max_evidence_items:40,max_context_tokens:100000,max_query_cost_usd:0,deadline_ms:60000,unknown:'ignored'}),
  {deadline_ms:60000,max_evidence_items:30,max_context_tokens:32000,max_query_cost_usd:0});
});
