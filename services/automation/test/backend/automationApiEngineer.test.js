const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const utils=require('../../../platform/backend/src/utils/testStepAutomation');
const {requiresAutomationStartUrl}=require('../../../platform/backend/src/utils/automationStartUrl');
const {executeApiRequestStep}=require('../../backend/services/apiRequestExecution.service');

function loadBuilder({response,dbWrites=[],requests=[],denied=false}={}){
 const file=path.resolve(__dirname,'../../backend/services/aiAutomationBuilder.service.js');
 const original=require('node:module').createRequire(file),exports={};
 const db={prepare:sql=>({get:async()=>({id:'app',type:'unified'}),all:async()=>[],run:async()=>{dbWrites.push(sql);}})};
 new Function('require','exports',`${fs.readFileSync(file,'utf8')}\nexports.testNormalize=normalizeLlmBuild;`)(id=>{
  if(id.endsWith('/db')||id.endsWith('/obsDb'))return db;
  if(id.endsWith('/testStepAutomation'))return utils;
  if(id.endsWith('/optionalEvidenceAccess.service'))return {getOptionalEvidenceAccess:async(_,__,keys)=>Object.fromEntries(keys.map(key=>[key,!denied]))};
  if(id.endsWith('/aiLlmSelection.service'))return {resolveLlmIntegrationForUsage:async()=>({type:"llm",is_active:true,id:'llm',api_key:'fixture-only',model:'fixture',base_url:'https://provider.fixture/v1'})};
  if(id.endsWith('/llmHttpClient'))return {fetchLlmWithRetry:async(url,init)=>{requests.push(JSON.parse(init.body));return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(typeof response==='function'?response(requests.length):response)}}]})};}};
  if(id.endsWith('/llmCapacityRetry'))return {retryLlmCapacity:async fn=>fn({timeoutMs:30000})};
  if(id.endsWith('/aiInstructionBlocks'))return {aiInstructionBlock:(feature,key)=>require('../../../platform/shared/aiFeatureCatalog.json').find(row=>row.id===feature)?.defaults.instruction_blocks[key]||''};
  if(id.endsWith('/llmResponse'))return {getCompletionContent:payload=>payload.choices[0].message.content};
  if(id.endsWith('/aiConfiguration.service'))return {resolve:async()=>({config:{}})};
  if(id.endsWith('/aiFeatureRuntime'))return {validateValue:async()=>{}};
  if(id.endsWith('/automationBrowserParameters'))return original(id);
  if(id.endsWith('/automationGeneratedProgram')||id.endsWith('/automationGenerationGrounding')||id.endsWith('/automationBuildCompletion')||id.endsWith('/automationStartUrl')||id.endsWith('/automationKnowledgeContext'))return original(id);
  if(id==='crypto')return require('node:crypto');
  return {};
 },exports);
 return exports;
}

test('build inference identifies explicit API actions and retains Web/native saved sources',()=>{
 for(const action of ['GET /orders','I GET /orders','Send a POST request to @r.base_url/orders','When send an HTTP GET request to https://api.fixture/orders','Call the API endpoint to create an order'])assert.equal(utils.inferAutomationStepType({action,step_type:'web'}),'api',action);
 for(const action of ['Click the API docs link','Open https://api.fixture/orders','Verify API documentation is visible'])assert.equal(utils.inferAutomationStepType({action,step_type:'web'}),'web',action);
 assert.equal(utils.inferAutomationStepType({action:'POST /orders',step_type:'web',automation_code:'await page.click("#post");'}),'web');
 assert.equal(utils.inferAutomationStepType({action:'POST /orders',step_type:'ios'}),'ios');
 assert.equal(utils.inferAutomationStepType({action:'Create an order',step_type:'web'},{appTypeKind:'api'}),'api');
 assert.equal(requiresAutomationStartUrl({steps:[{action:'POST /orders'}]}),false);
 assert.equal(requiresAutomationStartUrl({steps:[{action:'POST /orders'},{action:'Click Checkout'}]}),true);
});

