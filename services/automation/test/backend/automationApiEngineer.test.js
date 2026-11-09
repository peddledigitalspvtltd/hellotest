const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const utils=require('../../../platform/backend/src/utils/testStepAutomation');
const {requiresAutomationStartUrl}=require('../../../platform/backend/src/utils/automationStartUrl');
const {executeApiRequestStep}=require('../../backend/services/apiRequestExecution.service');
// Pinned @playwright/mcp 0.0.84 read-only snapshot contract. Inspected previews
// advertise real native functions even when the model needs no additional read.
const nativeReadOnlyTools=[{name:'browser_snapshot',description:'Capture accessibility snapshot of the current page, this is better than screenshot',annotations:{readOnlyHint:true},inputSchema:{type:'object',properties:{target:{type:'string'},filename:{type:'string'},depth:{type:'number'},boxes:{type:'boolean'}},additionalProperties:false}}];

function loadBuilder({response,providerMessage,dbWrites=[],requests=[],denied=false,browserFixture,upstreamFixture,integrationFixture,mappingResponse=instructionMappingResponse}={}){
 const file=path.resolve(__dirname,'../../backend/services/aiAutomationBuilder.service.js');
 const original=require('node:module').createRequire(file),exports={};
 const db={prepare:sql=>({get:async()=>({id:'app',type:'unified'}),all:async()=>[],run:async()=>{dbWrites.push(sql);}})};
 new Function('require','exports',`${fs.readFileSync(file,'utf8')}\nexports.testNormalize=normalizeLlmBuild;exports.testBuildBrowserIntegration=resolveBuildBrowserIntegration;`)(id=>{
  if(id.endsWith('/db')||id.endsWith('/obsDb'))return db;
  if(id.endsWith('/testStepAutomation'))return utils;
  if(id.endsWith('/automationActorModelPolicy'))return original(id);
  if(id.endsWith('/automationCaseType')||id.endsWith('/automationRuntimeSpecialist')||id.endsWith('/automationApiParameterContract')||id.endsWith('/automationExpectedResultTemplate')||id.endsWith('/automationJsonOutputRetry'))return original(id);
  if(id.endsWith('/optionalEvidenceAccess.service'))return {getOptionalEvidenceAccess:async(_,__,keys)=>Object.fromEntries(keys.map(key=>[key,!denied]))};
  if(id.endsWith('/aiLlmSelection.service'))return {resolveLlmIntegrationForUsage:async()=>({type:"llm",is_active:true,id:'llm',api_key:'fixture-only',model:'fixture',base_url:'https://provider.fixture/v1'})};
  if(id.endsWith('/llmHttpClient'))return {fetchLlmWithRetry:async(url,init)=>{requests.push(JSON.parse(init.body));const request=requests.at(-1),mapping=mappingResponse(request),output=mapping===undefined?(typeof response==='function'?response(requests.length,request):response):mapping;return {ok:true,json:async()=>({choices:[{message:providerMessage?.(request,output)||{content:JSON.stringify(output)}}]})};}};
  if(id.endsWith('/llmCapacityRetry'))return {retryLlmCapacity:async fn=>fn({timeoutMs:30000})};
  if(id.endsWith('/aiInstructionBlocks'))return {aiInstructionBlock:(feature,key)=>require('../../../platform/shared/aiFeatureCatalog.json').find(row=>row.id===feature)?.defaults.instruction_blocks[key]||''};
  if(id.endsWith('/llmResponse'))return {getCompletionContent:payload=>payload.choices[0].message.content};
  if(id.endsWith('/aiConfiguration.service'))return {resolve:async()=>({config:{}})};
  if(id.endsWith('/aiFeatureRuntime'))return {validateValue:async()=>{}};
  if(id.endsWith('/automationBrowserParameters'))return original(id);
  if(id.endsWith('/automationBrowserAgent')&&browserFixture)return browserFixture;
  if(id.endsWith('/automationUpstreamMcpClient')&&upstreamFixture)return upstreamFixture;
  if(id.endsWith('/automationUpstreamEngineer')||id.endsWith('/automationUpstreamSectionSource')||id.endsWith('/automationBuildPipelineOptions')||id.endsWith('/automationReadiness.service'))return original(id);
  if(id.endsWith('/integration.service'))return {getActiveIntegrationByTypeForProject:async()=>integrationFixture===undefined?{base_url:'http://engine.fixture',config:{}}:integrationFixture};
  if(id.endsWith('/automationAssertionTimeout'))return original(id);
  if(id.endsWith('/automationGeneratedProgram')||id.endsWith('/automationGenerationGrounding')||id.endsWith('/automationBuildCompletion')||id.endsWith('/automationStartUrl')||id.endsWith('/automationKnowledgeContext')||id.endsWith('/automationPortableArtifact'))return original(id);
  if(id==='crypto')return require('node:crypto');
  return {};
 },exports);
 return exports;
}

