import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('real Chromium preserves a private capture for the next step and redacts callback and summary diagnostics', {timeout:30_000}, async t=>{
 const root=await mkdtemp(join(tmpdir(),'hellotest-private-output-'));
 const previous=process.env.ARTIFACT_ROOT;process.env.ARTIFACT_ROOT=root;
 const {queueRunExecution,saveAcceptedRun}=await import('../../dist/lib/executor.js');
 const {buildAcceptedRun}=await import('../../dist/lib/pipeline.js');
 const {getRun}=await import('../../dist/lib/runStore.js');
 const app=Fastify(),callbacks=[],logs=[];const secret='PRIVATE_BROWSER_CAPTURE_48102';
 app.get('/',async(_request,reply)=>reply.type('text/html').send('<!doctype html><input id="value"><output>Public status</output><button id="emit" onclick="console.log('+JSON.stringify(secret).replaceAll('"','&quot;')+')">Emit</button>'));
 app.post('/callback',async request=>{callbacks.push(request.body);return{};});
 const base=await app.listen({host:'127.0.0.1',port:0});
 t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});if(previous===undefined)delete process.env.ARTIFACT_ROOT;else process.env.ARTIFACT_ROOT=previous;});
 const envelope={engine_run_id:'private-browser-output',hellotest_run_id:'run',hellotest_test_case_id:'case',hellotest_test_case_title:'Private output regression',
  browser:'chromium',headless:true,web_engine:{active:'playwright'},environment:{base_url:base,variables:[]},manual_spec:{test_data:{}},
  case_parameters:{'t.private_column':secret},parameters_frozen:true,data_policy:{version:2,case:{private_parameter_names:['t.private_column']}},
  run_timeout_seconds:15,max_repair_attempts:0,timeouts:{assertion_timeout_ms:75},artifact_policy:{trace_mode:'off',video_mode:'off',screenshot_on_failure:false,screenshot_on_success:false,capture_console:true,capture_network:true},
  callback:{url:base+'/callback',signing_secret:'local-callback-regression-key'},steps:[
   {id:'capture',order:1,step_type:'web',action:'Capture private input',automation_code:'capture("t.copy",params["t.private_column"]);'},
   {id:'successor',order:2,step_type:'web',action:'Use captured input',automation_code:'await page.locator("#value").fill(params["t.copy"]);\nawait expect(page.locator("#value")).toHaveValue(params["t.private_column"]);'},
   {id:'failed-outcome',order:3,step_type:'web',action:'Check independent outcome',automation_code:'await page.locator("#emit").click();\nawait expect(page.locator("output")).toHaveText(params["t.private_column"]);'}]};
 const run=saveAcceptedRun(envelope,buildAcceptedRun(envelope));
 await queueRunExecution(envelope,run,{info:(...args)=>logs.push(args),error:(...args)=>logs.push(args)});
 const final=callbacks.findLast(row=>row.event==='run.failed');
 assert.equal(Boolean(final),true,'the intentional business assertion produces a final failure receipt');
 assert.equal(final.case_result.logs.stepStatuses.successor,'passed','the successor consumed the real private capture');
 assert.equal(final.case_result.logs.stepCaptures.capture['t.copy'],'[REDACTED]');
 assert.equal(JSON.stringify(callbacks).includes(secret),false,'public callbacks contain no private input or aliases');
 assert.equal(JSON.stringify(logs).includes(secret),false,'worker logs contain no private input or aliases');
 assert.equal(getRun(run.id).summary.includes(secret),false,'run status contains no private input or aliases');
 const summary=await readFile(join(root,run.artifact_bundle.summary_path),'utf8');
 assert.equal(summary.includes(secret),false,'downloadable JSON summary contains no private input or aliases');
 assert.equal(final.case_result.logs.stepAutomationDetails['failed-outcome'].line_results.some(row=>row.status==='failed'),true,'the original failure remains visible after redaction');
});
