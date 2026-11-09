const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {parse}=require('acorn');
const {retryLlmCapacity}=require('@hellotest/platform/backend/src/utils/llmCapacityRetry');
const {retryActorJsonOutput}=require('../../backend/lib/automationJsonOutputRetry');
const {browserActorRequestPolicy}=require('../../backend/lib/automationActorModelPolicy');
const {createLlmProviderError}=require('@hellotest/platform/backend/src/utils/upstreamLlmError');
const {getCompletionContent}=require('@hellotest/platform/backend/src/utils/llmResponse');
const {aiInstructionBlock}=require('@hellotest/platform/backend/src/utils/aiInstructionBlocks');
const {prepareChatRequest,validateChatResponse}=require('@hellotest/platform/backend/src/utils/llmRequestPolicy');
const source=fs.readFileSync(require.resolve('../../backend/services/aiAutomationBuilder.service'),'utf8');
const declaration=source.slice(source.indexOf('const requestChatCompletion ='),source.indexOf('const normalizeUrlKey ='));
const integration={id:'native-fixture',base_url:'https://api.openai.com/v1',model:'gpt-5',api_key:'fixture-api-key'};
const nativeTools=[{name:'browser_type',description:'Type text into an observed native control.',inputSchema:{type:'object',properties:{ref:{type:'string'},text:{type:'string'},submit:{type:'boolean'},options:{type:'object',properties:{delay:{type:'number'}},additionalProperties:false}},required:['ref','text'],additionalProperties:false}}];
const args={ref:'f1e16',text:'quoted "value"\nnext line',submit:false,options:{delay:0}};
const calls=[{id:'call-native',type:'function',function:{name:'browser_type',arguments:JSON.stringify(args)}}];
const accepted=(toolCalls=calls,content=null)=>new Response(JSON.stringify({choices:[{finish_reason:toolCalls?.length?'tool_calls':'stop',message:{role:'assistant',content,...(toolCalls?{tool_calls:toolCalls}:{})}}]}),{headers:{'content-type':'application/json'}});
function requestCompletion(fetchWithTimeout){
  return new Function('retryActorJsonOutput','retryLlmCapacity','fetchWithTimeout','createLlmProviderError','getCompletionContent','LLM_TIMEOUT_MS','aiInstructionBlock','browserActorRequestPolicy',`${declaration};return requestChatCompletion;`)(retryActorJsonOutput,retryLlmCapacity,fetchWithTimeout,createLlmProviderError,getCompletionContent,5000,aiInstructionBlock,browserActorRequestPolicy);
}

test('the provider request carries original upstream function schemas and normalizes real tool calls once without changing configured transport or actor policy',async()=>{
  const requests=[],controller=new AbortController();let checks=0;
  const complete=requestCompletion(async(url,init,timeoutMs,selected,feature,maxAttempts)=>{
    const prepared=prepareChatRequest(init,{providerUrl:url,integration:selected,maxOutputTokens:8192});
    requests.push({url,init:prepared.init,timeoutMs,selected,feature,maxAttempts,payload:prepared.payload});
    const response=accepted(calls,'{"done":false,"blocked_reason":"text cannot override actual native tool calls"}');
    await validateChatResponse(response,prepared.payload);
    return response;
  });
  const toolsBefore=JSON.stringify(nativeTools);
  const result=await complete({integration,prompt:'Use native tools for the current observed field; final outcomes are JSON.',featureKey:'ai.agentic.automation-engineer',browserActor:true,nativeTools,signal:controller.signal,timeoutMs:5000,beforeDispatch:async()=>{checks++;}});
  assert.deepEqual(result,{tool_calls:[{name:'browser_type',arguments:args}]});assert.equal(requests.length,1);assert.equal(checks,1);
  const sent=requests[0];assert.equal(sent.url,'https://api.openai.com/v1/chat/completions');assert.equal(sent.selected,integration);assert.equal(sent.feature,'ai.agentic.automation-engineer');assert.ok(sent.timeoutMs>0&&sent.timeoutMs<=5000);
  assert.equal(sent.init.signal,controller.signal);assert.equal(sent.init.headers.Authorization,'Bearer fixture-api-key');
  assert.equal(sent.payload.model,'gpt-5');assert.equal(sent.payload.max_completion_tokens,4096);assert.equal(sent.payload.reasoning_effort,'low');
  assert.equal(sent.payload.response_format,undefined);assert.equal(sent.payload.tool_choice,'auto');
  const privateContract=sent.payload.messages.find(message=>message.role==='system'&&message.content.startsWith('HelloTest host contract for configured private inputs:'));
  assert.ok(privateContract);assert.match(privateContract.content,/available configured bindings/);assert.match(privateContract.content,/plaintext values are intentionally omitted/);
  assert.match(privateContract.content,/browser_verify_value\.value/);assert.match(privateContract.content,/reviewed blank binding remains an intentional empty value/);assert.match(privateContract.content,/Do not ask for plaintext/);
  assert.deepEqual(sent.payload.tools,[{type:'function',function:{name:nativeTools[0].name,description:nativeTools[0].description,parameters:nativeTools[0].inputSchema}}]);
  assert.equal(JSON.stringify(nativeTools),toolsBefore,'the discovered upstream schemas remain unchanged');
});

