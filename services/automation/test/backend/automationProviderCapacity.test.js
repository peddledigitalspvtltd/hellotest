const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { retryLlmCapacity } = require('@hellotest/platform/backend/src/utils/llmCapacityRetry');
const { retryActorJsonOutput } = require('../../backend/lib/automationJsonOutputRetry');
const { browserActorRequestPolicy } = require('../../backend/lib/automationActorModelPolicy');
const { createLlmProviderError } = require('@hellotest/platform/backend/src/utils/upstreamLlmError');
const { getCompletionContent } = require('@hellotest/platform/backend/src/utils/llmResponse');
const { aiInstructionBlock } = require('@hellotest/platform/backend/src/utils/aiInstructionBlocks');
const { expandManagedInstructions } = require('../../../platform/backend/test/helpers/managedInstructions');
const source = fs.readFileSync(require.resolve('../../backend/services/aiAutomationBuilder.service'), 'utf8');
const declaration = source.slice(source.indexOf('const requestChatCompletion ='), source.indexOf('const normalizeUrlKey ='));
const integration = { base_url: 'https://provider.example.test/v1', model: 'fixture-small-model', api_key: 'private-fixture-key' };
const accepted = () => new Response(JSON.stringify({ choices: [{ message: { content: '{"stage":"act","tool_calls":[]}' } }] }), { headers: { 'content-type': 'application/json' } });
const rejected = (delay = '0.005') => new Response(JSON.stringify({ error: { code: 'rate_limit_exceeded', message: `TPM: Limit 8000, Used 6511, Requested 7623. Please try again in ${delay}s.` } }), { status: 429, headers: { 'retry-after': delay } });
function builderRequest(fetchWithTimeout) {
  return new Function('retryActorJsonOutput', 'retryLlmCapacity', 'fetchWithTimeout', 'createLlmProviderError', 'getCompletionContent', 'LLM_TIMEOUT_MS', 'aiInstructionBlock','browserActorRequestPolicy', `${declaration};return requestChatCompletion;`)(retryActorJsonOutput, retryLlmCapacity, fetchWithTimeout, createLlmProviderError, getCompletionContent, 5000, aiInstructionBlock,browserActorRequestPolicy);
}

const jsonRejected = (status = 400, code = 'json_validate_failed') => new Response(JSON.stringify({ error: { code, type: 'invalid_request_error', message: 'private-provider-body', failed_generation: 'private-partial-generation' } }), { status });

test('the actual browser actor retries one explicit JSON rejection with identical context and fresh permission checks', async () => {
  const requests = [], retries = [], controller = new AbortController(); let checks = 0;
  const complete = builderRequest(async (_url, init, timeoutMs) => { requests.push({ init, timeoutMs }); return requests.length === 1 ? jsonRejected() : accepted(); });
  const output = await complete({ integration, prompt: 'Frozen current goal and confirmed receipts', browserActor: true, signal: controller.signal,
    timeoutMs: 5000, beforeDispatch: async () => { checks++; }, onJsonRetry: value => retries.push(value) });
  assert.equal(output, '{"stage":"act","tool_calls":[]}'); assert.equal(requests.length, 2); assert.equal(checks, 2);
  assert.equal(requests[0].init.body, requests[1].init.body); assert.equal(requests[1].init.signal, controller.signal);
  assert.ok(requests[1].timeoutMs <= requests[0].timeoutMs);
  assert.deepEqual(retries, [{ attempt: 2, max_attempts: 2, error_code: 'LLM_REQUEST_REJECTED', provider_error_code: 'json_validate_failed' }]);
  assert.doesNotMatch(JSON.stringify(retries), /private-provider|private-partial/);
});

test('repeated JSON generation rejection stops after one retry and never expands other request contracts', async () => {
  for (const options of [{ browserActor: true }, { browserActor: false }, {}, { browserActor: 'true' }, { browserActor: true, maxAttempts: 1 }]) {
    let calls = 0;
    const complete = builderRequest(async () => { calls++; return jsonRejected(); });
    await assert.rejects(complete({ integration, prompt: 'Frozen goal', ...options }), { code: 'LLM_REQUEST_REJECTED' });
    assert.equal(calls, options.browserActor === true && options.maxAttempts !== 1 ? 2 : 1);
  }
});