test('API requests retain authentication, query, cookies, redirects, schema and operators through normalization',()=>{
 const request={method:'POST',url:'@r.base_url/orders',query_params:[{key:'region',value:'@t.region'}],cookies:[{key:'session',value:'@r.session'}],auth:{type:'bearer',credential_reference:'@r.api_token'},follow_redirects:false,body_mode:'json',body:'{"name":"@t.name"}',validations:[{kind:'status',expected:'201'},{kind:'json_schema',expected:'{"type":"object","required":["id"],"properties":{"id":{"type":"integer"}}}'},{kind:'json_path',target:'$.id',operator:'gt',expected:'0'}],captures:[{path:'$.id',parameter:'@r.order_id'}]};
 const normalized=utils.validateGeneratedApiRequest(request,{expectedResult:'Order created'});
 for(const key of ['query_params','cookies','auth','follow_redirects','captures'])assert.deepEqual(normalized[key],request[key]);
 assert.equal(normalized.validations[1].expected,request.validations[1].expected);assert.equal(normalized.validations[2].operator,'gt');
 assert.throws(()=>utils.validateGeneratedApiRequest({...request,auth:{type:'bearer'}}),/credential_reference/);
 assert.throws(()=>utils.validateGeneratedApiRequest({...request,validations:[]},{expectedResult:'Order created'}),/explicit response assertions/);
 assert.throws(()=>utils.validateGeneratedApiRequest({...request,validations:[{kind:'json_schema',expected:'{}'}]}),/nonempty JSON Schema/);
 assert.throws(()=>utils.validateGeneratedApiRequest({...request,query:{region:'east'}}),/discarded/);
});

test('the native builder accepts mixed inferred API and Web mappings without changing the authored actions',()=>{
 const {testNormalize}=loadBuilder();
 const steps=[{id:'create',step_order:1,step_type:'web',action:'Send a POST request to https://api.fixture/orders',expected_result:'201 order is created'},{id:'page',step_order:2,step_type:'web',action:'Click the order',expected_result:'Order details shown'}];
 const built=testNormalize({steps:[{step_id:'create',step_type:'api',api_request:{method:'POST',url:'https://api.fixture/orders',validations:[{kind:'status',expected:'201'}]}},{step_id:'page',step_type:'web',automation_code:'await page.locator("#order").click(); await expect(page.locator("#details")).toBeVisible();'}]},steps,[],null);
 assert.deepEqual(built.updates.map(row=>row.step_type),['api','web']);assert.equal(built.updates[0].automation_code,null);assert.equal(built.updates[1].api_request,null);assert.equal(steps[0].step_type,'web');assert.equal(built.updates[0].step.action,steps[0].action);
 assert.throws(()=>testNormalize({steps:[{step_id:'create',step_type:'api',api_request:{method:'POST',url:'https://invented.fixture/orders',validations:[{kind:'status',expected:'201'}]}}]},[steps[0]],[],null,{apiOrigins:new Set(['https://api.fixture'])}),{code:'AUTOMATION_UNGROUNDED_API_TARGET'});
});

test('workflow previews return validated native API drafts without writes or target requests',async()=>{
 const writes=[],requests=[];
 const builder=loadBuilder({dbWrites:writes,requests,response:{summary:'Create an order',steps:[{step_id:'draft-step-1',step_type:'api',api_request:{method:'POST',url:'https://api.fixture/orders',auth:{type:'bearer',credential_reference:'@r.api_token'},validations:[{kind:'status',expected:'201'}],captures:[{path:'$.id',parameter:'@r.order_id'}]}}]}});
 const result=await builder.previewAutomationDraft({draft:{title:'Create order',parameter_values:{'t.api_token':'never-send-draft-token'},steps:[{action:'POST https://api.fixture/orders',expected_result:'201 Created'}]},additional_context:'Use @t.api_token; private literal never-send-draft-token',project_id:'project',app_type_id:'app',user_id:'actor'});
 assert.equal(result.steps[0].step_type,'api');assert.equal(result.validation.status,'passed');assert.equal(result.verification_status,'unverified');assert.equal(result.draft.automation_status,'incomplete');assert.deepEqual(result.side_effects,{cases_saved:0,target_requests:0,browser_actions:0});assert.deepEqual(writes,[]);assert.equal(requests.length,1);assert.match(JSON.stringify(requests[0]),/native api_request/);assert.doesNotMatch(JSON.stringify(requests[0]),/never-send-draft-token/);assert.match(JSON.stringify(requests[0]),/@t.api_token/);
 await assert.rejects(loadBuilder({denied:true}).previewAutomationDraft({draft:{steps:[{action:'POST /orders'}]},project_id:'project',app_type_id:'app',user_id:'actor'}),{statusCode:403});
});