test('native actors retain final JSON text fallback while source and mapping generation retain their existing JSON response contract',async()=>{
  const bodies=[];
  const complete=requestCompletion(async(_url,init)=>{bodies.push(JSON.parse(init.body));return accepted(null,'{"done":true}');});
  assert.equal(await complete({integration,prompt:'Finish the section.',browserActor:true,nativeTools}),'{'+'"done":true}');
  for(const browserActor of [false,undefined])assert.equal(await complete({integration,prompt:'Generate source or map display instructions.',browserActor,nativeTools}),'{'+'"done":true}');
  assert.ok(bodies[0].tools);assert.equal(bodies[0].response_format,undefined);
  for(const body of bodies.slice(1)){assert.equal(body.tools,undefined);assert.equal(body.tool_choice,undefined);assert.deepEqual(body.response_format,{type:'json_object'});assert.equal(body.messages.some(message=>message.content.startsWith('HelloTest host contract for configured private inputs:')),false);}
});

test('malformed or unadvertised native calls never trigger a second provider generation',async()=>{
  for(const [toolCalls,code]of [
    [[{type:'function',function:{name:'browser_type',arguments:'{"ref":'}}],'AI_INVALID_TOOL_ARGUMENTS'],
    [[{type:'function',function:{name:'browser_type',arguments:'[]'}}],'AI_INVALID_TOOL_ARGUMENTS'],
    [[{type:'function',function:{name:'browser_type',arguments:'null'}}],'AI_INVALID_TOOL_ARGUMENTS'],
    [[{type:'function',function:{name:'browser_evaluate',arguments:'{}'}}],'AI_UNEXPECTED_TOOL_CALL']
  ]){
    let requests=0;
    const complete=requestCompletion(async()=>{requests++;return accepted(toolCalls);});
    await assert.rejects(complete({integration,prompt:'Use the observed native catalog.',browserActor:true,nativeTools}),error=>error.code===code&&error.nonRetryable===true);
    assert.equal(requests,1);
  }
  let requests=0;
  const complete=requestCompletion(async()=>{requests++;return new Response(JSON.stringify({error:{code:'json_validate_failed',type:'invalid_request_error',message:'provider refused its output'}}),{status:400});});
  await assert.rejects(complete({integration,prompt:'Use a native tool.',browserActor:true,nativeTools}),error=>error.code==='LLM_REQUEST_REJECTED');
  assert.equal(requests,1,'native function requests do not enter JSON-object-only generation recovery');
});

test('native provider transport uncertainty and revoked access do not add a second dispatch',async()=>{
  let requests=0;const lost=Object.assign(new Error('Native provider connection dropped after dispatch'),{code:'ECONNRESET'});
  const complete=requestCompletion(async()=>{requests++;throw lost;});
  await assert.rejects(complete({integration,prompt:'Retain current native browser state.',browserActor:true,nativeTools}),error=>error===lost);assert.equal(requests,1);
  requests=0;
  const denied=Object.assign(new Error('Build permission revoked'),{statusCode:403});
  await assert.rejects(complete({integration,prompt:'Retain current native browser state.',browserActor:true,nativeTools,beforeDispatch:async()=>{throw denied;}}),error=>error===denied);assert.equal(requests,0);
});

test('actual saved-case and draft-preview completion adapters forward native tools only during the upstream actor phase',async()=>{
  const tree=parse(source,{ecmaVersion:'latest'});let core,preview;
  const hasNativeTools=node=>node?.type==='ArrowFunctionExpression'&&node.params[0]?.type==='ObjectPattern'&&node.params[0].properties.some(property=>property.key?.name==='nativeTools');
  const visit=node=>{
    if(!node||typeof node!=='object')return;
    if(node.type==='VariableDeclarator'&&node.id?.name==='complete'&&hasNativeTools(node.init))core=node.init;
    if(node.type==='Property'&&node.key?.name==='complete'&&hasNativeTools(node.value))preview=node.value;
    for(const value of Object.values(node))if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);
  };visit(tree);assert.ok(core);assert.ok(preview);
  for(const adapter of [core,preview]){
    const requests=[],traces=[];
    const scope={assertAccess:async()=>{},knowledgeRows:{knowledge:[],context_transport:'not_required'},browserParameters:{redactUpstream:value=>value},testCase:{project_id:'project'},created_by:'author',transaction_id:null,test_case_id:'case',automationCaseType:'web',
      integration,featureKey:'ai.agentic.automation-engineer',signal:undefined,execution_guard:undefined,buildFeature:value=>value,ai_feature:'ai.agentic.automation-engineer',appendEvent:async()=>{},
      requestChatCompletion:async options=>{requests.push(options);return {done:true};},require:id=>{assert.ok(id.endsWith('/llmTraceContext'));return {run:(trace,callback)=>{traces.push(trace);return callback();}};}};
    const complete=new Function(...Object.keys(scope),`return (${source.slice(adapter.start,adapter.end)});`)(...Object.values(scope));
    for(const phase of ['upstream_browser_actor','upstream_source','upstream_instruction_mapping'])await complete({phase,prompt:'Current phase contract',step:{id:'one'},nativeTools});
    assert.equal(requests[0].nativeTools,nativeTools);assert.equal(requests[0].browserActor,true);assert.equal(requests[0].browserReview,false);
    for(const request of requests.slice(1)){assert.equal(request.nativeTools,undefined);assert.equal(request.browserActor,false);assert.equal(request.browserReview,true);}
    assert.deepEqual(requests.map(request=>request.upstreamPhase),['upstream_browser_actor','upstream_source','upstream_instruction_mapping']);
    if(adapter===core){assert.deepEqual(traces.map(trace=>trace.generation_scope),['upstream_browser_actor','upstream_source','upstream_instruction_mapping']);assert.ok(traces.every(trace=>trace.mcp_context_depth===1&&trace.mcp_context==='not_required'));}
  }
});
