const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const context = require('../src/utils/llmTraceContext');
function load(file, overrides = {}) {
  const local = createRequire(file), module = { exports: {} };
  new Function('require','module','exports',fs.readFileSync(file,'utf8'))(id => overrides[id] || local(id), module,module.exports);
  return module.exports;
}
function fixture(runtime,overrides={}) {
  const writes = [];
  const capture = load(require.resolve('../src/utils/llmTraceCapture'), { '../obsDb': { pool: { query: async query => { writes.push(query); return {rows:[]}; } } } });
  const client = load(require.resolve('../src/utils/llmHttpClient'), { './llmTraceCapture': capture, ...(runtime?{'./aiFeatureRuntime':runtime}:{}),...overrides });
  return { writes, capture, client };
}
test('trace sanitizer redacts secrets and hidden reasoning and bounds payloads without losing JSON structure', () => {
  const f = fixture();
  const result = f.capture.sanitize({ api_key: 'secret', prompt: 'Bearer abcdefghijklmnop', choices:[{message:{reasoning_content:'hidden', content:'Observed result'}}], tool:'{"password":"secret"}', huge:'x'.repeat(150000) });
  const text = JSON.stringify(result.payload);
  assert.doesNotMatch(text, /secret|hidden|abcdefghijklmnop/); assert.match(text,/Observed result/);
  assert.ok(result.truncated); assert.ok(result.redacted); assert.ok(text.length < 97000);
});

test('deadline expiry before fetch is captured as nondispatched even when trace logging consumes the budget',async t=>{
 for(const expireAt of ['context','trace']){
  let now=1_000_000,fetches=0;const events=[];
  t.mock.method(Date,'now',()=>now);
  t.mock.method(globalThis,'fetch',async()=>{fetches++;assert.fail('an expired model request must not reach fetch');});
  const f=fixture({apply:async(init,options)=>({init,options})},{'@hellotest/mcp/backend/gateway':{enrichChatRequest:async init=>{if(expireAt==='context')now+=1001;return init;}}});
  await context.run({project_id:'p',session_id:'activity',on_llm_trace:record=>{events.push(record);if(expireAt==='trace'&&record.status==='running')now+=1001;}},async()=>{
   await assert.rejects(f.client.fetchLlmWithRetry('https://llm.test/chat/completions',{method:'POST',body:JSON.stringify({model:'fixture',messages:[{role:'user',content:'Review'}]})},{timeoutMs:1000}),{code:'DEADLINE_EXCEEDED'});
  });
  assert.equal(fetches,0);assert.equal(f.writes.length,2);assert.equal(f.writes[1].values[9],'DEADLINE_EXCEEDED');assert.equal(f.writes[1].values[8].request_stage,'provider_preflight');assert.deepEqual(events.map(event=>event.status),['running','failed']);assert.ok(events.every(event=>!event.dispatched));
  t.mock.restoreAll();
 }
});

test('provider dispatch notification occurs only when the transport actually calls fetch',async t=>{
 const events=[];let fetches=0;
 const f=fixture({apply:async(init,options)=>({init,options}),validateResponse:async()=>{}});
 t.mock.method(globalThis,'fetch',async()=>{fetches++;return Response.json({choices:[{message:{content:'Response'}}]});});
 await context.run({project_id:'p',on_llm_trace:record=>events.push(record)},async()=>{
  const response=await f.client.fetchLlmWithRetry('https://trace-dispatch.test/chat/completions',{method:'POST',body:JSON.stringify({model:'fixture',messages:[{role:'user',content:'Review'}]})},{mcpContextHandled:{evidence_count:0},validateResponse:false,maxAttempts:1});assert.equal(response.status,200);
 });
 assert.equal(fetches,1);assert.deepEqual(events.map(event=>[event.stage,event.status,event.dispatched]),[['provider_preflight','running',false],['provider_dispatch','running',true],['provider_dispatch','succeeded',true]]);assert.equal(f.writes[1].values[8].request_stage,'provider_dispatch');
});

test('trace redacts URL credentials, query signatures and key/value headers, including encoded tool bodies',()=>{
 const f=fixture();const result=f.capture.sanitize({url:'https://app.test/live?session=safe&token=PRIVATE_TOKEN&x-amz-signature=PRIVATE_SIGNATURE',headers:[{key:'X-API-Key',value:'PRIVATE_KEY'},{name:'Cookie',value:'PRIVATE_COOKIE'},{key:'Accept',value:'application/json'}],tool:JSON.stringify({token:'PRIVATE_BODY',url:'https://app.test?access_token=PRIVATE_ACCESS'})});
 const text=JSON.stringify(result.payload);assert.doesNotMatch(text,/PRIVATE_/);assert.match(text,/session=safe/);assert.match(text,/application\/json/);assert.equal(result.redacted,true);
});