test('JSON recovery excludes unrelated errors and transport uncertainty', async () => {
  for (const response of [() => jsonRejected(400, 'invalid_parameter'), () => jsonRejected(422), () => jsonRejected(401), () => jsonRejected(413),
    () => jsonRejected(429, 'insufficient_quota')]) {
    let calls = 0, retries = 0;
    const complete = builderRequest(async () => { calls++; return response(); });
    await assert.rejects(complete({ integration, prompt: 'Frozen goal', browserActor: true, onJsonRetry: () => { retries++; } }));
    assert.equal(calls, 1); assert.equal(retries, 0);
  }
  let calls = 0; const uncertain = new Error('Connection dropped after dispatch');
  const complete = builderRequest(async () => { calls++; throw uncertain; });
  await assert.rejects(complete({ integration, prompt: 'Frozen goal', browserActor: true }), error => error === uncertain);
  assert.equal(calls, 1);
});

test('JSON recovery observes cancellation, revoked access and its original total deadline', async t => {
  const controller = new AbortController(), lost = Object.assign(new Error('Lease lost'), { code: 'BATCH_JOB_LEASE_LOST' });
  let calls = 0;
  const complete = builderRequest(async () => { calls++; return jsonRejected(); });
  await assert.rejects(complete({ integration, prompt: 'Frozen goal', browserActor: true, signal: controller.signal, onJsonRetry: () => controller.abort(lost) }), error => error === lost);
  assert.equal(calls, 1);
  calls = 0; let checks = 0; const denied = Object.assign(new Error('Access revoked'), { statusCode: 403 });
  await assert.rejects(complete({ integration, prompt: 'Frozen goal', browserActor: true, beforeDispatch: async () => { if (++checks === 2) throw denied; } }), error => error === denied);
  assert.equal(calls, 1); assert.equal(checks, 2);
  let now = 1000; t.mock.method(Date, 'now', () => now); calls = 0;
  await assert.rejects(complete({ integration, prompt: 'Frozen goal', browserActor: true, timeoutMs: 500, onJsonRetry: () => { now = 1501; } }), { code: 'DEADLINE_EXCEEDED' });
  assert.equal(calls, 1, 'progress and rejection handling cannot extend the original deadline');
});

test('the real builder completion request honors 429 headers and retries the identical model payload only', async () => {
  const requests = [], waits = [], browser = { performed: 3 };
  const complete = builderRequest(async (url, init, timeoutMs, selected, feature, maxAttempts) => {
    requests.push({ url, init, timeoutMs, selected, feature, maxAttempts });
    assert.equal(browser.performed, 3, 'provider retry must retain the caller browser without replaying its actions');
    return requests.length === 1 ? rejected() : accepted();
  });
  const result = await complete({ integration, prompt: 'The frozen current section and observed browser evidence', featureKey: 'ai.agentic.automation-engineer', timeoutMs: 5000, onCapacityWait: value => waits.push(value) });
  assert.equal(result, '{"stage":"act","tool_calls":[]}'); assert.equal(requests.length, 2); assert.equal(waits.length, 1); assert.equal(waits[0].delay_ms, 1005); assert.equal(waits[0].provider_minimum_delay_ms, 5);
  assert.equal(requests[0].url, requests[1].url); assert.equal(requests[0].init.body, requests[1].init.body); assert.deepEqual(requests[0].init.headers, requests[1].init.headers);
  assert.equal(requests[0].selected, integration); assert.equal(requests[1].feature, 'ai.agentic.automation-engineer'); assert.ok(requests[1].timeoutMs <= requests[0].timeoutMs);
  assert.equal(browser.performed, 3);
});

test('successful output and a healer single-request contract cannot be regenerated by the capacity wrapper', async () => {
  let calls = 0; const success = builderRequest(async () => { calls++; return accepted(); });
  await success({ integration, prompt: 'Current goal' }); assert.equal(calls, 1);
  calls = 0; let waits = 0;
  const healer = builderRequest(async () => { calls++; return rejected(); });
  await assert.rejects(healer({ integration, prompt: 'Only the observed locator repair', maxAttempts: 1, onCapacityWait: () => { waits++; } }), { code: 'LLM_RATE_LIMITED' });
  assert.equal(calls, 1); assert.equal(waits, 0);
});

