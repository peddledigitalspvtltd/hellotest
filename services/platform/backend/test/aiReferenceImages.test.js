const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const {createRequire}=require('node:module');
const {normalizeReferenceImages,imageUserContent,applyReferenceImagePolicy,isVisionRejection}=require('../src/utils/aiReferenceImages');
const {prepareChatRequest}=require('../src/utils/llmRequestPolicy');
const {buildContextFallbackBody}=require('../src/utils/llmContextFallback');
const {validateNativeArtifactOutput,nativeArtifactContract}=require('../src/utils/aiGenerationContracts');
const configuration=require('../services/aiConfiguration.service');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const screenshot={name:'Failure.png',url:png};
const validStory={title:'Reject invalid sign in',description:'A visitor receives a credential error without opening a workspace.',acceptance_criteria:['Invalid credentials display a useful error.'],priority:2};
const validCase={title:'Invalid sign in',description:'Invalid credentials keep the visitor signed out.',priority:2,test_case_type:'functional',parameter_values:{email:'invalid@example.test'},steps:[{action:'Sign in using @t.email',expected_result:'The credential error is visible'}]};

test('reference image normalization preserves bounded compressed bytes and deduplicates exact content',()=>{
 const images=normalizeReferenceImages([screenshot,{name:'Duplicate.png',url:png}]);assert.equal(images.length,1);assert.equal(images[0].url,png);assert.equal(images[0].content_hash.length,64);
 assert.deepEqual(imageUserContent('Read the evidence',images),[{type:'text',text:'Read the evidence'},{type:'image_url',image_url:{url:png,detail:'low'}}]);
 assert.equal(imageUserContent('No screenshots',[]),'No screenshots');
 for(const input of [[{url:'https://untrusted.test/private.png'}],[{url:'data:image/svg+xml;base64,AAAA'}],Array(7).fill(screenshot)])assert.throws(()=>normalizeReferenceImages(input),{code:'INVALID_AI_REFERENCE_IMAGE'});
 assert.throws(()=>normalizeReferenceImages([screenshot],{max_total_chars:10}),{code:'INVALID_AI_REFERENCE_IMAGE'});
});
test('shared request preparation enforces explicit image capability and managed detail before provider dispatch',()=>{
 const payload={model:'private-model',messages:[{role:'user',content:imageUserContent('Evidence',[screenshot])}]};
 const high=prepareChatRequest({body:JSON.stringify(payload)},{referenceImagePolicy:{max_images:2,max_total_chars:950000,detail:'high'}});
 assert.equal(high.payload.messages[0].content[1].image_url.detail,'high');assert.equal(high.payload.messages[0].content[1].image_url.url,png);
 assert.throws(()=>applyReferenceImagePolicy(payload,{integration:{config:{supports_vision:false}}}),{code:'AI_VISION_UNSUPPORTED'});
 assert.equal(applyReferenceImagePolicy({messages:[{role:'user',content:'Text'}]},{integration:{config:{supports_vision:false}}}).messages[0].content,'Text');
});
test('size recovery cannot drop screenshots while keeping their field citations',()=>{
 const body=JSON.stringify({model:'fixture',messages:[{role:'user',content:imageUserContent('Context '.repeat(3000),[screenshot])}]});
 assert.equal(buildContextFallbackBody(body,'Smaller context'),null);
 assert.equal(isVisionRejection(400,'This model does not support image_url input'),true);
 assert.equal(isVisionRejection(429,'image tokens rate limit'),false);
 assert.equal(isVisionRejection(400,'invalid response_format'),false);
});
test('admin image policy is bounded and native artifact fields are separate from optional custom schemas',()=>{
 const feature=configuration.catalog.find(item=>item.id==='ai.requirement.creation');
 assert.deepEqual(configuration.validate(feature.defaults,feature.id).reference_images,feature.defaults.reference_images);
 for(const policy of [{...feature.defaults.reference_images,max_images:7},{...feature.defaults.reference_images,max_total_chars:950001},{...feature.defaults.reference_images,detail:'unbounded'}])assert.throws(()=>configuration.validate({...feature.defaults,reference_images:policy},feature.id),{code:'AI_CONFIGURATION_INVALID'});
 assert.ok(nativeArtifactContract(feature.id).required.includes('acceptance_criteria'));
});
test('mandatory artifact fields reject omissions, invented enum shapes, empty actions and unscoped data declarations',()=>{
 validateNativeArtifactOutput('ai.requirement.creation',{requirements:[validStory]});
 validateNativeArtifactOutput('ai.requirement.optimization',validStory);
 validateNativeArtifactOutput('ai.case_authoring.full_case',validCase);
 validateNativeArtifactOutput('ai.test_case.design',{test_cases:[validCase]});
 for(const [id,value] of [['ai.requirement.creation',{requirements:[{title:'Only a title'}]}],['ai.requirement.optimization',{...validStory,priority:'urgent'}],['ai.case_authoring.full_case',{...validCase,parameter_values:{'@r.email':'copied'}}],['ai.test_case.design',{testCases:[{...validCase,steps:[{action:'Sign in',expected_result:''}]}]}],['ai.bug.draft',{draft:{title:'Failure',message:'Observed failure',steps_to_reproduce:'',expected_result:'',actual_result:'',severity:'blocker',priority:'P0'},gaps:[]}]])assert.throws(()=>validateNativeArtifactOutput(id,value),{code:'AI_NATIVE_CONTRACT_INVALID'});
});
test('missing factual evidence remains a named gap instead of fabricated acceptance or reproduction prose',()=>{
 validateNativeArtifactOutput('ai.requirement.creation',{requirements:[{...validStory,acceptance_criteria:[],open_questions:['What observable behavior establishes acceptance?']}]});
 assert.throws(()=>validateNativeArtifactOutput('ai.requirement.creation',{requirements:[{...validStory,acceptance_criteria:[],open_questions:[]}]}),{code:'AI_NATIVE_CONTRACT_INVALID'});
 validateNativeArtifactOutput('ai.bug.draft',{draft:{title:'Save fails',message:'An error is shown',steps_to_reproduce:'',expected_result:'',actual_result:'Error is shown',severity:'medium',priority:'Medium'},gaps:[{field:'steps_to_reproduce',reason:'No actions were supplied'},{field:'expected_result',reason:'Required behavior is unspecified'}]});
});
function isolatedHttpClient(responses,feature='ai.requirement.creation'){
 const file=require.resolve('../src/utils/llmHttpClient'),local=createRequire(file),module={exports:{}},calls=[],finishes=[];
 const overrides={
  './aiFeatureRuntime':{apply:async(init,options)=>({init,options,profile:{id:feature,config:configuration.catalog.find(item=>item.id===feature).defaults}}),validateResponse:async()=>{}},
  '@hellotest/mcp/backend/gateway':{enrichChatRequest:async init=>init},
  './llmTraceCapture':{begin:async()=>({id:String(calls.length)}),finish:async(_trace,result)=>{finishes.push(result);},dispatch:()=>{}},
  './resilientHttpClient':{resilientHttpRequest:async(_url,init,options)=>{calls.push({body:JSON.parse(init.body),options});const next=responses[Math.min(calls.length-1,responses.length-1)];return next instanceof Response?next.clone():new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(next)}}]}));}}
 };
 new Function('require','module','exports',fs.readFileSync(file,'utf8'))(id=>overrides[id]||local(id),module,module.exports);
 return{calls,finishes,fetch:module.exports.fetchLlmWithRetry};
}
test('one bounded format correction keeps the original images, task and frozen field requirements',async()=>{
 const client=isolatedHttpClient([{requirements:[{title:'Only title'}]},{requirements:[validStory]}]);
 const response=await client.fetch('http://provider.invalid',{method:'POST',body:JSON.stringify({model:'small',response_format:{type:'json_object'},messages:[{role:'user',content:imageUserContent('Explicit invalid-signin intent',[screenshot])}]})},{timeoutMs:10000,contextFallback:false,maxAttempts:1});
 assert.equal(response.ok,true);assert.equal(client.calls.length,2);assert.equal(client.finishes[0].invalid,true);assert.equal(client.finishes[0].error.code,'AI_NATIVE_CONTRACT_INVALID');
 for(const call of client.calls){assert.equal(call.body.messages[0].content[1].image_url.url,png);assert.equal(call.body.messages[0].content[0].text,'Explicit invalid-signin intent');assert.ok(call.options.deadlineMs<=10000);}
 assert.match(client.calls[1].body.messages.at(-1).content,/Format correction, once/);
 assert.doesNotMatch(client.calls[1].body.messages.at(-1).content,/Only title/);
});
test('a repeated invalid artifact stops after one correction and a provider refusal is never replayed',async()=>{
 const client=isolatedHttpClient([{requirements:[{title:'Only title'}]}]);
 await assert.rejects(client.fetch('http://provider.invalid',{body:JSON.stringify({messages:[{role:'user',content:'Evidence'}]})},{timeoutMs:10000,maxAttempts:1}),{code:'AI_NATIVE_CONTRACT_INVALID'});assert.equal(client.calls.length,2);
 const provider=isolatedHttpClient([new Response(JSON.stringify({error:{message:'Images are not supported by this model'}}),{status:400})]);
 await assert.rejects(provider.fetch('http://provider.invalid',{body:JSON.stringify({messages:[{role:'user',content:imageUserContent('Evidence',[screenshot])}]})},{timeoutMs:10000,maxAttempts:1}),{code:'AI_VISION_UNSUPPORTED'});assert.equal(provider.calls.length,1);
});
test('API image input checks canonical bytes, raster type and pixel bounds before a paid model request',()=>{
 for(const url of ['data:image/png;base64,AAAA','data:image/jpeg;base64,'+png.split(',')[1],png.slice(0,-1),'data:image/png;base64,not-an-image'])assert.throws(()=>normalizeReferenceImages([{url}]),{code:'INVALID_AI_REFERENCE_IMAGE'});
 const huge=Buffer.from(png.split(',')[1],'base64');huge.writeUInt32BE(8193,16);
 assert.throws(()=>normalizeReferenceImages([{url:'data:image/png;base64,'+huge.toString('base64')}]),{code:'INVALID_AI_REFERENCE_IMAGE'});
 const tooManyPixels=Buffer.from(png.split(',')[1],'base64');tooManyPixels.writeUInt32BE(5000,16);tooManyPixels.writeUInt32BE(5000,20);
 assert.throws(()=>normalizeReferenceImages([{url:'data:image/png;base64,'+tooManyPixels.toString('base64')}]),{code:'INVALID_AI_REFERENCE_IMAGE'});
});
test('oversized artifact collections fail before any unchecked tail or silently sliced output can be accepted',()=>{
 const requirements=Array.from({length:31},(_,i)=>i===30?{title:'Invalid unchecked tail'}:validStory);
 assert.throws(()=>validateNativeArtifactOutput('ai.requirement.creation',{requirements}),error=>error.code==='AI_NATIVE_CONTRACT_INVALID'&&error.validation_errors[0].field==='max_items');
});
test('content-filter and unexpected tool responses are not misclassified as repairable missing artifact fields',async()=>{
 for(const [choice,code]of [[{finish_reason:'content_filter',message:{content:''}},'AI_PROVIDER_REFUSAL'],[{finish_reason:'stop',message:{content:'',tool_calls:[{type:'function',function:{name:'unrequested_write',arguments:'{}'}}]}},'AI_UNEXPECTED_TOOL_CALL']]){
  const client=isolatedHttpClient([new Response(JSON.stringify({choices:[choice]}))]);
  await assert.rejects(client.fetch('http://provider.invalid',{body:JSON.stringify({messages:[{role:'user',content:'Story draft'}]})},{timeoutMs:10000,maxAttempts:1}),{code});assert.equal(client.calls.length,1);
 }
});
test('duplicate raster aliases normalize before an evidence catalog can acquire conflicting identities',()=>{
 const normalized=normalizeReferenceImages([screenshot,{name:'Second alias.png',url:png.replace('image/png','image/PNG')}]);
 assert.equal(normalized.length,1);assert.equal(normalized[0].name,'Failure.png');assert.equal(normalized[0].url,png);
});
test('a bounded valid WebP raster keeps native vision support and wrong step platforms fail the artifact contract',()=>{
 const url='data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';assert.equal(normalizeReferenceImages([{url}])[0].url,url);
 assert.throws(()=>validateNativeArtifactOutput('ai.case_authoring.full_case',{...validCase,steps:[{action:'Submit request',expected_result:'Success',step_type:'guess-platform'}]}),{code:'AI_NATIVE_CONTRACT_INVALID'});
});
