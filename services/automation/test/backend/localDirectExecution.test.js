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
test.after(async()=>{await Promise.all([db.close(),obs.close()]);});
const secret='local-execution-test-secret-32-characters-only';
const run={id:'run',project_id:'p',app_type_id:'a',trigger:'local',status:'running',case_snapshots:[{test_case_id:'c',test_case_title:'Case'}],step_snapshots:[]};
const tx={id:'tx',project_id:'p',metadata:{source:'hellotest.local-run',queue_mode:'direct-local',execution_id:'run',test_case_id:'c'}};
function configureSecret(t){const previous=process.env.HELLOTEST_TESTENGINE_SECRET;process.env.HELLOTEST_TESTENGINE_SECRET=secret;t.after(()=>{if(previous===undefined)delete process.env.HELLOTEST_TESTENGINE_SECRET;else process.env.HELLOTEST_TESTENGINE_SECRET=previous;});}
test('local dispatch immediately posts a fresh Playwright run with retained artifacts and no queue insertion',async t=>{
 configureSecret(t);const requests=[];
 t.mock.method(obs,'query',async statement=>{assert.ok(!/INSERT INTO testengine_job_queue/i.test(typeof statement==='string'?statement:statement.text));return {rows:[],rowCount:0};});
 t.mock.method(workspace,'createTransaction',async()=>({...tx}));t.mock.method(workspace,'appendTransactionEvent',async()=>{});
 t.mock.method(globalThis,'fetch',async(url,init)=>{requests.push({url,body:JSON.parse(init.body),headers:init.headers});return Response.json({id:'engine-run',state:'accepted'});});
 const result=await dispatch.runExecutionDirectLocal({engineBaseUrl:'http://127.0.0.1:4311',integration:{base_url:'https://remote.test',config:{web_session_mode:'reuse',connect_over_cdp_endpoint:'http://remote.test/cdp',callback_secret:'other-secret'}},plan:{execution:run,project:{id:'p',name:'Project'},appType:{id:'a',name:'App',type:'web'},automated_case_count:1,manual_case_count:0,unsupported_automated_case_count:0,warnings:[],eligibleCases:[{engine_run_id:'engine-run',case_snapshot:run.case_snapshots[0],steps:[{id:'s',step_type:'web',action:'Open',expected_result:'Visible'}]}]}});
 assert.equal(requests.length,1);assert.equal(requests[0].url,'http://127.0.0.1:4311/api/v1/runs');assert.equal(result.local_run_count,1);assert.equal(result.queued_for_engine_count,0);assert.equal(requests[0].headers['x-hellotest-testengine-secret'],secret);assert.equal(requests[0].body.callback.signing_secret,secret);assert.equal(requests[0].body.web_engine.active,'playwright');assert.equal(requests[0].body.session_policy.web.mode,'new');assert.equal(requests[0].body.session_policy.web.connect_over_cdp_endpoint,null);assert.equal(requests[0].body.artifact_policy.trace_mode,'on');assert.equal(requests[0].body.artifact_policy.video_mode,'on');assert.equal(requests[0].body.artifact_policy.screenshot_on_success,true);assert.match(requests[0].body.callback.url,/\/api\/testengine\/callbacks\/runs$/);
});
test('signed local callbacks do not require a remote integration and preserve provenance across progress updates',async t=>{
 configureSecret(t);t.mock.method(telemetry,'emitExecutionHierarchyEvents',async()=>{});const record=structuredClone(tx),updates=[];
 t.mock.method(executions,'getExecution',async()=>run);
 t.mock.method(integration,'getActiveIntegrationByTypeForProject',async()=>{throw Error('Local callbacks must not depend on a remote engine.');});
 t.mock.method(workspace,'findTransactionByRelated',async()=>record);
 t.mock.method(workspace,'appendTransactionEvent',async(id,event)=>{record.metadata={...record.metadata,...event.metadata};});
 t.mock.method(db,'query',async()=>({rows:[{id:'c',app_type_id:'a'}],rowCount:1}));
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
