const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {createRequire}=require('node:module');
const configuration=require('../services/aiConfiguration.service');
const {aiInstructionBlock}=require('../src/utils/aiInstructionBlocks');
function load(file,overrides){const local=createRequire(file),module={exports:{}};new Function('require','module','exports',fs.readFileSync(file,'utf8'))(id=>Object.hasOwn(overrides,id)?overrides[id]:local(id),module,module.exports);return module.exports;}
const runtime=(configs={},overrides={})=>load(require.resolve('../src/utils/aiFeatureRuntime'),{'../../services/aiConfiguration.service':{...configuration,resolve:async id=>{const item=configuration.catalog.find(item=>item.id===id);assert.ok(item,id);const config={...structuredClone(item.defaults),...configs[id]};return {...item,config,published_version:3,fingerprint:configuration.hash(config)};}},...overrides});
const request=(messages,extras={})=>({body:JSON.stringify({model:'provider-model',messages,...extras})});
test('all catalog defaults validate and operation aliases are unambiguous',()=>{
 const keys=new Set();for(const item of configuration.catalog){assert.deepEqual(configuration.validate(item.defaults,item.id),item.defaults);for(const key of [item.id,...item.aliases]){assert.ok(!keys.has(key),key);keys.add(key);}}
 const published=require('../../shared/aiPromptDefaults.json');for(const item of published)assert.equal(item.value,configuration.catalog.find(feature=>feature.id===item.key).defaults.prompt);
});
test('invalid sampling, recursive context, arbitrary config keys and unsafe schema fail before publish',()=>{
 const item=configuration.catalog[0],base=structuredClone(item.defaults);
 for(const patch of [{temperature:3},{max_output_tokens:0},{integration_id:[]},{context:{...base.context,required:true,mode:'none'}},{arbitrary_command:'exec'},{output_schema:{type:'object',properties:{value:{$ref:'https://outside.test/schema'}}}},{output_schema:{type:'object',properties:{value:{pattern:'(x+)+$'}}}}])assert.throws(()=>configuration.validate({...base,...patch},item.id),{statusCode:400});
 const planning=configuration.catalog.find(item=>item.id==='ai.knowledge.intent');assert.throws(()=>configuration.validate({...planning.defaults,context:{...planning.defaults.context,mode:'mcp'}},planning.id),{statusCode:400});
 const key=Object.keys(base.instruction_blocks)[0];assert.throws(()=>configuration.validate({...base,instruction_blocks:{[key]:'incomplete'}},item.id),{statusCode:400});
});
test('published controls apply at shared model boundary while preserving task data and images',async()=>{
 const id='ai.requirement.creation',controls={prompt:'Published Story instructions',temperature:0.45,top_p:0.8,max_output_tokens:2048};
 const rt=runtime({[id]:controls});
 const input=request([{role:'system',content:'Required shape: {title:string}'},{role:'user',content:[{type:'text',text:'Checkout task data'},{type:'image_url',image_url:{url:'https://fixture.test/image.png'}}]}],{max_tokens:1000});
 const result=await rt.apply(input,{operation:'requirement.generate'}),body=JSON.parse(result.init.body);
 assert.match(body.messages[0].content,/Published Story instructions/);assert.match(body.messages[0].content,/Required shape/);assert.equal(body.messages[1].content[1].image_url.url,'https://fixture.test/image.png');
 assert.equal(body.temperature,0.45);assert.equal(body.top_p,0.8);assert.equal(body.max_tokens,1000);assert.equal(result.options.traceContext.feature,id);assert.equal(result.options.traceContext.configuration_version,3);
 const negotiated=JSON.parse((await rt.apply(input,{operation:'requirement.generate',sampling:false})).init.body);assert.equal(negotiated.temperature,undefined);assert.equal(negotiated.top_p,undefined);
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
test('specialist profiles and embedding/planning stages resolve independently',()=>{
 assert.equal(configuration.featureId('automation.generate','ai.automation.locator_repair'),'ai.automation.locator_repair');
 assert.equal(configuration.featureId('knowledge.embedding','ai.knowledge.assistant'),'ai.knowledge.embedding');
 assert.equal(configuration.featureId('knowledge.context.plan-intent','ai.knowledge.assistant'),'ai.knowledge.intent');
 assert.equal(configuration.featureId('ai.agentic.story-assurance'), 'ai.agentic.story-assurance');
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
