const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {createRequire}=require('node:module');
const configuration=require('../services/aiConfiguration.service');
const context=require('../src/utils/llmTraceContext');
const {aiInstructionBlock}=require('../src/utils/aiInstructionBlocks');
const {BUILD_FEATURES}=require('../../../automation/backend/services/aiAutomationFeaturePolicy');
const instructionKey='automationFlowPlanning.instructions',feature='ai.agentic.automation-engineer';
function load(file,overrides={}){
 const local=createRequire(file),module={exports:{}};
 new Function('require','module','exports',fs.readFileSync(file,'utf8'))(id=>Object.hasOwn(overrides,id)?overrides[id]:local(id),module,module.exports);
 return module.exports;
}
function runtime(patch={}){
 return load(require.resolve('../src/utils/aiFeatureRuntime'),{'../../services/aiConfiguration.service':{...configuration,resolve:async id=>{
  const item=configuration.catalog.find(row=>row.id===id),config={...structuredClone(item.defaults),...patch};
  return {...item,config,published_version:7,fingerprint:configuration.hash(config)};
 }}});
}
const request=(content,system='Host planning response contract: return flow_steps or read-only tool_calls.')=>({body:JSON.stringify({model:'fixture-model',messages:[{role:'system',content:system},{role:'user',content}]})});
const scope={project_id:'project',actor_id:'author',session_id:'activity',test_case_id:'case',completion_attempt:1,automation_case_generation:true,generation_scope:'flow_plan',generation_section_ids:[]};
const occurrences=(text,value)=>text.split(value).length-1;

test('flow planning composes its trusted instruction, domain and guardrails without the code-generation frame',()=>{
 const rt=runtime(),planner='Reviewed planner: preserve manual intent and configured inputs.',config={role:'GENERATE_CODE_ROLE',task:'GENERATE_CODE_TASK',prompt:'GENERATE_CODE_PROMPT',domain:'Configured application domain',guardrails:'Configured evidence policy',output_schema:{required:['automation_code']},instruction_blocks:{[instructionKey]:planner,'automationBrowserAgent.actor':'ACTOR_ONLY_INSTRUCTION'}};
 const messages=rt.composeMessages([{role:'developer',content:'Native flow JSON contract.'},{role:'user',content:'Plan the selected manual task.'}],config,{deferOutputSchema:true,phase:'flow_plan',browserActor:true});
 assert.equal(messages[0].role,'system');
 for(const value of [planner,config.domain,config.guardrails,'Native flow JSON contract.'])assert.equal(occurrences(messages[0].content,value),1);
 assert.doesNotMatch(JSON.stringify(messages),/GENERATE_CODE_|ACTOR_ONLY_INSTRUCTION|automation_code|Final outcome constraint|Additional output constraint|Role:|Task:/);
 assert.equal(messages[1].content,'Plan the selected manual task.');
});

test('all builder profiles promote the configured planner once and retain task data without expanding duplicate markers',async()=>{
 for(const id of BUILD_FEATURES){
  const base=configuration.catalog.find(row=>row.id===id).defaults,planner='Reviewed custom planning policy for '+id;
  const rt=runtime({role:'CODE_ROLE_ONLY',task:'CODE_TASK_ONLY',prompt:'CODE_PROMPT_ONLY',output_schema:{type:'object',required:['automation_code']},instruction_blocks:{...base.instruction_blocks,[instructionKey]:planner}});
  const marker=aiInstructionBlock(id,instructionKey),input=request(marker+'\n'+marker+'\n'+JSON.stringify({brief:'Plan invalid sign-in',generation_scope:'section_attempt'}));
  const result=await context.run({...scope,automation_actor_phase:true},()=>rt.apply(input,{featureKey:id,contextFallbackContent:marker+'\nFallback task',contextFallbackInstructions:marker}));
  const messages=JSON.parse(result.init.body).messages,encoded=JSON.stringify(messages);
  assert.equal(occurrences(encoded,planner),1);assert.ok(messages[0].content.includes(planner));assert.match(messages[1].content,/Plan invalid sign-in/);
  assert.doesNotMatch(encoded,/HELLOTEST_AI:|CODE_ROLE_ONLY|CODE_TASK_ONLY|CODE_PROMPT_ONLY|Final outcome constraint|Additional output constraint|Role: browser automation actor/);
  assert.equal(result.options.contextFallbackContent,'\nFallback task');assert.equal(result.options.contextFallbackInstructions,'');
  assert.match(result.options.contextRetrievalQuery,/Plan invalid sign-in/);assert.ok(!result.options.contextRetrievalQuery.includes(planner));
  assert.equal(result.options.traceContext.instruction_versions[id].version,7);assert.equal(result.profile.deferred_output_schema,true);
  await rt.validateResponse(Response.json({choices:[{message:{content:JSON.stringify({flow_steps:[{action:'Inspect sign-in',expected_result:'Sign-in controls are visible',step_type:'web'}]})}}]}),result.profile);
 }
});