test('the actor request foregrounds only the host-selected current goal without converting broader context into actions', async () => {
  const payloads=[];
  const complete=builderRequest(async (_url,init)=>{payloads.push(JSON.parse(init.body));return accepted();});
  const activeGoal={action:'Navigate to https://app.test/auth',expected_result:'The login form is visible',ignored:'later submit'};
  await complete({integration,prompt:'Broader flow includes entering @r.email and submitting later.',activeGoal});
  assert.deepEqual(payloads[0].messages.map(message=>message.role),['system','user','user']);
  const instruction=expandManagedInstructions(payloads[0].messages[0].content);
  assert.match(instruction,/host_selected_current_manual_section/);
  assert.match(instruction,/not later actions|later actions are not requested/);
  assert.deepEqual(JSON.parse(payloads[0].messages[1].content),{host_selected_current_manual_section:{action:activeGoal.action,expected_result:activeGoal.expected_result}});
  assert.doesNotMatch(payloads[0].messages[1].content,/@r.email|later submit/);
  assert.match(payloads[0].messages[2].content,/@r.email/,'the complete broader constraints remain available');
  await complete({integration,prompt:'Full oversized current goal remains in the structured packet.',activeGoal:{action:'a'.repeat(2001),expected_result:'Exact outcome'}});
  assert.deepEqual(payloads[1].messages.map(message=>message.role),['user'],'an oversized goal is never replaced by a truncated scope hint');
});

test('an oversized HTTP 413 request stops without reissuing the original model payload', async () => {
  let calls = 0, waits = 0;
  const complete = builderRequest(async () => { calls++; return new Response('Private provider organization detail; request exceeds an allowance', { status: 413, headers: { 'retry-after': '0.005' } }); });
  await assert.rejects(complete({ integration, prompt: 'The complete frozen structured contract', onCapacityWait: () => { waits++; } }), error => {
    assert.equal(error.code, 'LLM_REQUEST_TOO_LARGE'); assert.equal(error.nonRetryable, true); assert.equal(error.retryable, false);
    assert.doesNotMatch(error.message, /Private provider|organization detail|TPM|context/i); return true;
  });
  assert.equal(calls, 1); assert.equal(waits, 0);
});

test('typed browser decisions reserve a smaller completion without changing program generation or authored goals',async()=>{
  const payloads=[];
  const complete=builderRequest(async(_url,init)=>{payloads.push(JSON.parse(init.body));return accepted();});
  const goal={action:'Submit the current empty form once',expected_result:'Both exact required-field messages remain visible.'};
  await complete({integration,prompt:'Complete frozen current evidence',activeGoal:goal,browserActor:true});
  assert.equal(payloads[0].max_tokens,2048);
  assert.deepEqual(JSON.parse(payloads[0].messages[1].content).host_selected_current_manual_section,goal);
  await complete({integration,prompt:'Generate the complete non-actor program',browserActor:false});
  assert.equal(payloads[1].max_tokens,undefined,'ordinary source/review budgets still come from managed configuration');
});

test('official GPT-5 actors request low reasoning and one 4096-token total reservation without changing reviews or proxies',async()=>{
 const payloads=[];
 const complete=builderRequest(async(_url,init)=>{payloads.push(JSON.parse(init.body));return accepted();});
 const official={...integration,base_url:'https://api.openai.com/v1',model:'gpt-5'};
 await complete({integration:official,prompt:'Frozen current goal and receipts',browserActor:true});
 assert.equal(payloads[0].max_completion_tokens,4096);assert.equal(payloads[0].max_tokens,undefined);assert.equal(payloads[0].reasoning_effort,'low');
 for(const selected of [{...official,model:'gpt-4o'},{...official,base_url:'https://proxy.example/v1'},{...official,model:'gpt-5-chat-latest'}]){
  await complete({integration:selected,prompt:'Same frozen goal',browserActor:true});
  const request=payloads.at(-1);assert.equal(request.max_tokens,2048);assert.equal(request.reasoning_effort,undefined);assert.equal(request.max_completion_tokens,undefined);
 }
 await complete({integration:official,prompt:'Mandatory independent semantic review',browserActor:false});
 assert.equal(payloads.at(-1).max_completion_tokens,undefined);assert.equal(payloads.at(-1).max_tokens,undefined);assert.equal(payloads.at(-1).reasoning_effort,undefined);
});

test('a truncated GPT-5 actor result is not retried after generation',async()=>{
 let calls=0;
 const truncated=Object.assign(new Error('The completion budget ended before a typed decision was returned.'),{code:'AI_OUTPUT_TRUNCATED'});
 const complete=builderRequest(async()=>{calls++;throw truncated;});
 await assert.rejects(complete({integration:{...integration,base_url:'https://api.openai.com/v1',model:'gpt-5'},prompt:'Keep the same confirmed browser actions',browserActor:true}),error=>error===truncated);
 assert.equal(calls,1);
});