test('activity trace notifications correlate the actual request and response without copying payloads',async()=>{
 const f=fixture(),events=[];
 await context.run({project_id:'p',actor_id:'u',session_id:'activity',completion_attempt:2,on_llm_trace:record=>events.push(record)},async()=>{
  const trace=await f.capture.begin({url:'https://llm.test',init:{body:JSON.stringify({model:'configured',messages:[{role:'user',content:'PRIVATE_TASK_BODY'}]})},options:{featureKey:'ai.agentic.automation-engineer'}});
  await f.capture.finish(trace,{response:Response.json({choices:[{message:{content:'PRIVATE_RESPONSE_BODY'}}]})});
  assert.equal(f.writes[0].values[7],'activity');assert.equal(events.length,2);assert.equal(events[0].trace_id,trace.id);assert.equal(events[1].call_id,trace.id);
  assert.deepEqual(events.map(event=>event.status),['running','succeeded']);assert.ok(events.every(event=>event.dispatched&&event.completion_attempt===2));assert.doesNotMatch(JSON.stringify(events),/PRIVATE_|messages|choices/);
 });
});

test('generation correlation retains only bounded identity and shared case-attempt metadata',async()=>{
 const f=fixture();
 await context.run({project_id:'p',actor_id:'u',session_id:'activity',test_case_id:'case-a',completion_attempt:2,generation_scope:'case_attempt',generation_section_ids:['section-a','section-a','section-b']},async()=>{
  const trace=await f.capture.begin({url:'https://llm.test',init:{body:JSON.stringify({model:'fixture',messages:[{role:'user',content:'PRIVATE_PROMPT'}]})},options:{}});
  const capture=f.writes[0].values[17];assert.equal(capture.test_case_id,'case-a');assert.equal(capture.completion_attempt,2);assert.equal(capture.generation_scope,'case_attempt');assert.deepEqual(capture.generation_section_ids,['section-a','section-b']);assert.equal(capture.generation_section_count,2);assert.doesNotMatch(JSON.stringify(capture),/PRIVATE_PROMPT|messages/);
  await f.capture.finish(trace,{response:Response.json({choices:[{message:{content:'Saved'}}]})});assert.deepEqual(f.writes[1].values[8].generation_section_ids,['section-a','section-b']);
 });
});

test('sequential model calls retain their section and local retry without exposing prompt data',async()=>{
 const f=fixture();
 await context.run({project_id:'p',actor_id:'u',session_id:'activity',test_case_id:'case-a',completion_attempt:4,section_attempt:2,generation_scope:'section_attempt',generation_section_ids:['section-b']},async()=>{
  const trace=await f.capture.begin({url:'https://llm.test',init:{body:JSON.stringify({model:'fixture',messages:[{role:'user',content:'PRIVATE_STEP_DATA'}]})},options:{}});
  const capture=f.writes[0].values[17];assert.equal(capture.generation_scope,'section_attempt');assert.equal(capture.section_attempt,2);assert.equal(capture.completion_attempt,4);assert.deepEqual(capture.generation_section_ids,['section-b']);assert.doesNotMatch(JSON.stringify(capture),/PRIVATE_STEP_DATA|messages/);
  await f.capture.finish(trace,{response:Response.json({choices:[{message:{content:'Saved'}}]})});
 });
});

test('manual flow planning keeps its own trace scope without attributing it to a generated section',async()=>{
 const f=fixture();
 await context.run({project_id:'p',actor_id:'u',session_id:'activity',test_case_id:'case-a',completion_attempt:1,generation_scope:'flow_plan',generation_section_ids:[]},async()=>{
  const trace=await f.capture.begin({url:'https://llm.test',init:{body:JSON.stringify({model:'fixture',messages:[{role:'user',content:'PRIVATE_FLOW_BRIEF'}]})},options:{}});
  const capture=f.writes[0].values[17];assert.equal(capture.generation_scope,'flow_plan');assert.deepEqual(capture.generation_section_ids,[]);assert.equal(capture.generation_section_count,0);assert.doesNotMatch(JSON.stringify(capture),/PRIVATE_FLOW_BRIEF|messages/);
  await f.capture.finish(trace,{response:Response.json({choices:[{message:{content:'Draft flow'}}]})});
 });
});

