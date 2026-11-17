const test=require('node:test');const assert=require('node:assert/strict');const crypto=require('node:crypto');
const profiles=require('@hellotest/contracts/agents/workflowSpecialists.json');
const build=require('../../backend/services/specialistModelBoundary');
const {createSpecialistTools}=require('../../backend/services/specialistTools');
const {getCompletionContent}=require('@hellotest/platform/backend/src/utils/llmResponse');
const {aiInstructionBlock}=require('@hellotest/platform/backend/src/utils/aiInstructionBlocks');
const {dedupeInstructions}=require('@hellotest/platform/backend/src/utils/aiPromptEnvelope');
function fixture(responses=[{choices:[{message:{content:'{"response":"Review evidence"}'}}]}]){
 const requests=[],events=[];
 const invoke=build({artifacts:require('../../backend/services/agentArtifacts'),normalizeText:(v,max=12000)=>String(v||'').trim().slice(0,max),integrationService:{isUsableApiCredential:()=>false},authorizeFreshEvidence:async({hits})=>({allowed:hits,denied_ids:[]}),MODEL_TIMEOUT_MS:120000,responseContract:require('../../backend/services/agentResponseContract'),dedupeInstructions,instructionFor:skill=>skill.instructions,aiInstructionBlock,evidenceScopes:{normalize:()=>({})},buildBoundedAgentPromptPayload:()=>'{"request":"Review checkout"}',execution:{assertActive(){},current:()=>({})},agentContract:{fail:(message,code)=>Object.assign(new Error(message),{code})},permissionService:{hasPermission:async()=>true},agentError:(message,statusCode)=>Object.assign(new Error(message),{statusCode}),resolveChatCompletionsUrl:()=> 'https://model.fixture/v1/chat/completions',appendEvent:async(id,event)=>events.push(event),providerUsage:usage=>usage||null,JSON_MODE_FIELD:/response_format/,JSON_MODE_REJECTION:/unsupported/,completionContent:getCompletionContent,extractJson:JSON.parse,crypto,fetchLlmWithRetry:async(url,init,options)=>{const payload=JSON.parse(init.body);payload.messages=payload.messages.map(message=>({...message,content:typeof message.content==='string'?require('../../../platform/backend/test/helpers/managedInstructions').expandManagedInstructions(message.content):message.content}));await options.beforeDispatch?.({payload});requests.push(payload);const next=responses.shift();if(next instanceof Error)throw next;return new Response(JSON.stringify(next),{status:200});}});
 const run=(extra={})=>invoke({integration:{model:'fixture'},agent:{id:'story-architect',name:'Story Architect',objective:profiles['story-architect'].description,skills:profiles['story-architect'].skills,outputInstructions:profiles['story-architect'].outputInstructions},mode:'agent',prompt:'Review checkout',context:{},citations:[],history:[],budget:{used:0,max:3},...extra});
 return {run,requests,events};
}
test('provider tool-call continuation is bounded, carries MCP result and persists assembled prompt metadata',async()=>{
 const f=fixture([{choices:[{message:{tool_calls:[{id:'read-1',type:'function',function:{name:'knowledge_search',arguments:'{"question":"checkout retry"}'}}]}}],usage:{prompt_tokens:20,completion_tokens:10}},{choices:[{message:{content:'{"response":"Retry preserves one order [ev-1]"}'}}]}]);
 const toolSession=createSpecialistTools({user:{id:'u'},projectId:'p',context:{},requestedScopes:['knowledge'],policy:{allowed_tools:['knowledge_search']},deadline:Date.now()+20000,call:async()=>({project_id:'p',evidence:[{evidence_id:'ev-1',content:'Retry preserves one order'}]})});
 const result=await f.run({toolSession});assert.equal(f.requests.length,2);assert.equal(toolSession.used,1);assert.ok(f.requests[0].tools.length);assert.equal(f.requests[1].messages.at(-1).role,'tool');assert.match(f.requests[1].messages.at(-1).content,/ev-1/);assert.equal(result._model.tool_calls,1);assert.equal(result._model.prompt_template_version,'specialist-system/1');assert.match(result._model.system_message_hash,/^[a-f0-9]{64}$/);assert.match(result._model.prompt_hash,/^[a-f0-9]{64}$/);
});
test('last available model call cannot advertise further tools or dispatch an extra generation',async()=>{
 const f=fixture([{choices:[{message:{tool_calls:[{id:'read-1',type:'function',function:{name:'knowledge_search',arguments:'{"question":"retry"}'}}]}}]}]);
 const tools={used:0,definitions:()=>[{type:'function',function:{name:'knowledge_search'}}],execute:async()=>assert.fail('No tool may be called without another answer generation budget')};
 await assert.rejects(f.run({toolSession:tools,budget:{used:0,max:1}}),{code:'AGENT_TOOL_BUDGET'});assert.equal(f.requests.length,1);assert.equal(f.requests[0].tools,undefined);
});
test('all assembled stock specialist frames have pinned versioned hashes',async()=>{
 const expected=require('../fixtures/specialistPromptHashes.json');const actual={};
 for(const[id,profile]of Object.entries(profiles)){
  const f=fixture();const result=await f.run({agent:{id,name:profile.name,objective:profile.description,skills:profile.skills,outputInstructions:profile.outputInstructions}});actual[id]=result._model.system_message_hash;
  assert.match(f.requests[0].messages[0].content,/<specialist_output_contract>/);assert.ok(f.requests[0].messages[0].content.includes(profile.outputInstructions));
 }
 assert.deepEqual(actual,expected);
});
module.exports={fixture};
