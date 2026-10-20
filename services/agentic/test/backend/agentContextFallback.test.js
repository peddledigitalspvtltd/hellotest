const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module');
const filename=path.resolve(__dirname,'../../backend/services/agenticAssistant.service.js');
const native=createRequire(filename),execution=native('@hellotest/knowledge/backend/services/knowledgeExecution.service');
function fixture(revoke=false) {
 let checks=0;const calls=[];
 const mocks={
  '@hellotest/platform/backend/services/permission.service':{hasPermission:async()=>true},
  '@hellotest/knowledge/backend/services/knowledgeRetrieval.service':{authorizeFreshEvidence:async({hits})=>({allowed:hits,denied_ids:revoke&&checks++>0?['source-1']:[]})},
  '@hellotest/platform/backend/src/utils/llmHttpClient':{fetchLlmWithRetry:async(url,input)=>{const body=JSON.parse(input.body);calls.push(body);if(calls.length===1)return new Response('maximum context length exceeded',{status:413});return Response.json({model:'model',choices:[{message:{content:JSON.stringify({response:'Supported outcome',citation_ids:JSON.parse(body.messages.at(-1).content).citation_contract.map(item=>item.id)})}}]});}}
 };
 const module={exports:{}};new Function('require','module','exports',fs.readFileSync(filename,'utf8'))(id=>mocks[id]||native(id),module,module.exports);
 return {...module.exports._internals,calls};
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
