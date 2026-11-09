const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createRequire}=require('node:module');
const policy=require('../src/utils/llmRequestPolicy');
// Original tools/list response from the pinned @playwright/mcp 0.0.84 runtime.
// Keep the upstream schemas intact, including their declared 2020-12 dialect.
const catalog=require('./fixtures/upstreamPlaywrightMcpTools.v0.0.84.json');
const {toolsForPolicy}=require('../../../automation/backend/lib/automationUpstreamEngineer');
const functionTools=tools=>tools.map(tool=>({type:'function',function:{name:tool.name,description:tool.description,parameters:tool.inputSchema}}));
const payload=tools=>({model:'gpt-5',messages:[{role:'user',content:'Use the native tools for the current observed form. Return final outcomes as JSON.'}],tools:functionTools(tools),tool_choice:'auto'});
const init=body=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const response=(name,args)=>Response.json({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:'native-call',type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]});
const completion=value=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]});

function httpClient(){
 const file=require.resolve('../src/utils/llmHttpClient'),local=createRequire(file),module={exports:{}};
 const mocks={
  './aiFeatureRuntime':{apply:async(init,options)=>({init,options}),validateResponse:async()=>{}},
  './llmTraceCapture':{begin:async()=>null,finish:async()=>{},dispatch:()=>{}},
  '@hellotest/mcp/backend/gateway':{enrichChatRequest:async init=>init},
  '../../services/aiAttachmentAccess.service':{prepareImages:async init=>init}
 };
 new Function('require','module','exports',fs.readFileSync(file,'utf8'))(id=>Object.hasOwn(mocks,id)?mocks[id]:local(id),module,module.exports);
 return module.exports;
}

test('the full discovered upstream catalog passes real provider preparation without removing or rewriting its draft-2020 schemas',()=>{
 assert.equal(catalog.length,34);
 assert.ok(catalog.every(tool=>tool.inputSchema.$schema==='https://json-schema.org/draft/2020-12/schema'));
 const original=JSON.stringify(catalog),body=payload(catalog);
 for(let attempt=0;attempt<2;attempt++){
  const prepared=policy.prepareChatRequest(init(body),{providerUrl:'https://api.openai.com/v1/chat/completions'});
  assert.deepEqual(prepared.payload.tools,body.tools);assert.equal(prepared.payload.tool_choice,'auto');assert.equal(prepared.payload.response_format,undefined);
 }
 assert.equal(JSON.stringify(catalog),original);
});

test('native draft-2020 tool responses retain required-field, value-type and additional-field admission',async()=>{
 const prepared=policy.prepareChatRequest(init(payload(toolsForPolicy(catalog,true)))).payload;
 await policy.validateChatResponse(response('browser_type',{target:'e16',text:'Exact native text',submit:false}),prepared);
 await policy.validateChatResponse(response('browser_verify_value',{type:'textbox',element:'Password',target:'e22',value:'@t.password'}),prepared);
 for(const args of [{text:'missing native target'},{target:16,text:'wrong type'},{target:'e16',text:'value',ref:'invented alias'}])await assert.rejects(policy.validateChatResponse(response('browser_type',args),prepared),{code:'AI_INVALID_TOOL_ARGUMENTS'});
 await assert.rejects(policy.validateChatResponse(response('browser_evaluate',{}),prepared),{code:'AI_UNEXPECTED_TOOL_CALL'});
});

