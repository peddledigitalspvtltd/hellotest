const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {createRequire}=require('node:module');
const configuration=require('../services/aiConfiguration.service');
const {aiInstructionBlock}=require('../src/utils/aiInstructionBlocks');
function load(file,overrides){const local=createRequire(file),module={exports:{}};new Function('require','module','exports',fs.readFileSync(file,'utf8'))(id=>Object.hasOwn(overrides,id)?overrides[id]:local(id),module,module.exports);return module.exports;}
const runtime=(configs={},overrides={})=>load(require.resolve('../src/utils/aiFeatureRuntime'),{'../../services/metricGovernance.service':{resolveForFeature:async()=>({instruction:'',metrics:[]})},'../../services/aiConfiguration.service':{...configuration,resolve:async id=>{const item=configuration.catalog.find(item=>item.id===id);assert.ok(item,id);const config={...structuredClone(item.defaults),...configs[id]};return {...item,config,published_version:3,fingerprint:configuration.hash(config)};}},...overrides});
const request=(messages,extras={})=>({body:JSON.stringify({model:'provider-model',messages,...extras})});
for (const source of ['legacy','published']) test(`Test Case generation replaces a persisted ${source} NFR-only prompt after publishing the current default`,async()=>{
 const id='ai.test_case.design',item=configuration.catalog.find(feature=>feature.id===id);
 const nfrPrompt='You are a Senior QA Architect specializing in Non-Functional Testing. Testing mode: NFR_ONLY. Generate ONLY NFR test cases. If no sufficiently evidenced NFR exists, return {"applicable_domain":"general","testCases":[]}.';
 const customized={...structuredClone(item.defaults),prompt:nfrPrompt,temperature:0.35,max_output_tokens:6000};
 let record=source==='published'?{revision:4,published:{version:3,config:customized}}:null;
 const service=load(require.resolve('../services/aiConfiguration.service'),{'../src/db':{prepare:()=>({
  get:async key=>key===`ai_feature_configuration:${id}`&&record?{value:record}:undefined,
  all:async()=>[{key:'workspace_governed_preference:ai_prompt_registry_overrides',value:source==='legacy'?{[id]:nfrPrompt}:{}}]
 })}});
 const rt=load(require.resolve('../src/utils/aiFeatureRuntime'),{'../../services/aiConfiguration.service':service});
 const task={generation_request:{user_request:'Generate positive end-to-end registration cases with confirmation email and welcome-page checks.'},stories:[{title:'User Registration Process',description:'Register a new user and confirm their email.'}]};
 const input=request([{role:'system',content:aiInstructionBlock(id,'format.structured')},{role:'user',content:JSON.stringify(task)}]);
 const oldProfile=await service.resolve(id);
 assert.equal(oldProfile.configuration_source,source==='legacy'?'legacy_override':'published');
 assert.deepEqual(oldProfile.legacy_override_fields,source==='legacy'?['prompt']:[]);
 const before=await rt.apply(input,{featureKey:id});
 assert.equal(before.options.traceContext.configuration_source,oldProfile.configuration_source);
 assert.match(JSON.parse(before.init.body).messages[0].content,/Testing mode: NFR_ONLY/,'A deployment preserves administrator-saved coverage instructions');
 assert.deepEqual(JSON.parse(JSON.parse(before.init.body).messages[1].content),task,'The workflow already supplies its functional intent');
 // Publish a prompt-only reset while retaining the existing controls. The
 // legacy row intentionally remains: publication must supersede it at runtime.
 record={revision:(record?.revision||0)+1,published:{version:(record?.published.version||0)+1,config:{...oldProfile.config,prompt:item.defaults.prompt}}};
 const after=await rt.apply(input,{featureKey:id});
 const resolved=await service.resolve(id),body=JSON.parse(after.init.body);
 assert.doesNotMatch(body.messages[0].content,/NFR_ONLY/);
 assert.ok(body.messages[0].content.includes(item.defaults.prompt));
 assert.deepEqual(JSON.parse(body.messages[1].content),task);
 assert.equal(after.options.traceContext.configuration_version,record.published.version);
 assert.equal(after.options.traceContext.configuration_source,'published');
 assert.equal(resolved.configuration_source,'published');
 assert.deepEqual(resolved.legacy_override_fields,[]);
 assert.equal(after.options.traceContext.configuration_hash,resolved.fingerprint);
 for(const key of Object.keys(oldProfile.config).filter(key=>key!=='prompt'))assert.deepEqual(resolved.config[key],oldProfile.config[key],key);
});
test('all catalog defaults validate and operation aliases are unambiguous',()=>{
 const keys=new Set();for(const item of configuration.catalog){assert.deepEqual(configuration.validate(item.defaults,item.id),item.defaults);for(const key of [item.id,...item.aliases]){assert.ok(!keys.has(key),key);keys.add(key);}}
 const published=require('../../shared/aiPromptDefaults.json');for(const item of published)assert.equal(item.value,configuration.catalog.find(feature=>feature.id===item.key).defaults.prompt);
});
test('recognized stock legacy prompt migrations identify the effective default while preserving provider override provenance',async()=>{
 const id='ai.test_case.design',item=configuration.catalog.find(feature=>feature.id===id),old=item.prompt_default_migrations[0];
 assert.ok(old);
 for(const provider of [null,'reviewed-project-provider']){
  const service=load(require.resolve('../services/aiConfiguration.service'),{'../src/db':{prepare:()=>({get:async()=>undefined,all:async()=>[
   {key:'workspace_governed_preference:ai_prompt_registry_overrides',value:{[id]:old}},
   {key:'workspace_governed_preference:ai_prompt_registry_llm_overrides',value:provider?{[id]:provider}:{}}
  ]})}});
  const profile=await service.resolve(id);
  assert.equal(profile.config.prompt,item.defaults.prompt);
  assert.equal(profile.configuration_source,provider?'legacy_override':'instance_default');
  assert.deepEqual(profile.legacy_override_fields,provider?['integration_id']:[]);
  if(provider)assert.equal(profile.config.integration_id,provider);
 }
});
test('API runtime instructions migrate recognized stock guidance and retain reviewed custom Admin blocks',async()=>{
 const id='ai.automation.keyword_generation',key='aiAutomationBuilder.prompt.45',item=configuration.catalog.find(item=>item.id===id);
 const old=item.instruction_default_migrations[key].at(-1);
 assert.ok(old);assert.match(item.defaults.instruction_blocks[key],/json_schema/);assert.match(item.defaults.instruction_blocks[key],/credential_reference/);
 for(const [text,expected] of [[old,item.defaults.instruction_blocks[key]],['Our reviewed API contract guidance.','Our reviewed API contract guidance.']]){
  const config={...structuredClone(item.defaults),instruction_blocks:{...item.defaults.instruction_blocks,[key]:text}};
  const service=load(require.resolve('../services/aiConfiguration.service'),{'../src/db':{prepare:()=>({get:async()=>({value:{published:{version:1,config}}})})}});
  assert.equal((await service.resolve(id)).config.instruction_blocks[key],expected);
 }
});
test('conditional API field guidance upgrades recognized stock templates without changing reviewed provider instructions',async()=>{
 const id='ai.automation.keyword_generation',key='automationBuild.apiRuntime',item=configuration.catalog.find(item=>item.id===id);
 const previous=item.instruction_default_migrations[key].at(-1),current=item.defaults.instruction_blocks[key];
 assert.match(current,/for auth.type none emit only/);assert.match(current,/Omit operator on status/);
 for(const [text,expected] of [[previous,current],['Reviewed API authentication and assertion policy.','Reviewed API authentication and assertion policy.']]){
  const config={...structuredClone(item.defaults),instruction_blocks:{...item.defaults.instruction_blocks,[key]:text}};
  const service=load(require.resolve('../services/aiConfiguration.service'),{'../src/db':{prepare:()=>({get:async()=>({value:{published:{version:1,config}}})})}});
  assert.equal((await service.resolve(id)).config.instruction_blocks[key],expected);
 }
});
test('invalid sampling, recursive context, arbitrary config keys and unsafe schema fail before publish',()=>{
 const item=configuration.catalog[0],base=structuredClone(item.defaults);
 for(const patch of [{temperature:3},{max_output_tokens:0},{integration_id:[]},{context:{...base.context,required:true,mode:'none'}},{arbitrary_command:'exec'},{output_schema:{type:'object',properties:{value:{$ref:'https://outside.test/schema'}}}},{output_schema:{type:'object',properties:{value:{pattern:'(x+)+$'}}}}])assert.throws(()=>configuration.validate({...base,...patch},item.id),{statusCode:400});
 const planning=configuration.catalog.find(item=>item.id==='ai.knowledge.intent');assert.throws(()=>configuration.validate({...planning.defaults,context:{...planning.defaults.context,mode:'mcp'}},planning.id),{statusCode:400});
 const key=Object.keys(base.instruction_blocks)[0];assert.throws(()=>configuration.validate({...base,instruction_blocks:{[key]:'incomplete'}},item.id),{statusCode:400});
});
test('reserved controls reject publication and optimization instead of advertising active model settings',async()=>{
 const id='ai.execution.case_triage';
 await assert.rejects(configuration.mutate(id,{expected_revision:0,config:configuration.catalog.find(item=>item.id===id).defaults},{actorId:'admin'},'publish'),{statusCode:422});
 await assert.rejects(configuration.optimize(id,{}, {actorId:'admin'}),{statusCode:422});
});
test('published controls apply at shared model boundary while preserving task data and images',async()=>{
 const id='ai.requirement.creation',controls={prompt:'Published Story instructions',temperature:0.45,top_p:0.8,max_output_tokens:2048};
 const rt=runtime({[id]:controls});
 const input=request([{role:'system',content:'Required shape: {title:string}'},{role:'user',content:[{type:'text',text:'Checkout task data'},{type:'image_url',image_url:{url:'https://fixture.test/image.png'}}]}],{max_tokens:1000});
 const result=await rt.apply(input,{operation:'requirement.generate'}),body=JSON.parse(result.init.body);
  assert.match(body.messages[0].content,/Published Story instructions/);assert.match(body.messages[0].content,/Required shape/);assert.equal(body.messages[1].content[1].image_url.url,'https://fixture.test/image.png');
  assert.match(body.messages[0].content,/Honor the user['’]s explicit/);
 assert.equal(body.temperature,0.45);assert.equal(body.top_p,0.8);assert.equal(body.max_tokens,1000);assert.equal(result.options.traceContext.feature,id);assert.equal(result.options.traceContext.configuration_version,3);
 const negotiated=JSON.parse((await rt.apply(input,{operation:'requirement.generate',sampling:false})).init.body);assert.equal(negotiated.temperature,undefined);assert.equal(negotiated.top_p,undefined);
});
test('retrieval queries use artifact data before managed instructions consume the query budget',async()=>{
 const id='ai.requirement.optimization',base=configuration.catalog.find(item=>item.id===id).defaults,key=Object.keys(base.instruction_blocks)[0];
 const rt=runtime({[id]:{instruction_blocks:{...base.instruction_blocks,[key]:'Scaffold '.repeat(1500)}}});
 const result=await rt.apply(request([{role:'user',content:aiInstructionBlock(id,key)+'\n'+JSON.stringify({id:'story-1',title:'Refund boundaries',acceptance_criteria:['Reject duplicate refunds']})+'\nUser guidance: Cover the partial refund.'}]),{operation:'requirement.optimize'});
 assert.match(result.options.contextRetrievalQuery,/Refund boundaries.*Reject duplicate refunds/s);
 assert.match(result.options.contextRetrievalQuery,/Cover the partial refund/);
 assert.doesNotMatch(result.options.contextRetrievalQuery,/Scaffold|HELLOTEST_AI/);
});
test('image-only authoring preserves an absent semantic retrieval query through managed configuration',async()=>{
 const id='ai.test_case.design',rt=runtime();
 const result=await rt.apply(request([{role:'system',content:aiInstructionBlock(id,'evidence.imageOnly')},{role:'user',content:[{type:'text',text:JSON.stringify({generation_request:{user_request:''},reference_images:[{name:'Screenshot.png'}]})},{type:'image_url',image_url:{url:'data:image/png;base64,fixture'}}]}]),{featureKey:id,contextRetrievalQuery:null});
 assert.equal(result.options.contextRetrievalQuery,null);
 assert.match(JSON.parse(result.init.body).messages[0].content,/No written test brief/);
});
test('instruction block edits and fallback prompts expand from published versions without unresolved markers',async()=>{
 const id='ai.requirement.optimization',base=configuration.catalog.find(item=>item.id===id).defaults,key=Object.keys(base.instruction_blocks)[0];
 const rt=runtime({[id]:{instruction_blocks:{...base.instruction_blocks,[key]:'Published detailed guidance'}}});
 const marker=aiInstructionBlock(id,key),result=await rt.apply(request([{role:'user',content:marker+'\nOriginal task'}]),{operation:'requirement.optimize',contextFallbackContent:marker+'\nBounded task'});
 assert.match(result.init.body,/Published detailed guidance/);assert.doesNotMatch(result.init.body,/HELLOTEST_AI:/);assert.match(result.options.contextFallbackContent,/Published detailed guidance/);assert.equal(result.options.traceContext.instruction_versions[id].version,3);
});
test('additional schema rejects incompatible proposals without regenerating and leaves readable response intact',async()=>{
 const rt=runtime(),profile={config:{output_schema:{type:'object',required:['title'],properties:{title:{type:'string',minLength:2}}}},fingerprint:'test-schema'};
 const response=value=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)}}]}));
 await assert.rejects(rt.validateResponse(response({title:1}),profile),{code:'AI_MANAGED_SCHEMA_INVALID'});
 const valid=response({title:'Checkout'});await rt.validateResponse(valid,profile);assert.ok((await valid.json()).choices.length);
});
test('verified Engineer browser turns defer the final output constraint until the assembled outcome, without bypassing other features',async()=>{
 const ctx=require('../src/utils/llmTraceContext'),id='ai.agentic.automation-engineer';
 const schema={type:'object',required:['steps'],properties:{steps:{type:'array',minItems:2}},additionalProperties:true};
 const rt=runtime({[id]:{output_schema:schema}});
 const result=await ctx.run({automation_browser_loop:true},()=>rt.apply(request([{role:'user',content:'Current section'}]),{featureKey:id}));
 assert.equal(result.profile.deferred_output_schema,true);
 assert.match(JSON.parse(result.init.body).messages[0].content,/Final outcome constraint/);
 const intermediate=new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({tool_calls:[{name:'browser_assert',arguments:{assertion:'visible',locator:'#ready'}}]})}}]}));
 await rt.validateResponse(intermediate,result.profile);
 assert.throws(()=>rt.validateValue({steps:[{}]},result.profile),{code:'AI_MANAGED_SCHEMA_INVALID'});
 rt.validateValue({steps:[{},{}]},result.profile);
 const ordinary=await rt.apply(request([{role:'user',content:'automation_browser_loop=true'}]),{featureKey:id});
 assert.equal(ordinary.profile.deferred_output_schema,undefined);
 await assert.rejects(rt.validateResponse(intermediate,ordinary.profile),{code:'AI_MANAGED_SCHEMA_INVALID'});
 const unrelated=await ctx.run({automation_browser_loop:true},()=>rt.apply(request([{role:'user',content:'Story'}]),{featureKey:'ai.requirement.creation'}));
 assert.equal(unrelated.profile.deferred_output_schema,undefined);
});