test('only an explicit trusted browser-review phase gets official GPT-5 low reasoning with the same 4096 total budget',async()=>{
 const payloads=[];
 const complete=builderRequest(async(_url,init)=>{payloads.push(JSON.parse(init.body));return accepted();});
 const official={...integration,base_url:'https://api.openai.com/v1',model:'gpt-5'};
 await complete({integration:official,prompt:'Review every original obligation and confirmed operation',browserReview:true});
 assert.equal(payloads[0].reasoning_effort,'low');assert.equal(payloads[0].max_completion_tokens,4096);assert.equal(payloads[0].max_tokens,undefined);
 for(const options of [{},{browserReview:false},{browserReview:'true'}]){
  await complete({integration:official,prompt:'Ordinary story or program generation',...options});
  assert.equal(payloads.at(-1).reasoning_effort,undefined);assert.equal(payloads.at(-1).max_completion_tokens,undefined);assert.equal(payloads.at(-1).max_tokens,undefined);
 }
 for(const selected of [{...official,model:'gpt-4o'},{...official,base_url:'https://proxy.example/v1'},{...official,model:'gpt-5-pro'}]){
  await complete({integration:selected,prompt:'Independent review with another provider/model',browserReview:true});
  assert.equal(payloads.at(-1).reasoning_effort,undefined);assert.equal(payloads.at(-1).max_completion_tokens,undefined);assert.equal(payloads.at(-1).max_tokens,undefined);
 }
 let calls=0;const truncated=Object.assign(new Error('No review verdict returned'),{code:'AI_OUTPUT_TRUNCATED'});
 await assert.rejects(builderRequest(async()=>{calls++;throw truncated;})({integration:official,prompt:'Review without replaying browser actions',browserReview:true}),error=>error===truncated);assert.equal(calls,1);
});

test('the remaining source-generation callback cannot acquire retired actor envelopes or budgets from legacy flags',async()=>{
 const begin=source.indexOf('const completeBuild=async('),end=source.indexOf('\n  try {',begin);
 assert.ok(begin>0&&end>begin);
 const declaration=source.slice(begin,end),goal={id:'current',step_type:'api',action:'Inspect the current response',expected_result:'HTTP 200.'};
 const payloads=[];
 const complete=builderRequest(async(_url,init)=>{payloads.push(JSON.parse(init.body));return accepted();});
 const scope={assertBuildContextAccess:async()=>{},runtimeSpecialist:()=>null,runtimeSpecialistInstructions:()=>'',promptSteps:[goal],completionActiveStepId:'current',planningFlow:false,
  selectedPlatform:{allowed_step_types:['api']},completionAttempt:1,generationModelCalls:new Map(),testCase:{project_id:'project'},created_by:'author',transaction_id:null,
  test_case_id:'case',completionSectionIds:['current'],completionSectionAttempt:1,automationCaseType:'api',knowledgeRows:{knowledge:[],context_transport:'not_required'},
  generationRequested:false,requestChatCompletion:complete,integration:{...integration,base_url:'https://api.openai.com/v1',model:'gpt-5'},buildFeature:key=>key,ai_feature:'ai.agentic.automation-engineer',execution_guard:undefined,
  LLM_TIMEOUT_MS:5000,progress:async()=>{},require:()=>({run:(_context,callback)=>callback()})};
 const run=new Function(...Object.keys(scope),`${declaration};return completeBuild;`)(...Object.values(scope));
 const prompt=JSON.stringify({current_section:goal});
 for(const options of [{browserActor:true,canonicalGoalValidated:true},{browserActor:true},{browserReview:true},
  {generationScope:'section_semantic_review',canonicalGoalValidated:true}])await run(prompt,5000,options);
 for(const payload of payloads){
  assert.deepEqual(payload.messages,[{role:'user',content:prompt}]);
  assert.equal(payload.max_tokens,undefined);assert.equal(payload.max_completion_tokens,undefined);assert.equal(payload.reasoning_effort,undefined);
 }
});