function instructionMappingResponse(request){
 const content=request.messages.filter(message=>message.role==='user').at(-1).content;
 const start=content.indexOf('{"task":"Map the authoritative');
 if(start<0)return;
 const payload=JSON.parse(content.slice(start));
 return {schema:'hellotest.playwrightInstructionMapping.v1',steps:payload.steps.map(step=>({step_id:step.step_id,source_sha256:step.source_sha256,instructions:step.operations.map(op=>({operation_id:op.operation_id,kind:op.kind,depth:op.depth,label:op.kind==='assertion'?'Verify':'Open URL',args:[]}))}))};
}

function readOnlyUpstreamResponse(request,{source,apiRequest}={}){
 const mapping=instructionMappingResponse(request);
 if(mapping)return mapping;
 const content=request.messages.filter(message=>message.role==='user').at(-1).content;
 const payload=JSON.parse(content.startsWith('{')?content:content.slice(content.indexOf('{"task":')));
 if(payload.task?.startsWith('Generate only this authored API'))return {summary:'Generated the documented API contract',steps:[{step_id:payload.current_section.id,step_type:'api',api_request:apiRequest}]};
 if(payload.task?.startsWith('Save this section'))return {automation_code:source};
 return {done:true};
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

test('paired builds inherit only the selected public assertion policy and remain available without a remote integration',async()=>{
 const scope={bridgeId:'bridge',projectId:'project',caseId:'case',userId:'actor'},selected={base_url:'https://engine.fixture',config:{assertion_timeout_ms:'45000',navigation_timeout_ms:'45000',shared_secret:'PRIVATE_UNUSED_FIXTURE'}};
 const paired=await loadBuilder({integrationFixture:selected}).testBuildBrowserIntegration({project_id:'project'},scope);
 assert.equal(paired.paired_browser_bridge,scope);assert.deepEqual(paired.config,{assertion_timeout_ms:45000,navigation_timeout_ms:45000});assert.equal(paired.base_url,undefined);assert.doesNotMatch(JSON.stringify(paired),/PRIVATE_UNUSED_FIXTURE/);
 const absent=await loadBuilder({integrationFixture:null}).testBuildBrowserIntegration({project_id:'project'},scope);assert.deepEqual(absent.config,{});assert.equal(absent.paired_browser_bridge,scope);
 assert.equal(await loadBuilder({integrationFixture:selected}).testBuildBrowserIntegration({project_id:'project'},null),selected);
});

test('API requests retain authentication, query, cookies, redirects, schema and operators through normalization',()=>{
 const request={method:'POST',url:'@r.base_url/orders',query_params:[{key:'region',value:'@t.region'}],cookies:[{key:'session',value:'@r.session'}],auth:{type:'bearer',credential_reference:'@r.api_token'},follow_redirects:false,body_mode:'json',body:'{"name":"@t.name"}',validations:[{kind:'status',expected:'201'},{kind:'json_schema',expected:'{"type":"object","required":["id"],"properties":{"id":{"type":"integer"}}}'},{kind:'json_path',target:'$.id',operator:'gt',expected:'0'}],captures:[{path:'$.id',parameter:'@r.order_id'}]};
 const normalized=utils.validateGeneratedApiRequest(request,{expectedResult:'Order created'});
 for(const key of ['query_params','cookies','auth','follow_redirects','captures'])assert.deepEqual(normalized[key],request[key]);
 assert.equal(normalized.validations[1].expected,request.validations[1].expected);assert.equal(normalized.validations[2].operator,'gt');
 assert.throws(()=>utils.validateGeneratedApiRequest({...request,auth:{type:'bearer'}}),/credential_reference/);
 assert.throws(()=>utils.validateGeneratedApiRequest({...request,validations:[]},{expectedResult:'Order created'}),/explicit response assertions/);
 assert.throws(()=>utils.validateGeneratedApiRequest({...request,validations:[]},{expectedResult:'Order created',existingRequest:{method:'POST',url:request.url}}),/explicit response assertions/,'An existing request URL cannot bypass response assertions.');
 assert.throws(()=>utils.validateGeneratedApiRequest({...request,validations:[{kind:'json_schema',expected:'{}'}]}),/nonempty JSON Schema/);
 assert.throws(()=>utils.validateGeneratedApiRequest({...request,query:{region:'east'}}),/discarded/);
});

test('an explicitly API-only case in a Unified application dispatches only the API Engineer without opening a browser',async()=>{
 const requests=[],browserCalls=[];
 const builder=loadBuilder({requests,browserFixture:{connectAutomationBrowser:async()=>{browserCalls.push(true);throw Error('An API-only build must never inspect a browser.');}},response:{summary:'Read saved API health contract',steps:[{step_id:'draft-step-1',step_type:'api',api_request:{method:'GET',url:'https://api.fixture/health',validations:[{kind:'status',expected:'200'},{kind:'json_path',target:'$.ok',expected:'true'}]}}]}});
 const result=await builder.previewAutomationDraft({draft:{title:'API readiness',automation_case_type:'api',steps:[{step_type:'api',action:'GET https://api.fixture/health',expected_result:'HTTP 200 and JSON ok true'}]},project_id:'project',app_type_id:'app',user_id:'actor',inspect_browser:true});
 assert.deepEqual(browserCalls,[]);assert.equal(requests.length,1);
 assert.equal(result.draft.automation_case_type,'api');assert.equal(result.draft.test_data_options.automation_case_type,'api');assert.equal(result.automation_start_url,null);
 assert.match(JSON.stringify(requests[0]),/API Automation Engineer/);assert.doesNotMatch(JSON.stringify(requests[0]),/Web Automation Engineer/);
 assert.match(result.executable.code,/api\.request/);assert.equal(result.verification_status,'unverified');
});

test('incompatible browser work in an API-only case fails before provider, browser or draft writes',async()=>{
 const requests=[],writes=[],browserCalls=[];
 const builder=loadBuilder({requests,dbWrites:writes,browserFixture:{connectAutomationBrowser:async()=>{browserCalls.push(true);}}});
 await assert.rejects(builder.previewAutomationDraft({draft:{title:'Wrong runtime',automation_case_type:'api',steps:[{step_type:'web',action:'Click Save',expected_result:'Saved'}]},project_id:'project',app_type_id:'app',user_id:'actor',inspect_browser:true}),{code:'AUTOMATION_CASE_TYPE_MISMATCH'});
 assert.deepEqual(requests,[]);assert.deepEqual(writes,[]);assert.deepEqual(browserCalls,[]);
});

test('the native saved-case builder cannot accept action-only Web code for a stated expected outcome',()=>{
 const {testNormalize}=loadBuilder();
 const steps=[{id:'save',step_order:1,step_type:'web',action:'Click Save',expected_result:'A Saved confirmation is visible'}];
 assert.throws(()=>testNormalize({steps:[{step_id:'save',step_type:'web',automation_code:'await page.getByRole("button",{name:"Save"}).click();'}]},steps,[],null),{code:'AUTOMATION_EXPECTED_RESULT_ASSERTION_REQUIRED'});
 assert.equal(testNormalize({steps:[{step_id:'save',step_type:'web',automation_code:'await page.getByRole("button",{name:"Save"}).click(); await expect(page.getByText("Saved")).toBeVisible();'}]},steps,[],null).updates.length,1);
});

test('API generation repairs a build-time assertion literal before accepting mutable current test data',async()=>{
 const requests=[];
 const builder=loadBuilder({requests,response:attempt=>({summary:'Create the supplied item',steps:[{step_id:'draft-step-1',step_type:'api',api_request:{method:'POST',url:'@t.base_url/items',body_mode:'json',body:'{"name":"@t.item_name"}',validations:[{kind:'status',expected:'201'},{kind:'json_path',target:'$.name',expected:attempt===1?'Build Fixture current value':'@t.item_name'}]}}]})});
 const result=await builder.previewAutomationDraft({draft:{title:'Create item',automation_case_type:'api',parameter_values:{base_url:'https://api.fixture',item_name:'Build Fixture current value'},steps:[{step_type:'api',action:'POST @t.base_url/items with name @t.item_name',expected_result:'HTTP 201; JSON name equals @t.item_name',api_request:{method:'POST',url:'@t.base_url/items',body_mode:'json',body:'{"name":"@t.item_name"}'}}]},project_id:'project',app_type_id:'app',user_id:'actor'});
 assert.equal(requests.length,2,'A literal matching the current value cannot become a saved mutable assertion.');
 assert.match(JSON.stringify(requests[1]),/@t.item_name in expected-result assertions/);
 const first=requests[0].messages[0].content;
 assert.match(first,/"parameter_bindings"/);assert.match(first,/"expected_result":\s*\[\s*"@t.item_name"/);
 assert.equal(result.steps[0].api_request.validations[1].expected,'@t.item_name');
 assert.equal(result.steps[0].api_request.body,'{"name":"@t.item_name"}');
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

test('native API completion corrects conditional auth and validation fields while preserving the complete evidenced response contract',async()=>{
 const requests=[];
 const builder=loadBuilder({requests,response:attempt=>({summary:'Read API readiness',steps:[{step_id:'draft-step-1',step_type:'api',api_request:{method:'GET',url:'https://api.fixture/health/ready',auth:attempt===1?{type:'none',location:null}:{type:'none'},validations:[{kind:'status',expected:'200',...(attempt<3?{operator:'eq'}:{})},{kind:'json_path',target:'$.ok',expected:'true',operator:'eq'},{kind:'json_path',target:'$.probe',expected:'"readiness"',operator:'eq'}]}}]})});
 const result=await builder.previewAutomationDraft({draft:{title:'API readiness',steps:[{action:'GET https://api.fixture/health/ready with no authentication or body',expected_result:'HTTP 200 and JSON ok=true, probe="readiness"'}]},project_id:'project',app_type_id:'app',user_id:'actor'});
 assert.equal(requests.length,3);assert.match(JSON.stringify(requests[1]),/API key location must be header or query/);
 assert.match(JSON.stringify(requests[2]),/Use operators on JSON-path assertions/);
 assert.deepEqual(result.steps[0].api_request.auth,{type:'none'});assert.equal(result.steps[0].api_request.validations.length,3);
 const instructions=JSON.stringify(requests[0]);assert.match(instructions,/for auth.type none emit only/);assert.match(instructions,/Omit operator on status/);
});

test('API Gherkin fixtures require their real setup contract instead of a browser URL or fabricated request',async()=>{
 const requests=[];
 const builder=loadBuilder({requests,response:{blocked_steps:[{step_id:'draft-step-1',dependency_type:'external_context',reason:'The existing invoice needs a supplied setup request or seeded fixture reference.',required_context:['Authorized invoice fixture or setup API contract'],required_parameters:[]}]}});
 await assert.rejects(builder.previewAutomationDraft({draft:{title:'Read invoice',gherkin_document:'Feature: Invoice\nScenario: Read\nGiven an existing invoice\nWhen I GET /invoices/one\nThen status equals 200',steps:[{action:'an existing invoice',step_type:'manual',gherkin_keyword:'Given',gherkin_role:'scenario'},{action:'I GET /invoices/one',step_type:'manual',expected_result:'status equals 200',gherkin_keyword:'When',gherkin_role:'scenario'}]},project_id:'project',app_type_id:'app',user_id:'actor'}),error=>error.code==='AUTOMATION_DEPENDENCY_MISSING'&&/setup request|seeded fixture/.test(error.message));
 assert.equal(requests.length,1);assert.match(requests[0].messages[0].content,/"type": "api"/);
});

test('offline workflow authors the whole case once, maps Web source separately and emits the shared executable artifact',async()=>{
 const requests=[],writes=[];
 const builder=loadBuilder({requests,dbWrites:writes,
  browserFixture:{connectAutomationBrowser:async()=>assert.fail('Offline previews cannot connect the custom browser controller.')},
  upstreamFixture:{connectUpstreamPlaywright:async()=>assert.fail('Offline previews cannot connect Playwright MCP.')},
  response:{summary:'Read then inspect the invoice',steps:[
  {step_id:'draft-step-1',step_type:'api',api_request:{method:'GET',url:'https://api.fixture/invoices/one',validations:[{kind:'status',expected:'200'}]}},
  {step_id:'draft-step-2',step_type:'web',automation_code:'await expect(page.getByRole("heading", {name:"Invoice one"})).toBeVisible();'}
 ]}});
 const result=await builder.previewAutomationDraft({draft:{title:'Invoice journey',automation_start_url:'https://api.fixture/invoices/one',parameter_values:{'t.api_token':'private-not-exported'},steps:[
  {action:'GET https://api.fixture/invoices/one',expected_result:'Status equals 200'},
  {action:'Inspect the invoice heading',expected_result:'Invoice one is visible'}
 ]},project_id:'project',app_type_id:'app',user_id:'actor',inspect_browser:false});
 assert.equal(requests.length,2,'Whole-case source authoring is followed by one display-only Web mapping.');
 assert.deepEqual(requests.map(request=>request.model),['fixture','fixture'],'Both stages use the configured model.');
 assert.match(requests[0].messages[0].content,/draft-step-1[\s\S]*draft-step-2/);
 const mappingInput=JSON.parse(requests[1].messages.at(-1).content.slice(requests[1].messages.at(-1).content.indexOf('{"task":')));
 assert.deepEqual(mappingInput.steps.map(step=>step.step_id),['draft-step-2'],'API requests do not enter Playwright display mapping.');
 assert.equal(mappingInput.steps[0].automation_code,result.steps[1].automation_code);
 assert.equal(result.steps[1].automation_code,'await expect(page.getByRole("heading", {name:"Invoice one"})).toBeVisible();');
 assert.equal(result.steps[1].automation_instructions.source_sha256,require('node:crypto').createHash('sha256').update(result.steps[1].automation_code).digest('hex'));
 assert.equal(result.steps[0].automation_instructions,undefined);
 assert.ok(require('../../backend/lib/automationInstructionMapping').validSavedInstructionMapping(result.steps[1].automation_instructions,{source:result.steps[1].automation_code,stepId:'draft-step-2'}));
 assert.equal(Object.hasOwn(requests[1],'tools'),false);assert.deepEqual(requests[1].response_format,{type:'json_object'});
 assert.deepEqual(result.browser_evidence,{transport:'not_requested',interaction_mode:'not_configured',observation_count:0});
 assert.deepEqual(result.side_effects,{cases_saved:0,target_requests:0,browser_actions:0});assert.deepEqual(writes,[]);
 assert.equal(result.instructions.length,2);assert.equal(result.instructions[1].expected_result,'Invoice one is visible');
 assert.equal(result.executable.filename,'automation.spec.ts');assert.equal(result.executable.framework,'playwright');
 assert.match(result.executable.code,/from '@playwright\/test'/);assert.match(result.executable.code,/api\.request/);assert.match(result.executable.code,/Invoice one/);
 assert.match(result.executable.code,/QAIRA_DATA_JSON/);assert.doesNotMatch(result.executable.code,/private-not-exported/);
 assert.equal(result.draft.status,'draft');assert.equal(result.verification_status,'unverified');
});

test('protected runtime inputs stay bound in model requests and executable source without entering the returned draft',async()=>{
 const requests=[],password='protected-workflow-login-42!';
 const builder=loadBuilder({requests,response:{summary:'Authenticate the supplied account',steps:[{step_id:'draft-step-1',step_type:'web',automation_code:'await page.getByLabel("Password").fill(params["t.password"]); await expect(page.getByRole("button", {name:"Sign in"})).toBeVisible();'}]}});
 const result=await builder.previewAutomationDraft({draft:{title:'Sign in',automation_start_url:'https://ui.fixture/login',parameter_values:{username:'tester@example.test'},steps:[{action:'Enter @t.password',expected_result:'Sign in action remains visible'}]},runtime_parameter_values:{'t.password':password},project_id:'project',app_type_id:'app',user_id:'actor'});
 assert.doesNotMatch(JSON.stringify([requests,result]),/protected-workflow-login-42!/);
 assert.match(JSON.stringify(requests),/@t.password/);
 assert.match(result.executable.code,/params\["t.password"\]/);
 assert.equal(result.parameter_values['t.username'],'tester@example.test');
 assert.equal(result.draft.parameter_values['t.password'],undefined);
 assert.ok(result.parameter_bindings.required_external_parameters.includes('t.password'));
});

test('private input literals in generated executable source fail explicitly rather than publishing a masked script',async()=>{
 const requests=[];
 const builder=loadBuilder({requests,response:{summary:'Fill password',steps:[{step_id:'draft-step-1',step_type:'web',automation_code:'await page.getByLabel("Password").fill("protected-workflow-login-42!"); await expect(page.getByRole("button", {name:"Sign in"})).toBeVisible();'}]}});
 await assert.rejects(builder.previewAutomationDraft({draft:{title:'Sign in',automation_start_url:'https://ui.fixture/login',steps:[{action:'Enter @t.password',expected_result:'Sign in action remains visible'}]},runtime_parameter_values:{'t.password':'protected-workflow-login-42!'},project_id:'project',app_type_id:'app',user_id:'actor'}),{code:'AUTOMATION_PRIVATE_VALUE_IN_SOURCE'});
 assert.equal(requests.length,1,'Private source fails before a display-mapping request can receive it.');
});

test('workflow browser inspection uses upstream MCP, closes the session and publishes no section drafts',async()=>{
 const calls=[],requests=[];
 const builder=loadBuilder({requests,upstreamFixture:{
  connectUpstreamPlaywright:async options=>{calls.push(['connect',options]);return {tools:nativeReadOnlyTools,call:async(name,args)=>{calls.push([name,args]);return {content:[]};},close:async()=>{calls.push(['closed']);}};}
 },browserFixture:{connectAutomationBrowser:async()=>assert.fail('Upstream builds cannot connect the custom browser controller.')},response:(_,request)=>readOnlyUpstreamResponse(request,{source:'await expect(page.getByRole("heading", {name:"Invoice"})).toBeVisible();'})});
 const result=await builder.previewAutomationDraft({draft:{title:'Invoice',description:'Review the supplied invoice',preconditions:['The review account has an existing invoice'],automation_start_url:'https://ui.fixture/invoice',steps:[{action:'Read the Invoice heading',expected_result:'Invoice is visible'}]},project_id:'project',app_type_id:'app',user_id:'actor',inspect_browser:true});
 assert.equal(calls[0][0],'connect');assert.equal(calls[1][0],'browser_navigate');
 assert.equal(calls.at(-1)[0],'closed');assert.equal(requests.length,3);
 assert.deepEqual(requests[0].tools,[{type:'function',function:{name:nativeReadOnlyTools[0].name,description:nativeReadOnlyTools[0].description,parameters:nativeReadOnlyTools[0].inputSchema}}]);
 assert.equal(requests[0].tool_choice,'auto');assert.equal(Object.hasOwn(requests[0],'response_format'),false);
 assert.deepEqual(requests[1].response_format,{type:'json_object'});assert.equal(Object.hasOwn(requests[1],'tools'),false,'Source generation remains a separate configured JSON completion.');
 const actor=JSON.parse(requests[0].messages.at(-1).content),source=JSON.parse(requests[1].messages.at(-1).content);
 assert.deepEqual(actor.context.case,{title:'Invoice',description:'Review the supplied invoice',preconditions:['The review account has an existing invoice']});
 assert.deepEqual(source.task_context,actor.context,'Inspected workflow source retains the same case preconditions as its native actor.');
 assert.equal(Object.hasOwn(actor.context.case,'steps'),false);
 assert.equal(result.browser_evidence.transport,'upstream_playwright_mcp');assert.equal(result.browser_evidence.observation_count,1);
 assert.equal(result.browser_evidence.interaction_mode,'read_only');assert.equal(result.build_engine,'upstream-playwright-v1');
 assert.equal(result.side_effects.cases_saved,0);assert.equal(result.side_effects.browser_actions,0);
 assert.equal(result.verification_status,'unverified','Inspection never claims case execution');
});

test('an explicit workflow browser build performs native steps and returns one complete mapped artifact without browser presentation',async()=>{
 const calls=[],requests=[],writes=[],actors=new Map(),startUrl='https://ui.fixture/employees';let typedValue;
 const originalTools=require('../../../platform/backend/test/fixtures/upstreamPlaywrightMcpTools.v0.0.84.json');
 const native=code=>({content:[{type:'text',text:'### Ran Playwright code\n```js\n'+code+'\n```\n### Snapshot\n- textbox "First Name" [ref=e1]\n- button "Save" [ref=e2]\n- status "Saved"'}]});
 const goto='await page.goto("'+startUrl+'");',fill='await page.getByLabel("First Name").fill(params["r.employee_name"]);',click='await page.getByRole("button",{name:"Save"}).click();';
 const builder=loadBuilder({requests,dbWrites:writes,
  browserFixture:{connectAutomationBrowser:async()=>assert.fail('Workflow builds must use native Playwright MCP.')},
  upstreamFixture:{connectUpstreamPlaywright:async()=>({tools:originalTools,
   capturePreview:async()=>assert.fail('Headless workflow output must not capture a browser presentation.'),
   call:async(name,args)=>{calls.push({name,args});if(name==='browser_navigate')return native(goto);if(name==='browser_type'){typedValue=args.text;return native('await page.getByLabel("First Name").fill('+JSON.stringify(args.text)+');');}if(name==='browser_click')return native(click);assert.fail('Unexpected native tool '+name);},
   close:async()=>calls.push({name:'close'})})},
  response:(_,request)=>{
   const packet=JSON.parse(request.messages.at(-1).content);
   if(request.tools){const id=packet.current_section.id,count=(actors.get(id)||0)+1;actors.set(id,count);return count===1?{tool:id==='draft-step-1'?{name:'browser_type',arguments:{target:'e1',text:'@r.employee_name'}}:{name:'browser_click',arguments:{target:'e2'}}}:{done:true};}
   assert.match(packet.task,/Save this section/);
   return {automation_code:packet.step.id==='draft-step-1'?[goto,fill,'await expect(page.getByLabel("First Name")).toHaveValue(params["r.employee_name"]);'].join('\n'):[click,'await expect(page.getByRole("status")).toHaveText("Saved");'].join('\n')};
  },providerMessage:(request,output)=>request.tools&&output.tool?{tool_calls:[{id:'native-tool-call',type:'function',function:{name:output.tool.name,arguments:JSON.stringify(output.tool.arguments)}}]}:undefined});
 const result=await builder.previewAutomationDraft({draft:{title:'Create employee',automation_start_url:startUrl,parameter_values:{'r.employee_name':'QAIra{{randomString:8}}'},steps:[
  {action:'Enter @r.employee_name in First Name',expected_result:'First Name contains @r.employee_name'},
  {action:'Click Save',expected_result:'Saved confirmation is visible'}]},project_id:'project',app_type_id:'app',user_id:'actor',inspect_browser:true,allow_browser_actions:true});
 assert.deepEqual(calls.map(call=>call.name),['browser_navigate','browser_type','browser_click','close']);
 assert.match(typedValue,/^QAIra[A-Za-z0-9]{8}$/);assert.equal(result.parameter_values['r.employee_name'],typedValue);
 assert.equal(result.side_effects.browser_actions,2);assert.equal(result.side_effects.cases_saved,0);assert.deepEqual(writes,[]);
 assert.equal(result.steps.length,2);assert.ok(result.steps.every(step=>step.automation_instructions));assert.equal(result.executable.filename,'automation.spec.ts');
 assert.match(result.executable.code,/First Name/);assert.match(result.executable.code,/Saved/);assert.equal(result.browser_evidence.interaction_mode,'interactive');
 const mappingCalls=requests.filter(request=>request.messages.at(-1).content.includes('Map the authoritative'));
 assert.equal(mappingCalls.length,2);assert.ok(mappingCalls.every(request=>!request.tools));assert.equal(requests.filter(request=>request.tools).length,4);
 assert.equal(result.verification_status,'unverified','Developing the flow does not impersonate a saved-plan Run.');
});

test('workflow browser execution options fail before permissions, provider calls or native transport when not explicitly valid',async()=>{
 const calls=[],requests=[],writes=[],builder=loadBuilder({denied:true,requests,dbWrites:writes,upstreamFixture:{connectUpstreamPlaywright:async()=>calls.push('connect')}});
 for(const options of [{allow_browser_actions:true,inspect_browser:false},{allow_browser_actions:'true',inspect_browser:true},{inspect_browser:'true'}]){
  await assert.rejects(builder.previewAutomationDraft({draft:{title:'Inspect employee',automation_start_url:'https://ui.fixture',steps:[{action:'Inspect the page',expected_result:'Page is visible'}]},project_id:'project',app_type_id:'app',user_id:'actor',...options}),
   error=>error.statusCode===400&&error.code==='AUTOMATION_BUILD_OPTIONS_INVALID'&&error.effect_dispatched===false);
 }
 assert.deepEqual(calls,[]);assert.deepEqual(requests,[]);assert.deepEqual(writes,[]);
});

test('MCP inspection failures stop automation without a model fallback and close an opened session on provider failure',async()=>{
 const requests=[],closed=[];
 const draft={title:'Invoice',automation_start_url:'https://ui.fixture/invoice',steps:[{action:'Read Invoice',expected_result:'Invoice visible'}]};
 await assert.rejects(loadBuilder({requests,upstreamFixture:{connectUpstreamPlaywright:async()=>{throw Object.assign(new Error('MCP unavailable'),{code:'MCP_UNAVAILABLE'});}}}).previewAutomationDraft({draft,project_id:'project',app_type_id:'app',user_id:'actor',inspect_browser:true}),{code:'MCP_UNAVAILABLE'});
 assert.equal(requests.length,0);
 await assert.rejects(loadBuilder({requests,upstreamFixture:{connectUpstreamPlaywright:async()=>({tools:nativeReadOnlyTools,call:async()=>({content:[]}),close:async()=>{closed.push(true);}})},response:()=>{throw new Error('provider unavailable');}}).previewAutomationDraft({draft,project_id:'project',app_type_id:'app',user_id:'actor',inspect_browser:true}),/provider unavailable/);
 assert.deepEqual(closed,[true]);
});

test('mixed workflow previews use one upstream browser session and native grounded API contracts without the custom browser loop',async()=>{
 const requests=[],writes=[],calls=[];
 const apiRequest={method:'GET',url:'https://api.fixture/invoices/one',validations:[{kind:'status',expected:'200'}]};
 const builder=loadBuilder({requests,dbWrites:writes,
  browserFixture:{connectAutomationBrowser:async()=>assert.fail('Mixed browser flows cannot connect the custom browser controller.'),runAutomationBrowserAgent:async()=>assert.fail('Mixed browser flows cannot use the custom browser loop.')},
  upstreamFixture:{connectUpstreamPlaywright:async()=>{calls.push('connect');return {tools:nativeReadOnlyTools,call:async name=>{calls.push(name);return {content:[]};},close:async()=>calls.push('close')};}},
  response:(_,request)=>readOnlyUpstreamResponse(request,{apiRequest,source:'await expect(page.getByRole("heading", {name:"Invoice one"})).toBeVisible();'})});
 const result=await builder.previewAutomationDraft({draft:{title:'Read and inspect an invoice',automation_start_url:'https://ui.fixture/invoice',steps:[{step_type:'api',action:'GET https://api.fixture/invoices/one',expected_result:'HTTP 200'},{step_type:'web',action:'Read the Invoice one heading',expected_result:'Invoice one is visible'}]},project_id:'project',app_type_id:'app',user_id:'actor',inspect_browser:true});
 assert.deepEqual(calls,['connect','browser_navigate','close']);assert.deepEqual(writes,[]);
 assert.equal(requests.length,4);assert.match(requests[0].messages[0].content,/API Automation Engineer/);
 assert.deepEqual(result.steps.map(step=>step.step_type),['api','web']);
 assert.equal(result.steps[0].automation_code,null);assert.equal(result.steps[0].api_request.url,apiRequest.url);
 assert.equal(result.steps[0].automation_instructions,undefined);assert.ok(result.steps[1].automation_instructions);
 assert.deepEqual(result.instructions.map(step=>step.runtime),['api','web']);
 assert.equal(result.browser_evidence.transport,'upstream_playwright_mcp');assert.ok(result.validation.checks.includes('native_api_contract'));
 assert.match(result.executable.code,/api\.request/);assert.match(result.executable.code,/Invoice one/);
 assert.equal(result.verification_status,'unverified');assert.equal(result.side_effects.browser_actions,0);
});

test('mixed workflow API retries remain grounded and never turn invalid API output into browser actions',async()=>{
 const requests=[],calls=[];
 const builder=loadBuilder({requests,upstreamFixture:{connectUpstreamPlaywright:async()=>({tools:nativeReadOnlyTools,call:async name=>{calls.push(name);return {content:[]};},close:async()=>calls.push('close')})},
  browserFixture:{connectAutomationBrowser:async()=>assert.fail('Mixed API validation must stay on the upstream path.')},
  response:(_,request)=>readOnlyUpstreamResponse(request,{apiRequest:{method:'GET',url:'https://invented.fixture/invoices/one',validations:[{kind:'status',expected:'200'}]}})});
 await assert.rejects(builder.previewAutomationDraft({draft:{title:'Invoice',automation_start_url:'https://ui.fixture/invoice',steps:[{step_type:'api',action:'GET https://api.fixture/invoices/one',expected_result:'HTTP 200'},{step_type:'web',action:'Read Invoice',expected_result:'Invoice visible'}]},project_id:'project',app_type_id:'app',user_id:'actor',inspect_browser:true}),{code:'AUTOMATION_UNGROUNDED_API_TARGET'});
 assert.equal(requests.length,3);assert.deepEqual(calls,['close'],'An invalid leading API section stops before browser navigation.');
});

test('a generated action without its authored expected-result assertion cannot become a validated workflow draft',async()=>{
 const requests=[];
 const builder=loadBuilder({requests,response:attempt=>({summary:'Inspect invoice',steps:[{step_id:'draft-step-1',step_type:'web',automation_code:attempt===1?'await page.getByRole("button", {name:"Invoice"}).click();':'await page.getByRole("button", {name:"Invoice"}).click(); await expect(page.getByRole("heading", {name:"Invoice"})).toBeVisible();'}]})});
 const result=await builder.previewAutomationDraft({draft:{title:'Invoice',automation_start_url:'https://ui.fixture/invoice',steps:[{action:'Open Invoice',expected_result:'Invoice heading visible'}]},project_id:'project',app_type_id:'app',user_id:'actor'});
 assert.equal(requests.length,3);assert.match(JSON.stringify(requests[1]),/needs an executable assertion/);
 assert.match(JSON.stringify(requests[2]),/Map the authoritative code/);
 assert.match(result.steps[0].automation_code,/toBeVisible/);assert.equal(result.validation.status,'passed');
});

test('missing whole-case model content remains an explicit failure instead of a generated fallback summary',async()=>{
 const requests=[];
 const builder=loadBuilder({requests,response:{steps:[{step_id:'draft-step-1',step_type:'api',api_request:{method:'GET',url:'https://api.fixture/invoice',validations:[{kind:'status',expected:'200'}]}}]}});
 await assert.rejects(builder.previewAutomationDraft({draft:{title:'Invoice',steps:[{action:'GET https://api.fixture/invoice',expected_result:'Status equals 200'}]},project_id:'project',app_type_id:'app',user_id:'actor'}),{code:'AUTOMATION_BUILD_INCOMPLETE'});
 assert.ok(requests.length>1&&requests.length<=6);assert.match(JSON.stringify(requests.at(-1)),/nonempty summary/);
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