test('declared 2019 and 2020 output dialects enforce their actual keywords while draft-7 output admission stays intact',async()=>{
 const schemas=[
  {$schema:'https://json-schema.org/draft/2019-09/schema',type:'object',allOf:[{properties:{status:{const:'ready'}}}],required:['status'],unevaluatedProperties:false},
  {$schema:'https://json-schema.org/draft/2020-12/schema',type:'object',properties:{items:{type:'array',prefixItems:[{type:'string'},{type:'number'}],items:false,minItems:2}},required:['items'],additionalProperties:false},
  {$schema:'http://json-schema.org/draft-07/schema#',type:'object',properties:{status:{enum:['ready']}},required:['status'],additionalProperties:false}
 ];
 const valid=[{status:'ready'},{items:['native',2]},{status:'ready'}];
 const invalid=[{status:'ready',extra:true},{items:[2,'native']},{status:'unexpected'}];
 for(let index=0;index<schemas.length;index++){
  const schema=schemas[index],body={model:'gpt-5',messages:[{role:'user',content:'Return the declared JSON output.'}],response_format:{type:'json_object'}};
  const prepared=policy.prepareChatRequest(init(body),{outputSchema:schema,providerUrl:'https://compatible.example/v1/chat/completions'}).payload;
  await policy.validateChatResponse(completion(valid[index]),prepared,{outputSchema:schema});
  await assert.rejects(policy.validateChatResponse(completion(invalid[index]),prepared,{outputSchema:schema}),{code:'AI_OUTPUT_SCHEMA_VIOLATION'});
 }
});

test('invalid schemas remain predispatch failures and changed schemas sharing an ID cannot reuse stale validators',async()=>{
 for(const schema of [
  {$schema:'https://json-schema.org/draft/2020-12/schema',type:'not-a-json-type'},
  {$schema:'https://json-schema.org/draft/2019-09/schema',type:'object',required:'status'},
  {$schema:'https://json-schema.org/draft/2020-12/schema',type:'array',items:[{type:'string'}]}
 ])assert.throws(()=>policy.prepareChatRequest(init(payload([{name:'native',inputSchema:schema}]))),error=>error.code==='AI_OUTPUT_SCHEMA_INVALID'&&error.statusCode===422);
 for(const [revision,value]of [['https://json-schema.org/draft/2020-12/schema','first'],['https://json-schema.org/draft/2020-12/schema','second'],['https://json-schema.org/draft/2019-09/schema','third']]){
  const schema={$id:'urn:hellotest:test:mutable-native-schema',$schema:revision,type:'object',properties:{value:{const:value}},required:['value'],additionalProperties:false};
  const prepared=policy.prepareChatRequest(init(payload([{name:'native',inputSchema:schema}]))).payload;
  await policy.validateChatResponse(response('native',{value}),prepared);
  await assert.rejects(policy.validateChatResponse(response('native',{value:'stale'}),prepared),{code:'AI_INVALID_TOOL_ARGUMENTS'});
 }
});

test('the actual provider HTTP pipeline prepares the native catalog and admits one tool completion without a duplicate request',async t=>{
 const client=httpClient(),bodies=[];
 t.mock.method(globalThis,'fetch',async(_url,request)=>{bodies.push(JSON.parse(request.body));return response('browser_type',{target:'e16',text:'Native text'});});
 const body=payload(toolsForPolicy(catalog,true));
 const result=await client.fetchLlmWithRetry('https://provider.example/v1/chat/completions',init(body),{operation:'automation.generate',maxAttempts:1});
 assert.equal(result.status,200);assert.equal(bodies.length,1);assert.deepEqual(bodies[0].tools,body.tools);
 assert.equal((await result.json()).choices[0].message.tool_calls[0].function.name,'browser_type');
});

test('the provider pipeline rejects an invalid native response once and an invalid schema before dispatch',async t=>{
 const client=httpClient();let dispatches=0;
 t.mock.method(globalThis,'fetch',async()=>{dispatches++;return response('browser_type',{ref:'legacy-ref',text:'missing target'});});
 await assert.rejects(client.fetchLlmWithRetry('https://provider.example/v1/chat/completions',init(payload(toolsForPolicy(catalog,true))),{operation:'automation.generate',maxAttempts:1}),error=>error.code==='AI_INVALID_TOOL_ARGUMENTS'&&error.nonRetryable===true);
 assert.equal(dispatches,1);
 await assert.rejects(client.fetchLlmWithRetry('https://provider.example/v1/chat/completions',init(payload([{name:'native',inputSchema:{$schema:'https://json-schema.org/draft/2020-12/schema',type:'invalid'}}])),{operation:'automation.generate',maxAttempts:1}),{code:'AI_OUTPUT_SCHEMA_INVALID'});
 assert.equal(dispatches,1,'schema compilation failure cannot issue a provider request');
});