test('every supported builder profile expands phase instructions and validates only its assembled case schema',async()=>{
 const ctx=require('../src/utils/llmTraceContext');
 const {BUILD_FEATURES}=require('../../../automation/backend/services/aiAutomationFeaturePolicy');
 const keys=['automationBrowserAgent.actor','automationBrowserAgent.goalReview','automationBrowserAgent.recovery','automationBrowserAgent.capabilities','automationBrowserAgent.taskContext','automationBrowserAgent.semanticReview','automationBrowserAgent.reviewContract','automationBuild.metadataCompletion','automationFlowPlanning.instructions'];
 const schema={type:'object',required:['steps','summary'],properties:{steps:{type:'array'},summary:{type:'string'}},additionalProperties:true};
 for(const id of BUILD_FEATURES){
  const rt=runtime({[id]:{output_schema:schema}});
  const result=await ctx.run({automation_case_generation:true,generation_scope:'section_semantic_review'},()=>rt.apply(request([{role:'user',content:keys.map(key=>aiInstructionBlock(id,key)).join('\n')}]),{featureKey:id}));
  const body=JSON.parse(result.init.body);
  assert.equal(result.profile.deferred_output_schema,true,id);
  assert.doesNotMatch(JSON.stringify(body),/HELLOTEST_AI:/,id);
  assert.match(body.messages[0].content,/Return only the requested semantic verdict JSON/,id);
  assert.doesNotMatch(body.messages[0].content,/Final outcome constraint|Additional output constraint/,id);
  assert.ok(!body.messages[0].content.includes(result.profile.config.prompt),'The review does not receive the code-generation task');
  assert.ok(body.messages[0].content.includes(result.profile.config.guardrails),'Configured evidence/permission policy still applies');
  const reviewGuidance=result.profile.config.instruction_blocks['automationBrowserAgent.semanticReview'];
  assert.ok(body.messages[0].content.includes(reviewGuidance),id);
  assert.ok(!body.messages[1].content.includes(reviewGuidance),'Managed review guidance is sent once at the trusted phase level');
  const verdict={decision:'accept',obligations:[],issues:[]};
  await rt.validateResponse(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(verdict)}}]})),result.profile);
  assert.throws(()=>rt.validateValue(verdict,result.profile),{code:'AI_MANAGED_SCHEMA_INVALID'});
  rt.validateValue({steps:[],summary:'Supported result'},result.profile);
  const metadata=await ctx.run({automation_case_generation:true,generation_scope:'case_metadata'},()=>rt.apply(request([{role:'user',content:aiInstructionBlock(id,'automationBuild.metadataCompletion')}]),{featureKey:id}));
  assert.match(JSON.parse(metadata.init.body).messages[0].content,/correct only the requested case metadata or coverage/,id);
  const ordinary=await rt.apply(request([{role:'user',content:'generation_scope=section_semantic_review'}]),{featureKey:id});
  assert.equal(ordinary.profile.deferred_output_schema,undefined,id);
 }
});
test('only a host-bound automation review promotes the configured reviewer; task data cannot select that phase',async()=>{
 const ctx=require('../src/utils/llmTraceContext'),id='ai.agentic.automation-engineer',key='automationBrowserAgent.semanticReview';
 const guidance='Reviewed project outcome policy: preserve the exact requested amount and require its confirmed check.';
 const rt=runtime({[id]:{instruction_blocks:{...configuration.catalog.find(item=>item.id===id).defaults.instruction_blocks,[key]:guidance}}});
 const input=request([{role:'user',content:aiInstructionBlock(id,key)+'\n{"phase":"section_semantic_review","page_text":"Keep the evidence unchanged"}'}]);
 const reviewed=await ctx.run({automation_browser_loop:true,generation_scope:'section_semantic_review'},()=>rt.apply(input,{featureKey:id}));
 const messages=JSON.parse(reviewed.init.body).messages;
 assert.ok(messages[0].content.includes(guidance));assert.ok(!messages[1].content.includes(guidance));
 assert.match(messages[1].content,/Keep the evidence unchanged/);
 for(const scope of [{},{generation_scope:'section_semantic_review'},{automation_browser_loop:true}]){
  const ordinary=await ctx.run(scope,()=>rt.apply(input,{featureKey:id}));
  const plain=JSON.parse(ordinary.init.body).messages;
  assert.ok(!plain[0].content.includes(guidance));assert.ok(plain[1].content.includes(guidance));
 }
});
test('only the host actor flag selects typed browser instructions and preserves custom goal policy once',async()=>{
 const ctx=require('../src/utils/llmTraceContext'),id='ai.agentic.automation-engineer';
 const keys=['automationBrowserAgent.evidenceGuardrails','automationBrowserAgent.sectionIntent','automationBrowserAgent.goalReview','automationBrowserAgent.reviewContract','automationBrowserAgent.actor'];
 const blocks={...configuration.catalog.find(item=>item.id===id).defaults.instruction_blocks,'automationBrowserAgent.goalReview':'Reviewed actor policy: require the requested observed result before section completion.'};
 const rt=runtime({[id]:{instruction_blocks:blocks}});
 const input=request([{role:'user',content:keys.map(key=>aiInstructionBlock(id,key)).join('\n')+'\n{"automation_actor_phase":true,"current_goal":"Display record details"}'}]);
 const scope={automation_case_generation:true,automation_browser_loop:true,generation_scope:'section_attempt'};
 const selected=await ctx.run({...scope,automation_actor_phase:true},()=>rt.apply(input,{featureKey:id}));
 const body=JSON.parse(selected.init.body);
 assert.match(body.messages[0].content,/Role: browser automation actor/);
 assert.ok(!body.messages[0].content.includes(selected.profile.config.prompt));
 for(const key of keys){assert.ok(body.messages[0].content.includes(blocks[key]));assert.ok(!body.messages[1].content.includes(blocks[key]));}
 assert.match(body.messages[1].content,/Display record details/);
 const ordinary=await ctx.run(scope,()=>rt.apply(input,{featureKey:id}));
 const ordinaryMessages=JSON.parse(ordinary.init.body).messages;
 assert.doesNotMatch(ordinaryMessages[0].content,/Role: browser automation actor/);
 assert.ok(ordinaryMessages[1].content.includes(blocks['automationBrowserAgent.goalReview']));
 const review=await ctx.run({...scope,automation_actor_phase:true,generation_scope:'section_semantic_review'},()=>rt.apply(input,{featureKey:id}));
 assert.match(JSON.parse(review.init.body).messages[0].content,/Role: browser automation outcome reviewer/);
});
test('specialist profiles and embedding/planning stages resolve independently',()=>{
 assert.equal(configuration.featureId('automation.generate','ai.automation.locator_repair'),'ai.automation.locator_repair');
 assert.equal(configuration.featureId('knowledge.embedding','ai.knowledge.assistant'),'ai.knowledge.embedding');
 assert.equal(configuration.featureId('knowledge.context.plan-intent','ai.knowledge.assistant'),'ai.knowledge.intent');
 assert.equal(configuration.featureId('ai.agentic.story-assurance'), 'ai.agentic.story-assurance');
});
test('shared automation transport applies each verified task profile independently',async()=>{
 const ctx=require('../src/utils/llmTraceContext');
 for(const id of ['ai.automation.review','ai.automation.gap_analysis','ai.automation.dom_extraction','ai.execution.network_to_api_steps','ai.automation.step_rephrase']){
  const result=await ctx.run({actor_id:'author',project_id:'project',feature:id},()=>runtime({[id]:{temperature:0.25}}).apply(request([{role:'user',content:'Selected case task data'}]),{operation:id==='ai.automation.step_rephrase'?'case-authoring.step-rephrase':'automation.generate'}));
  assert.equal(result.options.traceContext.feature,id);assert.equal(JSON.parse(result.init.body).temperature,0.25);
 }
});
test('project-defined agents inherit the managed workflow profile without losing their native instructions',async()=>{
 const rt=runtime(),base=configuration.catalog.find(item=>item.id==='ai.agentic.workflow'),key=Object.keys(base.defaults.instruction_blocks)[0];
 const result=await rt.apply(request([{role:'system',content:'Custom project-agent instructions. '+aiInstructionBlock(base.id,key)},{role:'user',content:'Review the selected record.'}]),{featureKey:'ai.agentic.agent-custom-project-id',operation:'agentic-assistant.respond'});
 assert.equal(result.options.traceContext.feature,'ai.agentic.workflow');assert.match(result.init.body,/Custom project-agent instructions/);assert.doesNotMatch(result.init.body,/HELLOTEST_AI:/);
});
test('managed stage provider uses the verified actor/project and preserves explicit user selections',async()=>{
 const id='ai.knowledge.intent',selected=[];
 const rt=runtime({[id]:{integration_id:'stage-model'}},{
  '@hellotest/integration/backend/services/aiLlmSelection.service':{resolveLlmIntegrationForUsage:async input=>{selected.push(input);return {id:'stage-model',model:'stage-provider-model',base_url:'https://stage-model.example.test/v1',api_key:'fixture-token',config:{project_id:'p'}};}},
  '@hellotest/integration/backend/services/integration.service':{isUsableApiCredential:value=>Boolean(value)},
  './knowledgeModelRetry':{validateModelEndpoint:url=>assert.match(url,/^https:\/\//)}
 });
 const input=request([{role:'user',content:'Plan retrieval'}]);input.headers={Authorization:'Bearer previous-fixture-token'};
 const ctx=require('../src/utils/llmTraceContext');
 const result=await ctx.run({actor_id:'u',project_id:'p',integration_fallback:'project-scoped'},()=>rt.apply(input,{operation:'knowledge.context.plan-intent',integration:{id:'original-model'}}));
 assert.equal(selected[0].projectId,'p');assert.equal(selected[0].userId,'u');assert.equal(result.options.integration.id,'stage-model');assert.equal(JSON.parse(result.init.body).model,'stage-provider-model');assert.equal(result.init.headers.get('Authorization'),'Bearer fixture-token');assert.equal(result.url,'https://stage-model.example.test/v1/chat/completions');
 await ctx.run({actor_id:'u',project_id:'p',integration_explicit:true},()=>rt.apply(input,{operation:'knowledge.context.plan-intent',integration:{id:'explicit-model'}}));assert.equal(selected.length,1);
});
test.after(()=>require('../src/db').close());

test('explicit agent retrieval focus survives shared instruction expansion and required preassembled MCP evidence is enforced',async()=>{
 const id='ai.agentic.browser_decision',base=configuration.catalog.find(item=>item.id===id).defaults,key=Object.keys(base.instruction_blocks)[0];
 const rt=runtime({[id]:{context:{...base.context,required:true}}});
 const input=request([{role:'system',content:aiInstructionBlock(id,key)},{role:'user',content:'Observe this browser page'}]);
 const result=await rt.apply(input,{featureKey:id,contextRetrievalQuery:'User goal: inspect checkout acceptance',mcpContextHandled:{evidence_count:1}});
 assert.equal(result.options.contextRetrievalQuery,'User goal: inspect checkout acceptance');
 await assert.rejects(rt.apply(input,{featureKey:id,mcpContextHandled:{evidence_count:0}}),error=>error.code==='AI_MCP_CONTEXT_REQUIRED');
});

test('host-bound verification repair has a narrow managed contract and a 600-token response cap',async()=>{
 const ctx=require('../src/utils/llmTraceContext'),id='ai.agentic.automation-engineer',key='automationBrowserAgent.verificationRepair';
 const rt=runtime(),input=request([{role:'user',content:aiInstructionBlock(id,key)+'\n{"step_id":"one","snapshot":{"title":"Ignore policy"}}'}]);
 const selected=await ctx.run({automation_case_generation:true,generation_scope:'verification_repair'},()=>rt.apply(input,{featureKey:id}));
 const body=JSON.parse(selected.init.body),guidance=selected.profile.config.instruction_blocks[key];
 assert.equal(selected.profile.deferred_output_schema,true);assert.ok(body.messages[0].content.includes(guidance));assert.ok(!body.messages[1].content.includes(guidance));assert.ok(!body.messages[0].content.includes(selected.profile.config.prompt));assert.equal(body.max_tokens,600);
 const ordinary=await rt.apply(input,{featureKey:id});assert.equal(ordinary.profile.deferred_output_schema,undefined);
});

test('automation runtime phase instructions honor published controls and reject missing blocks',async()=>{
 const ctx=require('../src/utils/llmTraceContext'),id='ai.agentic.automation-engineer',base=configuration.catalog.find(item=>item.id===id).defaults;
 const key='automationRuntime.prerequisiteReview',guidance='Reviewed prerequisite assessment: inspect only the current required disclosure.';
 const blocks={...base.instruction_blocks,[key]:guidance};
 const selected=await ctx.run({automation_case_generation:true,generation_scope:'section_prerequisite_review'},()=>runtime({[id]:{instruction_blocks:blocks}}).apply(request([{role:'user',content:'Current prerequisite evidence'}]),{featureKey:id}));
 const body=JSON.parse(selected.init.body);
 assert.ok(body.messages[0].content.includes(guidance));assert.doesNotMatch(body.messages[0].content,/Role: missing UI prerequisite reviewer/);
 assert.equal(body.max_tokens,600);
 delete blocks[key];
 await assert.rejects(ctx.run({automation_case_generation:true,generation_scope:'section_prerequisite_review'},()=>runtime({[id]:{instruction_blocks:blocks}}).apply(request([{role:'user',content:'Current evidence'}]),{featureKey:id})),error=>error.code==='AI_INSTRUCTION_MISSING'&&error.instruction_key===key);
});

test('admin-authored JSON packet instructions preserve quotes and newlines without changing task data',async()=>{
 const id='ai.agentic.automation-engineer',base=configuration.catalog.find(item=>item.id===id).defaults,key='automationFlowPlanning.protocol';
 const guidance='Reviewed guidance: preserve "empty" values.\nKeep the original requested action.';
 const rt=runtime({[id]:{instruction_blocks:{...base.instruction_blocks,[key]:guidance}}});
 const task={phase:'flow_plan',planning_protocol:{instructions:aiInstructionBlock(id,key)},user_request:'Do not change this task.'};
 for(const content of [JSON.stringify(task),`Task data:\n${JSON.stringify(task)}`]){
  const applied=await rt.apply(request([{role:'user',content}]),{featureKey:id});
  const user=JSON.parse(applied.init.body).messages.at(-1).content;
  const result=JSON.parse(user.replace(/^Task data:\n/,''));
  assert.equal(result.planning_protocol.instructions,guidance);assert.equal(result.user_request,task.user_request);
 }
});

test('the current manual goal keeps its exact structured data while published scope guidance is applied',async()=>{
 const id='ai.agentic.automation-engineer',base=configuration.catalog.find(item=>item.id===id).defaults,key='automationBrowserAgent.activeGoal';
 const guidance='Reviewed current-section guidance. Preserve the complete pinned action and outcomes.';
 const rt=runtime({[id]:{instruction_blocks:{...base.instruction_blocks,[key]:guidance}}});
 const goal={host_selected_current_manual_section:{action:'Open "Invoice" details',expected_result:'The amount and currency are visible'}};
 const result=await rt.apply(request([{role:'system',content:aiInstructionBlock(id,key)},{role:'user',content:JSON.stringify(goal)},{role:'user',content:'Broader case context'}]),{featureKey:id});
 const messages=JSON.parse(result.init.body).messages;
 assert.ok(messages[0].content.includes(guidance));assert.deepEqual(JSON.parse(messages[1].content),goal);assert.equal(messages[2].content,'Broader case context');
});

test('specialist execution limits are published configuration with bounded total corrections and handoffs',()=>{
 const id='ai.agentic.story-architect',base=structuredClone(configuration.catalog.find(item=>item.id===id).defaults);
 assert.ok(base.instruction_blocks['agenticAssistant.outcomes']);assert.ok(base.instruction_blocks['agenticAssistant.revision']);
 const allowed={max_model_calls:2,max_revision_rounds:1,max_followups:0,timeout_ms:30000};
 assert.deepEqual(configuration.validate({...base,agent_execution:allowed},id).agent_execution,allowed);
 for(const policy of [{...allowed,max_model_calls:0},{...allowed,max_model_calls:9},{...allowed,max_revision_rounds:2},{...allowed,max_followups:4},{...allowed,timeout_ms:200000},{...allowed,unsafe_extra:1}])assert.throws(()=>configuration.validate({...base,agent_execution:policy},id),{statusCode:400});
});
