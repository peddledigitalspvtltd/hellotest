const test=require('node:test');const assert=require('node:assert/strict');
const {createHmac}=require('node:crypto');
const dispatch=require('../../backend/services/testEngineDispatch.service');
const callbacks=require('../../backend/services/testEngineCallback.service');
const obs=require('@hellotest/platform/backend/src/obsDb');
const db=require('@hellotest/platform/backend/src/db');
const workspace=require('@hellotest/platform/backend/services/workspaceTransaction.service');
const executions=require('@hellotest/testing/backend/services/execution.service');
const results=require('@hellotest/testing/backend/services/executionResult.service');
const integration=require('@hellotest/integration/backend/services/integration.service');
const telemetry=require('@hellotest/trace/backend/services/opsTelemetry.service');
const { classifyError }=require('../../../platform/backend/src/utils/httpErrorPolicy');
test.after(async()=>{await Promise.all([db.close(),obs.close()]);});
const secret='local-execution-test-secret-32-characters-only';
const run={id:'run',project_id:'p',app_type_id:'a',trigger:'local',status:'running',case_snapshots:[{test_case_id:'c',test_case_title:'Case'}],step_snapshots:[]};
const tx={id:'tx',project_id:'p',metadata:{source:'hellotest.local-run',queue_mode:'direct-local',execution_id:'run',test_case_id:'c'}};
function configureSecret(t){const previous=process.env.HELLOTEST_TESTENGINE_SECRET;process.env.HELLOTEST_TESTENGINE_SECRET=secret;t.after(()=>{if(previous===undefined)delete process.env.HELLOTEST_TESTENGINE_SECRET;else process.env.HELLOTEST_TESTENGINE_SECRET=previous;});}
test('local dispatch immediately posts a fresh Playwright run with retained artifacts and no queue insertion',async t=>{
 configureSecret(t);const requests=[];
 t.mock.method(require('@hellotest/platform/backend/services/aiConfiguration.service'),'resolve',async()=>({config:{instruction_blocks:{'engineRepair.goal':'Preserve the reviewed behavior','engineRepair.screen_selection':'Use the supplied screen','engineRepair.correction_policy':'Keep assertions unchanged'}}}));
 t.mock.method(obs.pool,'query',async statement=>{
  const sql=typeof statement==='string'?statement:statement.text;assert.ok(!/INSERT INTO testengine_job_queue/i.test(sql));
  const rows=/FROM automation_learning_cache/.test(sql)?[
   {id:'field',page_key:'Account',page_url:'https://app.test/login',locator_intent:'Email',locator:'#email',metadata:{object_name:'Email',reference_aliases:['Login.Email'],dom_structure:'CAPTURE_ONLY_DOM',screen_screenshot_url:'data:image/jpeg;base64,CAPTURE_ONLY_IMAGE',playwright_locator:'page.locator("#email")'}},
   {id:'second',page_key:'Login',page_url:'https://app.test/login',locator_intent:'Submit',locator:'#submit',metadata:{object_name:'Submit'}},
   {id:'redirect',page_key:'Login',locator_intent:'Email',locator:'#retired',metadata:{merged_into_entry_id:'field'}}
  ]:[];
  return {rows,rowCount:rows.length};
 });
 t.mock.method(workspace,'createTransaction',async()=>({...tx}));t.mock.method(workspace,'appendTransactionEvent',async()=>{});
 t.mock.method(globalThis,'fetch',async(url,init)=>{requests.push({url,body:JSON.parse(init.body),headers:init.headers});return Response.json({id:'engine-run',state:'accepted'});});
 const result=await dispatch.runExecutionDirectLocal({engineBaseUrl:'http://127.0.0.1:4311',integration:{base_url:'https://remote.test',config:{headless:true,web_session_mode:'reuse',connect_over_cdp_endpoint:'http://remote.test/cdp',callback_secret:'other-secret'}},plan:{execution:run,project:{id:'p',name:'Project'},appType:{id:'a',name:'App',type:'web'},automated_case_count:1,manual_case_count:0,unsupported_automated_case_count:0,warnings:[],eligibleCases:[{engine_run_id:'engine-run',case_snapshot:run.case_snapshots[0],steps:[{id:'s',step_type:'web',action:'Open',expected_result:'Visible'}]}]}});
 assert.equal(requests[0].body.headless,true,'Local execution honors the configured headless setting.');
 assert.equal(requests.length,1);assert.equal(requests[0].url,'http://127.0.0.1:4311/api/v1/runs');assert.equal(result.local_run_count,1);assert.equal(result.queued_for_engine_count,0);assert.equal(requests[0].headers['x-hellotest-testengine-secret'],secret);assert.equal(requests[0].body.callback.signing_secret,secret);assert.equal(requests[0].body.web_engine.active,'playwright');assert.equal(requests[0].body.session_policy.web.mode,'new');assert.equal(requests[0].body.session_policy.web.connect_over_cdp_endpoint,null);assert.equal(requests[0].body.artifact_policy.trace_mode,'on');assert.equal(requests[0].body.artifact_policy.video_mode,'on');assert.equal(requests[0].body.artifact_policy.screenshot_on_success,true);assert.match(requests[0].body.callback.url,/\/api\/testengine\/callbacks\/runs$/);
 assert.equal(requests[0].body.object_repository.length,2);
 const fields=requests[0].body.object_repository;assert.ok(fields.find(field=>field.id==='field').reference_aliases.includes('Login.Email'));
 const second=fields.find(field=>field.id==='second');assert.equal(second.screen_name,'Account');assert.ok(second.reference_aliases.includes('Login.Submit'));
 assert.equal(fields.find(field=>field.id==='field').metadata.playwright_locator,'page.locator("#email")');assert.doesNotMatch(JSON.stringify(fields),/CAPTURE_ONLY_DOM|CAPTURE_ONLY_IMAGE/);
});