test('outcome review and metadata completion retain distinct persisted and activity scopes without copying task bodies',async()=>{
 for(const generation_scope of ['section_semantic_review','case_metadata']){
  const f=fixture(),events=[];
  const sectionIds=generation_scope==='section_semantic_review'?['section-b']:[];
  await context.run({project_id:'p',actor_id:'u',session_id:'activity',test_case_id:'case-a',completion_attempt:4,section_attempt:2,generation_scope,generation_section_ids:sectionIds,on_llm_trace:record=>events.push(record)},async()=>{
   const trace=await f.capture.begin({url:'https://llm.test',init:{body:JSON.stringify({model:'fixture',messages:[{role:'user',content:'PRIVATE_REVIEW_REQUIREMENTS'}]})},options:{}});
   await f.capture.finish(trace,{response:Response.json({choices:[{message:{content:'PRIVATE_REVIEW_RESPONSE'}}]})});
   for(const capture of [f.writes[0].values[17],f.writes[1].values[8]]){
    assert.equal(capture.generation_scope,generation_scope);assert.deepEqual(capture.generation_section_ids,sectionIds);
    assert.equal(capture.generation_section_count,sectionIds.length);
    assert.equal(capture.section_attempt,generation_scope==='section_semantic_review'?2:undefined);
   }
   assert.equal(events.length,2);
   assert.ok(events.every(event=>event.generation_scope===generation_scope&&event.completion_attempt===4&&event.test_case_id==='case-a'));
   assert.deepEqual(events[0].generation_section_ids,sectionIds);
   assert.doesNotMatch(JSON.stringify(events),/PRIVATE_|messages|choices/);
  });
 }
});

test('missing configured instructions are traced as non-dispatched failures and never sent or retried',async t=>{
 const failure=Object.assign(new Error('Missing template'),{code:'AI_INSTRUCTION_MISSING',nonRetryable:true});
 const f=fixture({apply:async()=>{throw failure;}}),events=[];
 t.mock.method(globalThis,'fetch',async()=>{assert.fail('configuration errors must not dispatch a provider request');});
 await context.run({project_id:'p',session_id:'activity',on_llm_trace:record=>events.push(record)},async()=>{
  await assert.rejects(f.client.fetchLlmWithRetry('https://llm.test',{method:'POST',body:'{}'},{featureKey:'ai.agentic.automation-engineer'}),error=>error===failure);
 });
 assert.equal(f.writes.length,2);assert.equal(f.writes[1].values[9],'AI_INSTRUCTION_MISSING');assert.deepEqual(events.map(event=>event.status),['running','failed']);assert.ok(events.every(event=>event.stage==='configuration_preflight'&&!event.dispatched));
});

test('a failed activity event sink cannot discard the provider response or central trace',async()=>{
 const f=fixture();await context.run({project_id:'p',on_llm_trace:async()=>{throw new Error('event sink unavailable');}},async()=>{
  const trace=await f.capture.begin({url:'https://llm.test',init:{body:'{}'},options:{}});
  const response=Response.json({choices:[{message:{content:'Saved model response'}}]});await f.capture.finish(trace,{response});assert.match(await response.text(),/Saved model response/);assert.equal(f.writes.length,2);
 });
});
test('concurrent call scopes remain isolated and integration selection supplies background project identity', async () => {
  const integration = {};
  context.bindIntegration(integration, {projectId:'background',userId:'worker-user',usageKey:'story.generate'});
  assert.equal(context.current(integration).project_id,'background');
  const results = await Promise.all(['a','b'].map(project => context.run({project_id:project,run_id:`run-${project}`}, async () => { await new Promise(resolve => setTimeout(resolve,project==='a'?8:1)); return context.current(); })));
  assert.deepEqual(results.map(row=>row.project_id),['a','b']); assert.deepEqual(results.map(row=>row.run_id),['run-a','run-b']);
  assert.equal(context.current().run_id,undefined);
});
test('capture preserves the readable provider response, usage and workflow node correlation', async () => {
  const f=fixture();
  await context.run({project_id:'p',actor_id:'u',run_id:'r',node_id:'n'}, async()=>{
    const trace=await f.capture.begin({url:'https://user:password@model.example.test/v1?key=secret',init:{body:JSON.stringify({model:'requested',messages:[{role:'user',content:'Review'}]})},options:{operation:'agent.review'}});
    const response=new Response(JSON.stringify({model:'effective',usage:{total_tokens:12},choices:[{message:{content:'Review result'}}]}));
    await f.capture.finish(trace,{response});
    assert.equal((await response.json()).model,'effective'); assert.equal(response.headers.get('x-hellotest-llm-trace-id'),trace.id);
    assert.equal(f.writes[0].values[5],'r');assert.equal(f.writes[0].values[6],'n');assert.equal(f.writes[0].values[12],'https://model.example.test');
    assert.equal(f.writes[1].values[1],'succeeded');assert.deepEqual(f.writes[1].values[6],{total_tokens:12});
  });
});
test('invalid and missing responses retain explicit failures, not fabricated usage', async()=>{
  const f=fixture();
  await context.run({project_id:'p'},async()=>{
    const trace=await f.capture.begin({url:'https://llm.test',init:{body:'{}'},options:{}});
    await f.capture.finish(trace,{error:Object.assign(new Error('credential detail must not be stored'),{code:'TIMEOUT'})});
    assert.equal(f.writes[1].values[1],'failed');assert.equal(f.writes[1].values[6],null);assert.equal(f.writes[1].values[9],'TIMEOUT');
    assert.doesNotMatch(JSON.stringify(f.writes),/credential detail/);
  });
});

