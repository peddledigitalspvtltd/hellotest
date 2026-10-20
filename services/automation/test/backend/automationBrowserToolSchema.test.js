const test=require('node:test');
const assert=require('node:assert/strict');
const {runAutomationBrowserAgent,connectAutomationBrowser}=require('../../backend/lib/automationBrowserAgent');
const {toolArgumentIssues}=require('@hellotest/platform/backend/src/utils/toolArgumentValidation');

const string={type:'string',maxLength:2000};
const assertionSchema={type:'object',properties:{assertion:{type:'string',enum:['visible','hidden','text_content','value','url']},locator:string,value:string},required:['assertion'],additionalProperties:false,
 oneOf:[
  {properties:{assertion:{enum:['visible','hidden']}},required:['locator'],not:{required:['value']}},
  {properties:{assertion:{enum:['text_content','value']}},required:['locator','value']},
  {properties:{assertion:{const:'url'}},required:['value'],not:{required:['locator']}}
 ]};
const receipt=value=>({content:[{type:'text',text:JSON.stringify({source:'playwright',url:'https://app.test/signup',...value})}]});
const snapshot=(input=false)=>({tool:'browser_snapshot',result:receipt({observation_id:'observed-confirmation',scope:'body',elements:[{tag:input?'input':'div',
 ...(input?{attributes:{id:'status',type:'text'}}:{role:'status',text:'Created'}),displayed:true,locators_validated:true,locator_candidates:['#status','getByRole("status")']}]})});
const tools=[{name:'browser_assert',inputSchema:assertionSchema}];
const execution={required:true,step_id:'confirmation',expected_result:'Signup confirmation is visible'};
const actor=args=>JSON.stringify({stage:'act',step_id:'confirmation',section_complete:true,tool_calls:[{name:'browser_assert',arguments:args}]});

test('discovered conditional modes reject forbidden/missing properties and enum/type errors without coercing values',()=>{
 const invalid=[
  {assertion:'visible',locator:'#status',value:'PRIVATE_EXPECTED_VALUE'},
  {assertion:'text_content',locator:'#status'},
  {assertion:'url',value:'https://app.test/signup',locator:'#status'},
  {assertion:'unknown-private-mode',locator:'#status'},
  {assertion:'value',locator:'#status',value:123},
  {assertion:'visible',locator:'#status',extra:'PRIVATE_EXTRA_VALUE'}
 ];
 for(const args of invalid){const before=JSON.stringify(args),issues=toolArgumentIssues(assertionSchema,args);assert.ok(issues.length);assert.equal(JSON.stringify(args),before);assert.doesNotMatch(JSON.stringify(issues),/PRIVATE_EXPECTED_VALUE|PRIVATE_EXTRA_VALUE|unknown-private-mode/);}
 for(const args of [{assertion:'visible',locator:'#status'},{assertion:'hidden',locator:'#status'},{assertion:'text_content',locator:'#status',value:'Created'},{assertion:'url',value:'https://app.test/signup'}])assert.deepEqual(toolArgumentIssues(assertionSchema,args),[]);
 assert.ok(toolArgumentIssues({type:'object',properties:{kind:{const:'known'}},required:['kind']},{kind:'unexpected'}).length);
 assert.ok(toolArgumentIssues({type:'object',anyOf:[{required:['locator']},{required:['value']}]},{}).length);
});

test('the actual visible+value model reply is corrected before MCP dispatch and receives only safe structural feedback',async()=>{
 const calls=[],observations=[];let turns=0;
 const browser={tools,call:async(name,args)=>{calls.push({name,args});assert.equal(args.value,undefined);return receipt({assertion_outcome:'satisfied'});}};
 const result=await runAutomationBrowserAgent({browser,prompt:'Verify the signup confirmation',execution,actorMode:true,generationMode:'sequential',parse:JSON.parse,maxTurns:2,maxCalls:1,initialObservations:[snapshot()],onObservation:value=>observations.push(value),
  complete:async prompt=>{
   if(++turns===1)return actor({assertion:'visible',locator:'getByRole("status")',value:'PRIVATE_EXPECTED_VALUE'});
   assert.match(prompt,/AUTOMATION_BROWSER_ARGUMENT_SCHEMA_INVALID/);assert.match(prompt,/"forbidden_combination":\["value"\]/);assert.match(prompt,/"selected_mode":\{"assertion":"visible"\}/);
   assert.doesNotMatch(prompt,/PRIVATE_EXPECTED_VALUE/);return actor({assertion:'visible',locator:'getByRole("status")'});
  },onPartialBuild:async()=>({generation_complete:true})});
 assert.equal(turns,2);assert.equal(calls.length,1);assert.match(result.steps[0].automation_code,/toBeVisible/);
 assert.equal(observations.some(item=>item.tool==='browser_snapshot'),false,'schema errors do not request irrelevant page reads');
 const feedback=observations.find(item=>item.tool==='automation_tool_schema_feedback');assert.equal(feedback.mcp_call,false);assert.equal(feedback.result.isError,true);
});