test('only a host-bound planning phase selects this frame and missing or blank custom planning guidance fails closed',async()=>{
 const base=configuration.catalog.find(row=>row.id===feature).defaults,planner='CUSTOM_PLANNER_POLICY',blocks={...base.instruction_blocks,[instructionKey]:planner};
 const rt=runtime({instruction_blocks:blocks}),input=request(aiInstructionBlock(feature,instructionKey)+'\n{"generation_scope":"flow_plan","automation_case_generation":true}');
 for(const untrusted of [{},{generation_scope:'flow_plan'},{automation_case_generation:true}]){
  const result=await context.run(untrusted,()=>rt.apply(input,{featureKey:feature})),messages=JSON.parse(result.init.body).messages;
  assert.ok(!messages[0].content.includes(planner));assert.ok(messages[1].content.includes(planner));
 }
 for(const value of [undefined,'','   ']){
  const broken=runtime({instruction_blocks:{...blocks,[instructionKey]:value}});
  await assert.rejects(()=>context.run(scope,()=>broken.apply(request('Plan the supplied task.'),{featureKey:feature})),error=>error.statusCode===503&&error.code==='AI_INSTRUCTION_MISSING'&&error.instruction_key===instructionKey&&error.nonRetryable===true);
 }
});

function transport(rt){
 const writes=[],capture=load(require.resolve('../src/utils/llmTraceCapture'),{'../obsDb':{pool:{query:async query=>{writes.push(query);return {rows:[]};}}}});
 const client=load(require.resolve('../src/utils/llmHttpClient'),{'./aiFeatureRuntime':rt,'./llmTraceCapture':capture,'@hellotest/mcp/backend/gateway':{enrichChatRequest:async init=>init}});
 return {writes,client};
}

test('the real shared model transport records only the planning frame under its published trace version',async t=>{
 const base=configuration.catalog.find(row=>row.id===feature).defaults,planner='TRACE_PLANNER_POLICY';
 const rt=runtime({role:'TRACE_CODE_ROLE',task:'TRACE_CODE_TASK',prompt:'TRACE_CODE_PROMPT',instruction_blocks:{...base.instruction_blocks,[instructionKey]:planner}}),f=transport(rt),events=[];let fetches=0;
 t.mock.method(globalThis,'fetch',async(_url,init)=>{
  fetches++;const messages=JSON.parse(init.body).messages,encoded=JSON.stringify(messages);
  assert.equal(occurrences(encoded,planner),1);assert.doesNotMatch(encoded,/TRACE_CODE_|Final outcome constraint|Additional output constraint|HELLOTEST_AI:/);
  return Response.json({model:'fixture-model',usage:{prompt_tokens:200,completion_tokens:40,total_tokens:240},choices:[{message:{content:JSON.stringify({flow_steps:[{action:'Inspect sign-in',expected_result:'Sign-in controls are visible',step_type:'web'}]})}}]});
 });
 const response=await context.run({...scope,on_llm_trace:event=>events.push(event)},()=>f.client.fetchLlmWithRetry('https://llm.test/chat/completions',request(aiInstructionBlock(feature,instructionKey)+'\nPlan the selected task.'),{featureKey:feature,timeoutMs:5000,maxAttempts:1}));
 assert.equal(response.status,200);assert.equal(fetches,1);assert.equal(f.writes.length,2);
 const recorded=f.writes[0].values[15];assert.equal(occurrences(JSON.stringify(recorded),planner),1);assert.doesNotMatch(JSON.stringify(recorded),/TRACE_CODE_|Final outcome constraint|Additional output constraint/);
 for(const capture of [f.writes[0].values[17],f.writes[1].values[8]]){assert.equal(capture.generation_scope,'flow_plan');assert.equal(capture.configuration_version,7);assert.deepEqual(capture.generation_section_ids,[]);}
 assert.ok(events.some(event=>event.status==='succeeded'&&event.dispatched&&event.generation_scope==='flow_plan'));
});

