const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module');
const filename=path.resolve(__dirname,'../../backend/services/agenticAssistant.service.js');
const native=createRequire(filename),execution=native('@hellotest/knowledge/backend/services/knowledgeExecution.service');
function fixture(revoke=false,{posts=1,rejectFirst=true}={}) {
 let checks=0;const calls=[],dispatches=[];
 const mocks={
  '@hellotest/platform/backend/services/permission.service':{hasPermission:async()=>true},
  '@hellotest/knowledge/backend/services/knowledgeRetrieval.service':{authorizeFreshEvidence:async({hits})=>({allowed:hits,denied_ids:revoke&&checks++>0?['source-1']:[]})},
  '@hellotest/platform/backend/src/utils/llmHttpClient':{fetchLlmWithRetry:async(url,input,options)=>{
   for(let index=0;index<posts;index++){
    await options.beforeDispatch?.();const trace_id=`fixture-dispatch-${dispatches.length+1}`;dispatches.push(trace_id);
    await options.traceContext.on_llm_trace({trace_id,dispatched:true,stage:'provider_dispatch',status:'running'});
    await options.traceContext.on_llm_trace({trace_id,dispatched:true,stage:'provider_dispatch',status:'succeeded',usage:{prompt_tokens:10,completion_tokens:3,total_tokens:13}});
   }
   const body=JSON.parse(input.body);calls.push(body);if(rejectFirst&&calls.length===1)return new Response('maximum context length exceeded',{status:413});return Response.json({model:'model',choices:[{message:{content:JSON.stringify({response:'Supported outcome',citation_ids:JSON.parse(body.messages.at(-1).content).citation_contract.map(item=>item.id)})}}],usage:{prompt_tokens:10,completion_tokens:3,total_tokens:13}});
  }}
 };
 const module={exports:{}};new Function('require','module','exports',fs.readFileSync(filename,'utf8'))(id=>mocks[id]||native(id),module,module.exports);
 return {...module.exports._internals,calls,dispatches};
}
function input() {
 const citations=Array.from({length:6},(_,index)=>({id:`citation-${index}`,source_id:`source-${index}`,source_kind:'text'}));
 const context={knowledge:citations.map((citation,index)=>({id:`chunk-${index}`,title:`Source ${index}`,content:'Evidence '.repeat(1000),citation}))};
 const prompt='Prioritize retry behavior and return the native schema.';
 return {user:{id:'actor'},projectId:'project',integration:{model:'model',base_url:'https://model.test'},agent:{name:'Test Designer',objective:'Design tests',limits:{max_output_tokens:4000}},mode:'agent',prompt,context,citations,history:[],contextRoute:{outcome_sections:['findings','artifacts']},knowledgeRetrieval:{},promptPayload:JSON.stringify({user_prompt:prompt,bounded_workspace_context:context,citation_contract:citations,story_targets:[]}),budget:{used:0,max:3}};
}
test('context-size correction preserves user intent and schema, shrinks evidence and counts the additional call',async()=>{
 const f=fixture(),task=input();const output=await execution.run({},()=>f.requestLlmResult(task));
 assert.equal(f.calls.length,2);assert.equal(task.budget.used,2);assert.ok(JSON.stringify(f.calls[1]).length<JSON.stringify(f.calls[0]).length);
 const reduced=JSON.parse(f.calls[1].messages.at(-1).content);assert.equal(reduced.user_prompt,task.prompt);assert.equal(reduced.citation_contract.length,3);assert.equal(f.calls[1].response_format.type,'json_object');assert.equal(f.calls[1].messages[0].content,f.calls[0].messages[0].content);
 assert.equal(output._suppliedEvidenceIds.size,3);assert.equal(output._model.context_reduced,true);
});
test('evidence revoked between the rejected request and its size correction is never sent again',async()=>{
 const f=fixture(true),task=input();await assert.rejects(execution.run({},()=>f.requestLlmResult(task)),error=>error.statusCode===403);assert.equal(f.calls.length,1);assert.equal(task.budget.used,1);
});
test('actual inner provider dispatches share the agent limit and retain every reported usage receipt',async()=>{
 const f=fixture(false,{posts:2,rejectFirst:false}),task=input(),records=[];task.budget.onCall=async record=>records.push(record);
 await execution.run({},()=>f.requestLlmResult(task));assert.equal(task.budget.used,2);assert.equal(records.length,2);assert.equal(f.dispatches.length,2);
 assert.equal(f.aggregateUsage(records).usage.total_tokens,26);assert.equal(f.aggregateUsage(records).usage_unknown_calls,0);
 const bounded=fixture(false,{posts:2,rejectFirst:false}),limited=input();limited.budget.max=1;
 await assert.rejects(execution.run({},()=>bounded.requestLlmResult(limited)),error=>error.code==='AGENT_MODEL_BUDGET');
 assert.equal(limited.budget.used,1);assert.equal(bounded.dispatches.length,1,'The hidden correction cannot dispatch after exhausting the one-call policy.');
});
test('a provider size rejection is not replayed when only exact task input remains',async()=>{
 const f=fixture(),task=input();task.context={workflow_input:[{id:'K-workflow-input',content:JSON.stringify({required_fact:'Keep this whole subject.'}),citation:{id:'K-workflow-input',source_kind:'workflow_input'}}]};task.citations=[task.context.workflow_input[0].citation];task.promptPayload=f.buildBoundedAgentPromptPayload(task);
 await assert.rejects(execution.run({},()=>f.requestLlmResult(task)),error=>error.code==='AGENT_CONTEXT_BUDGET');assert.equal(f.calls.length,1);assert.equal(task.budget.used,1);
});
test('routing metadata preserves selected sources without injecting hardcoded task or presentation instructions',()=>{
 const f=fixture(),task=input();
 const contextRoute={agent_id:'test-designer',effective_scopes:['stories'],decision_question:'Obsolete task default',deliverable_contract:'Obsolete output guidance',outcome_sections:['Obsolete heading'],retrieval_focus:'Obsolete focus',retrieval_query:'Obsolete retrieval prompt'};
 const payload=JSON.parse(f.buildBoundedAgentPromptPayload({...task,contextRoute}));
 assert.equal(payload.request,task.prompt);
 assert.deepEqual(payload.context_route,{agent_id:'test-designer',effective_scopes:['stories']});
 assert.doesNotMatch(JSON.stringify(payload),/Obsolete/);
 assert.equal(payload.citation_contract.length,task.citations.length);
});
test('large structured evidence stays valid JSON and pinned automation context precedes broad search hits',()=>{
 const f=fixture();
 const record={sections:Array.from({length:10},(_,i)=>({id:'step-'+i,action:'Open page '+i,expected_result:'Expected '+i,existing_automation_code:'await web.click("target");'}))};
 const context={live_project:[{id:'broad',content:'x'.repeat(9000)}],automation_case:[{id:'pinned',content:JSON.stringify(record),citation:{id:'pinned'}}],knowledge:[{id:'large',content:JSON.stringify({records:Array.from({length:30},()=>({text:'x'.repeat(1000)}))}),citation:{id:'large'}}]};
 const packed=JSON.parse(f.buildBoundedAgentPromptPayload({mode:'agent',prompt:'Automate the complete pinned case',context,citations:[],contextRoute:{}}));
 assert.equal(Object.keys(packed.bounded_workspace_context)[0],'automation_case');
 assert.equal(JSON.parse(packed.bounded_workspace_context.automation_case[0].content).sections.length,10);
 const large=packed.bounded_workspace_context.knowledge[0];assert.doesNotThrow(()=>JSON.parse(large.content));assert.equal(large.excerpt_truncated,true);
});