test('case Before / After hooks stay scoped to their owner and compose inside the run setup and teardown',async t=>{
 configureSecret(t);const requests=[];
 t.mock.method(require('@hellotest/platform/backend/services/aiConfiguration.service'),'resolve',async()=>({config:{instruction_blocks:{'engineRepair.goal':'Retain behavior','engineRepair.screen_selection':'Observed screen','engineRepair.correction_policy':'Retain assertions'}}}));
 t.mock.method(obs.pool,'query',async()=>({rows:[],rowCount:0}));
 t.mock.method(workspace,'createTransaction',async()=>({...tx}));t.mock.method(workspace,'appendTransactionEvent',async()=>{});
 t.mock.method(globalThis,'fetch',async(url,init)=>{requests.push(JSON.parse(init.body));return Response.json({id:'engine-run',state:'accepted'});});
 const frozen=(id,phase,stepType='api')=>({id,name:id,scope:'test',phase,steps:[{id:`${id}-step`,order:1,step_type:stepType,automation_code:stepType==='web'?'await page.locator("#setup").click();':null,api_request:stepType==='api'?{method:'GET',url:'https://fixture.test/'}:null,
   source_case_context:{case_parameters:{'t.email':'source@example.test'},suite_parameters:{'s.region':'source'},data_policy:{version:2,case:{}},data_set:null}}]});
 const owner={test_case_id:'owner',test_case_title:'Owner',execution_hooks:[frozen('owner-before','pre','web'),frozen('owner-after','post')]},other={test_case_id:'other',test_case_title:'Other'};
 const active={...run,case_snapshots:[owner,other],execution_hooks:[frozen('run-before','pre'),frozen('run-after','post')]};
 await dispatch.runExecutionDirectLocal({engineBaseUrl:'http://127.0.0.1:4311',integration:{config:{}},plan:{execution:active,project:{id:'p',name:'Project'},appType:{id:'a',name:'App',type:'web'},automated_case_count:2,manual_case_count:0,unsupported_automated_case_count:0,warnings:[],eligibleCases:[owner,other].map(case_snapshot=>({engine_run_id:`engine-${case_snapshot.test_case_id}`,case_snapshot,steps:[{id:`main-${case_snapshot.test_case_id}`,step_type:'api',action:'Main',api_request:{method:'GET',url:'https://fixture.test/main'}}]}))}});
 assert.equal(requests.length,2);assert.deepEqual(requests[0].hooks.map(hook=>hook.id),['run-before','owner-before','owner-after','run-after']);
 assert.deepEqual(requests[1].hooks.map(hook=>hook.id),['run-before','run-after']);
 assert.equal(requests[0].hooks[1].steps[0].source_case_context.case_parameters['t.email'],'source@example.test');
 assert.equal(requests[0].hooks[1].steps[0].source_case_context.suite_parameters['s.region'],'source');
});
test('signed local callbacks do not require a remote integration and preserve provenance across progress updates',async t=>{
 configureSecret(t);t.mock.method(telemetry,'emitExecutionHierarchyEvents',async()=>{});const record=structuredClone(tx),updates=[];
 t.mock.method(obs.pool,'connect',async()=>({release(){},query:async()=>({rows:[]})}));
 t.mock.method(executions,'getExecution',async()=>run);
 t.mock.method(integration,'getActiveIntegrationByTypeForProject',async()=>{throw Error('Local callbacks must not depend on a remote engine.');});
 t.mock.method(workspace,'findTransactionByRelated',async()=>record);
 t.mock.method(workspace,'appendTransactionEvent',async(id,event)=>{record.metadata={...record.metadata,...event.metadata};});
 t.mock.method(db.pool,'query',async()=>({rows:[{id:'c',app_type_id:'a'}],rowCount:1}));
 t.mock.method(results,'findLatestExecutionResult',async()=>null);
 t.mock.method(results,'upsertExecutionResult',async value=>{updates.push(value);return {id:'result',...value};});
 const payload={engine_run_id:'engine-run',hellotest_run_id:'run',hellotest_test_case_id:'c',event:'run.progress',state:'running',case_result:{status:'running'}},raw=JSON.stringify(payload),signature=createHmac('sha256',secret).update(raw).digest('hex');
 for(let i=0;i<2;i++){const accepted=await callbacks.handleRunCallback({headers:{'x-hellotest-engine-signature':signature},payload,rawPayload:raw});assert.equal(accepted.execution_result_id,'result');assert.equal(record.metadata.source,'hellotest.local-run');}
 assert.equal(updates.length,1);assert.equal(updates[0].execution_id,'run');
 await assert.rejects(callbacks.handleRunCallback({headers:{'x-hellotest-engine-signature':'invalid'},payload,rawPayload:raw}),e=>e.statusCode===401);
 record.metadata.test_case_id='other';await assert.rejects(callbacks.handleRunCallback({headers:{'x-hellotest-engine-signature':signature},payload,rawPayload:raw}),/does not match a dispatched run/);
});
test('configured remote runner status does not fall back to an unrelated local browser',async t=>{
 const agent=require('../../backend/services/localAgent.service');const previous=process.env.HELLOTEST_LOCAL_RUN_ENGINE_URL;process.env.HELLOTEST_LOCAL_RUN_ENGINE_URL='https://approved-runner.example';t.after(()=>{if(previous===undefined)delete process.env.HELLOTEST_LOCAL_RUN_ENGINE_URL;else process.env.HELLOTEST_LOCAL_RUN_ENGINE_URL=previous;});const urls=[];
 t.mock.method(globalThis,'fetch',async url=>{urls.push(String(url));return Response.json({supported_web_engines:['playwright']},{status:String(url).startsWith('https://approved-runner.example')?503:200});});
 const status=await agent.getStatus();assert.equal(status.web.ready,false);assert.equal(status.web.base_url,'https://approved-runner.example');assert.ok(!urls.some(url=>/:4311/.test(url)));
});