test('API Gherkin fixtures require their real setup contract instead of a browser URL or fabricated request',async()=>{
 const requests=[];
 const builder=loadBuilder({requests,response:{blocked_steps:[{step_id:'draft-step-1',dependency_type:'external_context',reason:'The existing invoice needs a supplied setup request or seeded fixture reference.',required_context:['Authorized invoice fixture or setup API contract'],required_parameters:[]}]}});
 await assert.rejects(builder.previewAutomationDraft({draft:{title:'Read invoice',gherkin_document:'Feature: Invoice\nScenario: Read\nGiven an existing invoice\nWhen I GET /invoices/one\nThen status equals 200',steps:[{action:'an existing invoice',step_type:'manual',gherkin_keyword:'Given',gherkin_role:'scenario'},{action:'I GET /invoices/one',step_type:'manual',expected_result:'status equals 200',gherkin_keyword:'When',gherkin_role:'scenario'}]},project_id:'project',app_type_id:'app',user_id:'actor'}),error=>error.code==='AUTOMATION_DEPENDENCY_MISSING'&&/setup request|seeded fixture/.test(error.message));
 assert.equal(requests.length,1);assert.match(requests[0].messages[0].content,/"type": "api"/);
});

test('real API execution sends authenticated JSON requests and validates schema, headers and chained captures',async t=>{
 const received=[];
 const server=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;received.push({url:req.url,method:req.method,headers:req.headers,body});res.setHeader('content-type','application/json');res.setHeader('x-contract','orders-v1');res.statusCode=req.method==='POST'?201:200;res.end(JSON.stringify({id:41,state:'created',token:'captured-fixture-token'}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`;
 const first=await executeApiRequestStep({parameter_values:{'r.base_url':base,'r.api_token':'fixture-credential','t.name':'Alice'},api_request:{method:'POST',url:'/orders',query_params:[{key:'tenant',value:'east'},{key:'tenant',value:'west'}],cookies:[{key:'session',value:'fixture-session'}],auth:{type:'bearer',credential_reference:'@r.api_token'},body_mode:'json',body:'{"name":"@t.name"}',validations:[{kind:'status',expected:'201'},{kind:'header_present',target:'x-contract'},{kind:'body_not_contains',expected:'failure'},{kind:'json_path',target:'$.id',operator:'gt',expected:'0'},{kind:'json_schema',expected:'{"type":"object","required":["id","state"],"properties":{"id":{"type":"integer"},"state":{"const":"created"}}}'},{kind:'response_time',expected:'5000'}],captures:[{path:'$.token',parameter:'@r.order_token'}]}});
 assert.equal(first.status,'passed');assert.equal(received[0].headers.authorization,'Bearer fixture-credential');assert.equal(received[0].headers.cookie,'session=fixture-session');assert.equal(received[0].body,'{"name":"Alice"}');assert.match(received[0].url,/tenant=east&tenant=west/);assert.equal(first.detail.request.headers.authorization,'[credential reference]');assert.equal(first.captures['@r.order_token'],'captured-fixture-token');
 const second=await executeApiRequestStep({parameter_values:{'r.base_url':base,...first.captures},api_request:{method:'GET',url:'/orders/41',auth:{type:'api_key',credential_reference:'@r.order_token',location:'query',key_name:'access_token'},validations:[{kind:'json_path',target:'$.state',expected:'created'}]}});
 assert.equal(second.status,'passed');assert.match(received[1].url,/access_token=captured-fixture-token/);assert.doesNotMatch(second.detail.request.url,/captured-fixture-token/);
 const failed=await executeApiRequestStep({api_request:{method:'GET',url:`${base}/orders/41`,validations:[{kind:'json_schema',expected:'{"type":"object","required":["id"],"properties":{"id":{"type":"string"}}}'}]}});
 assert.equal(failed.status,'failed');assert.match(failed.note,/JSON Schema/);
 await assert.rejects(executeApiRequestStep({api_request:{method:'GET',url:`${base}/orders`,auth:{type:'bearer',credential_reference:'@r.missing'}}}),/credential_reference/);assert.equal(received.length,3,'missing auth fails before network dispatch');
 const missing=await executeApiRequestStep({api_request:{method:'GET',url:`${base}/orders`,captures:[{path:'$.missing',parameter:'@r.next_id'}]}});
 assert.equal(missing.status,'failed');assert.match(missing.note,/Required response capture/);
});