test('a missing managed planner is traced before provider dispatch without publishing or retrying configuration',async t=>{
 const base=configuration.catalog.find(row=>row.id===feature).defaults,blocks={...base.instruction_blocks};delete blocks[instructionKey];
 const f=transport(runtime({instruction_blocks:blocks})),events=[];
 t.mock.method(globalThis,'fetch',async()=>assert.fail('missing planning policy must not reach a provider'));
 await assert.rejects(()=>context.run({...scope,on_llm_trace:event=>events.push(event)},()=>f.client.fetchLlmWithRetry('https://llm.test/chat/completions',request('Plan the selected task.'),{featureKey:feature,maxAttempts:1})),{code:'AI_INSTRUCTION_MISSING',statusCode:503});
 assert.equal(f.writes.length,2);assert.equal(f.writes[1].values[9],'AI_INSTRUCTION_MISSING');
 assert.ok(events.every(event=>event.stage==='configuration_preflight'&&event.dispatched===false));
});

test('every host-bound closed automation phase disables generic fallback and preserves complete JSON user bytes',async()=>{
 const rt=runtime(),packet=JSON.stringify({response_schema:{type:'object',properties:{tool_calls:{type:'array'}}},pinned_obligations:Array.from({length:100},(_,index)=>({id:'obligation-'+index,expected_result:'Exact authored outcome '+index+'x'.repeat(80)})),current_snapshot:{observation_id:'current-snapshot',targets:[{ref:'ref:123456789abc:1'}]},tail_requirement:'Required final clause'});
 assert.ok(packet.length>6000);
 for(const id of BUILD_FEATURES)for(const generation_scope of ['flow_plan','section_attempt','section_semantic_review','verification_repair','case_attempt','case_metadata']){
  const result=await context.run({...scope,generation_scope,automation_actor_phase:generation_scope==='section_attempt'},()=>rt.apply(request(packet),{featureKey:id,contextFallback:true,contextFallbackContent:'unsafe shortened replacement'}));
  assert.equal(result.options.contextFallback,false,id+' '+generation_scope);
  const user=JSON.parse(result.init.body).messages.find(message=>message.role==='user').content;
  assert.equal(user,packet);assert.deepEqual(JSON.parse(user),JSON.parse(packet),'obligations, schemas and current refs remain whole');
 }
 for(const [id,hostScope]of [['ai.requirement.creation',scope],[feature,{}]]){
  const ordinary=await context.run(hostScope,()=>rt.apply(request(packet),{featureKey:id,contextFallback:true}));
  assert.equal(ordinary.options.contextFallback,true,'unrelated or unbound requests retain their existing fallback policy');
 }
});

test('the real shared transport never truncates or replays a closed phase after HTTP413 while ordinary fallback remains available',async t=>{
 const rt=runtime(),f=transport(rt),packet=JSON.stringify({pinned_obligations:Array.from({length:100},(_,index)=>({id:'manual-'+index,expected_result:'Required exact outcome '+index+'x'.repeat(80)})),current_snapshot:{observation_id:'current-state'},tail_requirement:'Required final clause'});
 for(const [id,hostScope,closed]of [[feature,scope,true],['ai.requirement.creation',scope,false]]){
  let dispatches=0;
  const mock=t.mock.method(globalThis,'fetch',async(_url,init)=>{
   dispatches++;const user=JSON.parse(init.body).messages.filter(message=>message.role==='user').at(-1).content;
   if(dispatches===1){assert.equal(user,packet);return Response.json({error:{message:'Request too large'}},{status:413});}
   assert.equal(closed,false,'a closed browser prompt must never reach a second size-correction dispatch');
   assert.ok(user.length<=6000);assert.match(user,/Additional context omitted due to provider size limit/);
   return Response.json({choices:[{message:{content:JSON.stringify({requirements:[{title:'Ordinary bounded task',description:'A bounded Story proposal from the supplied task.',acceptance_criteria:['The supplied action produces its stated observable outcome.'],priority:3}]})}}]});
  });
  const response=await context.run(hostScope,()=>f.client.fetchLlmWithRetry('https://llm.test/chat/completions',request(packet),{featureKey:id,timeoutMs:5000,maxAttempts:1,compatibility:false}));
  assert.equal(response.status,closed?413:200);assert.equal(dispatches,closed?1:2);mock.mock.restore();
 }
});