test('live sessions use dispatched project scope and omit credentials or unrelated URLs', async t => {
 const requests=[];
 t.mock.method(obs.pool,'query',async statement=>{requests.push(statement);return {rows:[
  {engine_run_id:'local-run',test_case_id:'c',data_set_iteration_index:'1',data_set_iteration_key:'data:2',url:'http://host.docker.internal:4313/api/v1/live-session?provider=playwright',provider:'playwright'},
  {engine_run_id:'bad',url:'https://user:private@example.test/session',provider:'playwright'},
  {engine_run_id:'bad-scheme',url:'javascript:alert(1)',provider:'playwright'}],rowCount:3};});
 const links=await dispatch.getExecutionLiveSessions(run);
 assert.equal(links.length,1);assert.equal(links[0].url,'http://localhost:4313/api/v1/live-session?provider=playwright&run_id=local-run');
 assert.equal(links[0].test_case_id,'c');assert.equal(links[0].data_set_iteration_index,1);assert.equal(links[0].data_set_iteration_key,'data:2');
 assert.deepEqual(requests[0].values,['p','run']);
 assert.deepEqual(await dispatch.getExecutionLiveSessions({...run,status:'completed'}),[]);
});

test('local runner status distinguishes inspection-only agents and services that are not ready', async t => {
 const agent=require('../../backend/services/localAgent.service');
 for (const [payload, code] of [
  [{service:'hellotest-inspection-agent',ready:true,supported_web_engines:[],capabilities:{local_execution:false}},'LOCAL_AGENT_INSPECTION_ONLY'],
  [{service:'HelloTest Test Engine',ready:false,supported_web_engines:['playwright']},'LOCAL_AGENT_NOT_READY']
 ]) {
  const mock=t.mock.method(globalThis,'fetch',async()=>Response.json(payload));
  const status=await agent.getStatus();assert.equal(status.web.ready,false);assert.equal(status.web.code,code);assert.match(status.web.message,/runner|inspection/i);
  mock.mock.restore();
 }
});