test('selected whole-case intent stays exact before broad excerpts and survives provider context reduction',()=>{
 const f=fixture();const source={evidence_type:'authoritative_full_test_case_intent',source_revision:4,records:[{id:'case-selected',steps:Array.from({length:12},(_,index)=>({action:`Exact action ${index} ${'a'.repeat(200)}`,expected_result:`Exact outcome ${index} ${'b'.repeat(200)}`}))}]};
 const item={id:'K-case-intent-selected',source_kind:'live_project',content:JSON.stringify(source),citation:{id:'K-case-intent-selected'}};
 const context={live_project:[{id:'broad',content:'Broad search excerpt'}],case_intent:[item]};
 const packed=JSON.parse(f.buildBoundedAgentPromptPayload({mode:'agent',prompt:'Improve every saved manual clause.',context,citations:[item.citation],contextRoute:{}}));
 assert.equal(Object.keys(packed.bounded_workspace_context)[0],'case_intent');
 assert.equal(packed.bounded_workspace_context.case_intent[0].content,item.content);
 const reduced=require('../../backend/services/agentMinimalContext').minimalContext(packed);
 assert.equal(reduced.payload.bounded_workspace_context.case_intent[0].content,item.content);
 assert.throws(()=>f.buildBoundedAgentPromptPayload({mode:'agent',prompt:'Improve whole case',context,citations:[],contextRoute:{},maxBytes:1000}),error=>error.code==='AGENT_CONTEXT_BUDGET');
});

test('workflow inputs remain complete valid JSON, retain final subjects and survive context correction',()=>{
 const f=fixture(),source={items:Array.from({length:35},(_,index)=>({id:`item-${index}`,obligation:`Verify complete subject ${index}: ${'a'.repeat(480)}`})),final_obligation:'The final subject must be reviewed.'};
 const supplied=f.suppliedInputEvidence(source);assert.ok(Buffer.byteLength(supplied.text)>16000);assert.deepEqual(JSON.parse(supplied.text),source);
 const item={id:'K-workflow-input',content:supplied.text,citation:{id:'K-workflow-input',source_kind:'workflow_input'}};
 const packed=JSON.parse(f.buildBoundedAgentPromptPayload({mode:'agent',prompt:'Review every supplied subject.',context:{knowledge:Array.from({length:6},(_,index)=>({id:`knowledge-${index}`,content:'Broad source '.repeat(1000)})),workflow_input:[item]},citations:[item.citation],contextRoute:{}}));
 assert.equal(Object.keys(packed.bounded_workspace_context)[0],'workflow_input');
 assert.equal(packed.bounded_workspace_context.workflow_input[0].content,supplied.text);
 const reduced=require('../../backend/services/agentMinimalContext').minimalContext(packed);
 assert.equal(reduced.payload.bounded_workspace_context.workflow_input[0].content,supplied.text);assert.ok(reduced.ids.has(item.id));
 assert.equal(JSON.parse(reduced.payload.bounded_workspace_context.workflow_input[0].content).items.length,35);
});

test('exact task input limits use UTF-8 bytes and fail instead of dropping required facts',()=>{
 const f=fixture();assert.throws(()=>f.suppliedInputEvidence({text:'界'.repeat(12000)}),error=>error.code==='AGENT_INPUT_BUDGET');
 const source=f.suppliedInputEvidence({text:'界'.repeat(3000)});
 assert.throws(()=>f.buildBoundedAgentPromptPayload({mode:'agent',prompt:'Review all input',context:{task_input:[{id:'input',content:source.text}]},citations:[],contextRoute:{},maxBytes:8000}),error=>error.code==='AGENT_CONTEXT_BUDGET');
});
