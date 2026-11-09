import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {createRequire} from 'node:module';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readEffectiveInputType,registerAutomationMcp} from '../../dist/lib/automationMcp.js';
import {createPrivilegedRunGuard,resolveTestEngineSharedSecret} from '../../dist/lib/testEngineSecurity.js';
import {createWebRunSession} from '../../dist/lib/webEngine.js';
import {runAutomationVerification} from '../../dist/lib/automationVerification.js';
import {compileRecordedProgram as compileEngineProgram} from '../../dist/lib/automationVerificationProgram.js';

const require=createRequire(import.meta.url);
const {compileRecordedProgram}=require('../../../../services/automation/backend/lib/automationRecordedProgram');
const {deriveProgramTools}=require('../../../../services/automation/backend/lib/automationProgramTools');
const {normalizeGeneratedProgram}=require('../../../../services/automation/backend/lib/automationGeneratedProgram');
const {prepareExecutablePlan}=require('../../../../services/automation/backend/services/automationReadiness.service');
const {effectiveInputTypeSource}=require('../../../../services/automation/backend/lib/automationInputType');
const {connectAutomationBrowser}=require('../../../../services/automation/backend/lib/automationBrowserAgent');
const {createBrowserParameterResolver}=require('../../../../services/automation/backend/lib/automationBrowserParameters');
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'
 ?Object.fromEntries(Object.entries(value).filter(([key])=>!['start','end','loc','raw'].includes(key)).map(([key,item])=>[key,stable(item)])):value;
const expression=source=>stable(require('acorn').parseExpressionAt(source,0,{ecmaVersion:'latest'}));
const check=(assertion,locator,value)=>({name:'browser_assert',arguments:{assertion,locator,...(value===undefined?{}:{value})}});

test('editable and effective input type survive confirmed MCP, saved native execution and verification without entering data', {timeout:120000}, async t=>{
 assert.deepEqual(expression(readEffectiveInputType.toString()),expression(effectiveInputTypeSource),'The independently packaged input readers are exactly the same native predicate.');
 const root=await mkdtemp(path.join(tmpdir(),'qaira-input-predicates-'));
 const previousRoot=process.env.ARTIFACT_ROOT,previousHosts=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;
 process.env.ARTIFACT_ROOT=root;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
 let changes=0,session,browserSession;
 const app=Fastify();
 app.get('/login',async(_request,reply)=>reply.type('text/html').send(`<!doctype html><title>Input predicates</title>
  <label>Username<input id="plain"></label><label>Password<input id="password" type="password"></label>
  <label>Upper case attribute<input id="upper" type="PASSWORD"></label><label>Unknown type<input id="unknown" type="unknown-kind"></label>
  <label>Readonly<input id="readonly" readonly></label><label>Disabled<input id="disabled" disabled></label>
  <label>Notes<textarea id="notes"></textarea></label><button id="button" type="submit">Sign in</button>
  <script>for(const name of ['input','change','submit','invalid'])document.addEventListener(name,()=>fetch('/mutation',{method:'POST'}),true);</script>`));
 app.post('/mutation',async()=>{changes++;return{};});
 await registerAutomationMcp(app,createPrivilegedRunGuard(resolveTestEngineSharedSecret()));
 const base=await app.listen({host:'127.0.0.1',port:0});
 t.after(async()=>{
  await session?.close();await browserSession?.stop();await app.close();await rm(root,{recursive:true,force:true});
  if(previousRoot===undefined)delete process.env.ARTIFACT_ROOT;else process.env.ARTIFACT_ROOT=previousRoot;
  if(previousHosts===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=previousHosts;
 });
 const operations=[{name:'browser_navigate',arguments:{url:base+'/login'}},check('editable','#plain'),check('input_type','#plain','text'),
  check('editable','#password'),check('input_type','#password','@r.input_kind'),check('input_type','#upper','password'),check('input_type','#unknown','text'),check('editable','#notes')];
 const parameters={'r.input_kind':'password'},resolver=createBrowserParameterResolver({caseValues:parameters,materialize:false});
 session=await connectAutomationBrowser({integration:{base_url:base},startUrl:base+'/login',allowBrowserActions:false});
 for(const operation of operations){const receipt=await session.call(operation.name,resolver.resolve(operation.name,operation.arguments));assert.notEqual(receipt.isError,true,JSON.stringify(receipt));}
 const source=compileRecordedProgram(operations).source;
 assert.equal(normalizeGeneratedProgram(source),source);
 const lowered=deriveProgramTools({payload:{steps:[{step_id:'login',automation_code:source}]},execution:{required:true,step_id:'login'}});
 assert.deepEqual(lowered,operations);assert.equal(compileEngineProgram(operations)?.source,source,'The saved compiler and independently packaged verification compiler retain the same assertions.');
 assert.doesNotMatch(source,/\.fill\(|getAttribute\(["']type|toLowerCase/);
 await session.close();session=null;
 const plan=await prepareExecutablePlan([{id:'login',order:1,step_type:'web',action:'Inspect the login controls.',expected_result:'The fields are editable and password inputs retain their effective type.',automation_code:source}]);
 assert.deepEqual(plan.issues,[]);
 browserSession=createWebRunSession({engine_run_id:'input-predicates',browser:'chromium',headless:true,web_engine:{active:'playwright'},
  environment:{base_url:base+'/login'},timeouts:{assertion_timeout_ms:250},run_timeout_seconds:60,max_repair_attempts:0,parameters_frozen:true,
  case_parameters:parameters,artifact_policy:{video_mode:'off',trace_mode:'off',screenshot_on_success:false,screenshot_on_failure:false,capture_console:false,capture_network:false},steps:[]});
 await browserSession.start();
 const success=await browserSession.runStep(plan.steps[0]);assert.equal(success.status,'passed',success.note);
 for(const [id,operation] of [['readonly',check('editable','#readonly')],['disabled',check('editable','#disabled')],
  ['wrong-type',check('input_type','#plain','password')],['exact-expected-case',check('input_type','#password','PASSWORD')],['non-input',check('input_type','#button','submit')]]){
  const result=await browserSession.runStep({id,order:2,step_type:'web',action:'Read the selected control.',expected_result:'Preserve the exact asserted property.',automation_code:compileRecordedProgram([operation]).source});
  assert.equal(result.status,'failed',id+' must not acquire evidence from enabled/value/attribute checks');
 }
 await browserSession.stop();browserSession=null;
 const verified=await runAutomationVerification({schema_version:1,verification_id:randomUUID(),lease_token:randomUUID(),execution_driver:'native',
  start_url:base+'/login',sections:[{step_id:'login',automation_code:source,operations}],parameters,
  replay_policy:{mode:'authorized_run',allow_mutations:true},timeout_ms:15000},{artifactRoot:root});
 assert.equal(verified.status,'passed',JSON.stringify(verified));assert.equal(verified.assertion_count,7);assert.equal(verified.completed_interactions,0);
 assert.equal(changes,0,'Inspection never invents test data or dispatches input/change/invalid/submit events.');
});