test('a case-scoped viewer never publishes a shared Selenium desktop or a session missing case identity',async t=>{
 t.mock.method(obs.pool,'query',async()=>({rows:[
  {engine_run_id:'selenium',test_case_id:'c',provider:'selenium',url:'http://localhost:7900/?autoconnect=1'},
  {engine_run_id:'unscoped',provider:'playwright',url:'http://localhost:4313/api/v1/live-session'},
  {engine_run_id:'scoped-selenium',test_case_id:'c',provider:'selenium',url:'http://localhost:4301/api/v1/live-session?provider=selenium'}
 ]}));
 const sessions=await dispatch.getExecutionLiveSessions(run);assert.equal(sessions.length,1);assert.equal(sessions[0].engine_run_id,'scoped-selenium');assert.match(sessions[0].url,/run_id=scoped-selenium/);
});

test('local-run setup failures preserve actionable guidance through the public error policy before creating a run', async t => {
 const previous=process.env.HELLOTEST_LOCAL_RUN_ENGINE_URL;
 t.after(()=>{if(previous===undefined)delete process.env.HELLOTEST_LOCAL_RUN_ENGINE_URL;else process.env.HELLOTEST_LOCAL_RUN_ENGINE_URL=previous;});
 const scenarios=[
  [{},503,'LOCAL_AGENT_UNAVAILABLE',/start-host-recorder/],
  [{service:'hellotest-inspection-agent',ready:true,capabilities:{local_execution:false}},200,'LOCAL_AGENT_INSPECTION_ONLY',/inspection agent/],
  [{supported_web_engines:['playwright'],ready:false,capabilities:{local_execution:true}},200,'LOCAL_AGENT_NOT_READY',/shared secret/]
 ];
 for(const [index,[health,status,code,expectedMessage]] of scenarios.entries()){
  process.env.HELLOTEST_LOCAL_RUN_ENGINE_URL=`https://local-run-failure-${index}.example.test`;
  const fetch=t.mock.method(globalThis,'fetch',async()=>Response.json(health,{status}));
  await assert.rejects(executions.createLocalRun({}),error=>{
   const publicError=classifyError(error);
   assert.equal(publicError.code,code);assert.equal(publicError.statusCode,503);
   assert.match(publicError.message,expectedMessage);
   assert.notEqual(publicError.message,'The service is temporarily unavailable.');
   return true;
  });
  fetch.mock.restore();
 }
});

test('local dispatch rejection explains credential repair without exposing the runner response', async t => {
 configureSecret(t);
 t.mock.method(require('@hellotest/platform/backend/services/aiConfiguration.service'),'resolve',async()=>({config:{instruction_blocks:{'engineRepair.goal':'Retain behavior','engineRepair.screen_selection':'Observed screen','engineRepair.correction_policy':'Retain assertions'}}}));
 t.mock.method(obs.pool,'query',async()=>({rows:[],rowCount:0}));
 t.mock.method(workspace,'createTransaction',async()=>({...tx}));
 t.mock.method(workspace,'appendTransactionEvent',async()=>{});
 t.mock.method(workspace,'updateTransaction',async()=>{});
 t.mock.method(globalThis,'fetch',async()=>Response.json({message:'PRIVATE_RUNNER_RESPONSE',secret:'do-not-expose'},{status:401}));
 await assert.rejects(dispatch.runExecutionDirectLocal({engineBaseUrl:'http://127.0.0.1:4313',integration:{config:{}},plan:{execution:run,project:{id:'p',name:'Project'},appType:{id:'a',name:'App',type:'web'},automated_case_count:1,manual_case_count:0,unsupported_automated_case_count:0,warnings:[],eligibleCases:[{engine_run_id:'auth-run',case_snapshot:run.case_snapshots[0],steps:[{id:'s',step_type:'web',action:'Open',expected_result:'Visible'}]}]}}),error=>{
  const publicError=classifyError(error);
  assert.equal(publicError.statusCode,502);assert.match(publicError.message,/same HELLOTEST_TESTENGINE_SECRET/);
  assert.doesNotMatch(publicError.message,/PRIVATE_RUNNER_RESPONSE|do-not-expose/);
  return true;
 });
});