test('missing required text value can be corrected using the discovered mode without weakening its text assertion',async()=>{
 let turns=0;const calls=[];
 const result=await runAutomationBrowserAgent({browser:{tools,call:async(name,args)=>{calls.push({name,args});return receipt({assertion_outcome:'satisfied'});}},prompt:'Verify exact confirmation text',execution,actorMode:true,parse:JSON.parse,maxTurns:2,initialObservations:[snapshot()],
  complete:async prompt=>++turns===1?actor({assertion:'text_content',locator:'#status'}):actor({assertion:'text_content',locator:'#status',value:'Created'}),onPartialBuild:async()=>({generation_complete:true})});
 assert.equal(calls.length,1);assert.equal(calls[0].args.assertion,'text_content');assert.equal(calls[0].args.value,'Created');assert.match(result.steps[0].automation_code,/toHaveText\("Created"\)/);
});

test('flat legacy discovery remains supported and does not invent stricter assertion business rules',async()=>{
 const legacy={type:'object',properties:{assertion:string,locator:string,value:string},required:['assertion'],additionalProperties:false};
 assert.deepEqual(toolArgumentIssues(legacy,{assertion:'visible',locator:'#status',value:'legacy-server-supported'}),[]);
 const args={assertion:'value',locator:'#status',value:'linked value'},calls=[];
 await runAutomationBrowserAgent({browser:{tools:[{name:'browser_assert',inputSchema:legacy}],call:async(name,input)=>{calls.push(input);return receipt({assertion_outcome:'satisfied'});}},prompt:'Check supplied value',execution,actorMode:true,parse:JSON.parse,maxTurns:1,initialObservations:[snapshot(true)],complete:async()=>actor(args),onPartialBuild:async()=>({generation_complete:true})});
 assert.deepEqual(calls,[args]);
});

test('schema validation uses own properties, bounds complexity and never fetches external schema references',()=>{
 const inherited=Object.create({locator:'#status'});inherited.assertion='visible';
 assert.ok(toolArgumentIssues(assertionSchema,inherited).length);
 assert.deepEqual(toolArgumentIssues({$ref:'https://unexpected.example/schema'},{}),[{path:'',keyword:'unsupported_or_invalid_tool_schema'}]);
 assert.ok(toolArgumentIssues({type:'object',description:'x'.repeat(70000)},{}).length);
 const local={$schema:'https://json-schema.org/draft/2020-12/schema',$defs:{input:{type:'string'}},type:'object',properties:{locator:{$ref:'#/$defs/input'}},required:['locator']};
 assert.deepEqual(toolArgumentIssues(local,{locator:'#status'}),[]);
 assert.deepEqual(toolArgumentIssues({...local,$schema:'https://json-schema.org/draft/2019-09/schema'},{locator:'#status'}),[]);
 assert.ok(toolArgumentIssues({...local,$schema:'https://json-schema.org/draft/2019-09/schema'},{locator:123}).length);
});

test('MCP invalid-argument responses retain only discovered safe assertion-contract fields',async t=>{
 t.mock.method(globalThis,'fetch',async(_url,init)=>{
  if(init.method==='DELETE')return new Response(null,{status:204});
  const rpc=JSON.parse(init.body);
  if(rpc.method==='notifications/initialized')return new Response(null,{status:202});
  if(rpc.method==='tools/call')return Response.json({jsonrpc:'2.0',id:rpc.id,error:{code:-32602,message:'PRIVATE_SERVER_MESSAGE',data:{code:'BROWSER_TOOL_INVALID_ARGUMENTS',assertion_contract:{assertion:'visible',required_arguments:['assertion','locator','PRIVATE_FIELD'],forbidden_arguments:['value'],value:'PRIVATE_EXPECTED_VALUE',credential:'PRIVATE_CREDENTIAL'},allowed_assertions:['visible','PRIVATE_ASSERTION']}}});
  return Response.json({jsonrpc:'2.0',id:rpc.id,result:rpc.method==='initialize'?{protocolVersion:'2025-03-26',capabilities:{tools:{}}}:{tools}},{headers:rpc.method==='initialize'?{'mcp-session-id':'schema-session'}:{}});
 });
 const browser=await connectAutomationBrowser({integration:{base_url:'http://engine.test'},startUrl:'https://app.test/signup'});
 try{const result=await browser.call('browser_assert',{assertion:'visible',locator:'#status',value:'PRIVATE_EXPECTED_VALUE'});assert.equal(result.isError,true);const detail=JSON.parse(result.content[0].text);
  assert.deepEqual(detail.assertion_contract,{assertion:'visible',required_arguments:['assertion','locator'],forbidden_arguments:['value']});assert.deepEqual(detail.allowed_assertions,['visible']);assert.equal(detail.action_outcome,'not_attempted');assert.equal(detail.retry_safe,true);assert.doesNotMatch(JSON.stringify(detail),/PRIVATE_/);
 }finally{await browser.close();}
});