test('provider token counts and cached subset reach trace and activity without double counting or payload copies',async()=>{
 for(const details of [{prompt_tokens:100,completion_tokens:7,prompt_tokens_details:{cached_tokens:40}},{input_tokens:100,output_tokens:7,input_tokens_details:{cached_tokens:40}}]){
  const f=fixture(),events=[];
  await context.run({project_id:'p',on_llm_trace:record=>events.push(record)},async()=>{
   const trace=await f.capture.begin({url:'https://llm.test',init:{body:'{}'},options:{}});
   const response=Response.json({usage:details,choices:[{message:{content:'PRIVATE_RESPONSE_BODY'}}]});
   await f.capture.finish(trace,{response});
   const usage=f.writes[1].values[6];assert.equal(usage.total_tokens,107);assert.equal(usage.cached_input_tokens,40);
   assert.deepEqual(events.at(-1).usage,usage);assert.doesNotMatch(JSON.stringify(events),/PRIVATE_RESPONSE_BODY|choices/);
   assert.equal((await response.json()).choices[0].message.content,'PRIVATE_RESPONSE_BODY');
  });
 }
});

test('missing or invalid reported cache usage never becomes a token estimate',async()=>{
 for(const invalid of [-1,1.5,101,'40',Number.MAX_SAFE_INTEGER+1]){
  const f=fixture();await context.run({project_id:'p'},async()=>{
   const trace=await f.capture.begin({url:'https://llm.test',init:{body:'{}'},options:{}});
   await f.capture.finish(trace,{response:Response.json({usage:{prompt_tokens:100,completion_tokens:7,prompt_tokens_details:{cached_tokens:invalid}}})});
   assert.deepEqual(f.writes[1].values[6],{prompt_tokens:100,completion_tokens:7,total_tokens:107});
  });
 }
 const f=fixture(),events=[];await context.run({project_id:'p',on_llm_trace:record=>events.push(record)},async()=>{
  const trace=await f.capture.begin({url:'https://llm.test',init:{body:'{}'},options:{}});
  await f.capture.finish(trace,{response:Response.json({usage:{prompt_tokens_details:{cached_tokens:40},cache_read_input_tokens:40}})});
  assert.equal(f.writes[1].values[6],null);assert.equal(events.at(-1).usage,null);
 });
});

test('instance-scoped calls and required-context preflight failures are traced without a synthetic project',async()=>{
 const f=fixture();
 await context.run({actor_id:'instance-admin',project_id:null},async()=>{
  await assert.rejects(f.client.fetchLlmWithRetry('https://provider-never-dispatched.invalid/chat/completions',{method:'POST',body:JSON.stringify({model:'fixture',messages:[{role:'user',content:'Review'}]})},{operation:'unmapped.preflight-fixture',mcpContextPolicy:{mode:'mcp',required:true}}),{code:'AI_MCP_SCOPE_REQUIRED'});
  assert.equal(f.writes.length,2);assert.equal(f.writes[0].values[1],null);assert.equal(f.writes[0].values[2],'instance-admin');assert.equal(f.writes[0].values[17].scope,'instance');assert.equal(f.writes[0].values[17].mcp_context,'scope_missing');assert.equal(f.writes[1].values[1],'failed');
 });
});