test('the upstream completion callback derives actor tools, review policy and repair limits from its host phase',async()=>{
 const begin=source.indexOf('const complete=async({prompt:input,phase,step,nativeTools,timeoutMs,beforeDispatch})=>'),end=source.indexOf('\n    let result;',begin);
 assert.ok(begin>0&&end>begin);
 const requests=[],traces=[];let checks=0;
 const assertAccess=async()=>{checks++;};
 const scope={assertAccess,browserParameters:{redactUpstream:input=>input.replaceAll('PRIVATE_FIXTURE','[private parameter value]')},
  testCase:{project_id:'project'},created_by:'author',transaction_id:null,test_case_id:'case',automationCaseType:'web',knowledgeRows:{knowledge:[],context_transport:'not_required'},
  requestChatCompletion:async options=>{requests.push(options);return'{}';},integration,buildFeature:key=>key,ai_feature:'ai.agentic.automation-engineer',execution_guard:undefined,
  require:()=>({run:(context,callback)=>{traces.push(context);return callback();}})};
 const complete=new Function(...Object.keys(scope),`${source.slice(begin,end)};return complete;`)(...Object.values(scope));
 const tools=[{name:'browser_click',inputSchema:{type:'object'}}],beforeDispatch=async()=>{};
 for(const phase of ['upstream_browser_actor','upstream_source','upstream_instruction_mapping','verification_repair'])
  await complete({prompt:'Inspect PRIVATE_FIXTURE',phase,step:{id:'current'},nativeTools:tools,timeoutMs:50000,beforeDispatch});
 assert.equal(checks,4);
 assert.deepEqual(requests.map(row=>row.browserActor),[true,false,false,false]);
 assert.deepEqual(requests.map(row=>row.browserReview),[false,true,true,true]);
 assert.deepEqual(requests.map(row=>row.upstreamPhase),traces.map(row=>row.generation_scope));
 assert.equal(requests[0].nativeTools,tools);assert.ok(requests.slice(1).every(row=>row.nativeTools===undefined));
 assert.ok(requests.every(row=>row.beforeDispatch===beforeDispatch&&row.prompt==='Inspect [private parameter value]'));
 assert.equal(requests[3].maxAttempts,1);assert.equal(requests[3].timeoutMs,30000);
 assert.ok(requests.slice(0,3).every(row=>row.maxAttempts===undefined));
});

test('builder capacity waiting propagates lease cancellation before another provider request', async () => {
  const controller = new AbortController(), reason = Object.assign(new Error('Lease changed'), { code: 'BATCH_JOB_LEASE_LOST' });
  let calls = 0;
  const complete = builderRequest(async () => { calls++; return rejected('1'); });
  const started = Date.now();
  await assert.rejects(complete({ integration, prompt: 'Current evidence', timeoutMs: 5000, signal: controller.signal, onCapacityWait: () => { setTimeout(() => controller.abort(reason), 5); } }), error => error === reason);
  assert.ok(Date.now() - started < 1000, 'the active wait must end when ownership is lost');
  assert.equal(calls, 1);
});

test('provider capacity recovery rechecks case and data access before redispatching retained context',async()=>{
 let calls=0,checks=0;
 const denied=Object.assign(new Error('Data access changed'),{statusCode:403});
 const complete=builderRequest(async()=>{calls++;return rejected();});
 await assert.rejects(complete({integration,prompt:'Frozen authorized context',timeoutMs:5000,beforeDispatch:async()=>{if(++checks===2)throw denied;}}),error=>error===denied);
 assert.equal(checks,2);assert.equal(calls,1,'revoked access prevents the retained context from reaching another provider request');
});

test('the upstream host forbids whole-case retry when provider capacity fails after a confirmed native action',async()=>{
 const {buildWithUpstreamPlaywright}=require('../../backend/lib/automationUpstreamEngineer');
 const calls=[],phases=[];let actors=0,saves=0,closes=0;
 const error=createLlmProviderError({status:429,retryAfterMs:46005});
 const startUrl='https://app.test/start',step={id:'current',step_order:1,step_type:'web',action:'Save the form',expected_result:'The saved status appears'};
 const native=code=>({content:[{type:'text',text:`### Ran Playwright code\n\x60\x60\x60js\n${code}\n\x60\x60\x60\nCurrent page`}]});
 await assert.rejects(buildWithUpstreamPlaywright({steps:[step],startUrl,interactive:true,assertAccess:async()=>{},
  browser:{tools:[{name:'browser_navigate',inputSchema:{type:'object',required:['url'],properties:{url:{type:'string'}}}},
   {name:'browser_click',inputSchema:{type:'object',required:['ref'],properties:{ref:{type:'string'}}}}],
   call:async(name,args)=>{calls.push({name,args});return native(name==='browser_navigate'?`await page.goto(${JSON.stringify(startUrl)});`:'await page.getByRole("button", {name:"Save",exact:true}).click();');},
   close:async()=>{closes++;}},
  complete:async request=>{phases.push(request.phase);assert.equal(request.phase,'upstream_browser_actor');
   if(++actors===1)return {tool:{name:'browser_click',arguments:{ref:'save-button'}}};throw error;},
  validate:()=>assert.fail('a failed actor cannot reach source validation'),onSection:async()=>{saves++;}}),actual=>actual===error);
 assert.equal(error.nonRetryable,true);assert.equal(error.active_step_id,step.id);assert.deepEqual(error.saved_step_ids,[]);assert.equal(error.saved_sections,0);
 assert.deepEqual(calls.map(row=>row.name),['browser_navigate','browser_click']);assert.equal(phases.length,2);assert.equal(saves,0);assert.equal(closes,1);
});
