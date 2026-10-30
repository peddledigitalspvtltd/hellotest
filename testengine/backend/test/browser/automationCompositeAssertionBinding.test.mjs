import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {createWebRunSession} from '../../dist/lib/webEngine.js';
import {runAutomationVerification} from '../../dist/lib/automationVerification.js';
import {compileRecordedProgram as compileEngineProgram} from '../../dist/lib/automationVerificationProgram.js';

const require=createRequire(import.meta.url);
const {createBrowserParameterResolver}=require('../../../../services/automation/backend/lib/automationBrowserParameters');
const {buildAutomationParameterBindings}=require('../../../../services/automation/backend/lib/automationParameterBindings');
const {createAutomationInputParameterBinding}=require('../../../../services/automation/backend/lib/automationInputParameterBinding');
const {compileRecordedProgram}=require('../../../../services/automation/backend/lib/automationRecordedProgram');
const {deriveProgramTools}=require('../../../../services/automation/backend/lib/automationProgramTools');
const {prepareVerificationSections}=require('../../../../services/automation/backend/lib/automationVerificationSections');

function recordedFixture() {
  const obligations=[{id:'save',source:'section',action:'Enter @t.item_name and save the form.',expected_result:'The status message displays Saved @t.item_name.'}];
  const resolver=createBrowserParameterResolver({caseValues:{'t.item_name':'Build Fixture','t.other':'Unrelated value'},materialize:false});
  const bindings=buildAutomationParameterBindings({obligations,referencedParameterNames:resolver.referencedParameterNames});
  const policy=createAutomationInputParameterBinding({stepId:'save',obligations,bindings,parameterValues:resolver.promptValues,privateParameterNames:resolver.privateParameterNames});
  const snapshot={tool:'browser_snapshot',result:{content:[{type:'text',text:JSON.stringify({source:'playwright',observation_id:'save-status',elements:[
    {tag:'div',locators_validated:true,locator_candidates:['#status']},
    {tag:'section',locators_validated:true,locator_candidates:['#status-panel']}
  ]})}]}};
  const checks=[['text','#status'],['text_contains','#status-panel'],['text_content','#status'],['text_content_contains','#status-panel'],['title'],['title_normalized']].map(([assertion,locator])=>{
    const request={name:'browser_assert',arguments:{assertion,...(locator?{locator}:{}),value:'Saved Build Fixture'}};
    const original=structuredClone(request),bound=policy.canonicalize(request,{snapshot});
    assert.equal(bound.arguments.value,'Saved @t.item_name','Only the original authored expected-result span grants a reusable composite oracle');
    assert.deepEqual(request,original,'Binding does not mutate the observed request');
    return bound;
  });
  const operations=[
    {name:'browser_fill',arguments:{locator:'#name',value:'@t.item_name'}},
    {name:'browser_click',arguments:{locator:'#save'}},
    ...checks
  ];
  const compiled=compileRecordedProgram(operations);
  assert.ok(compiled);
  assert.equal(compiled.assertion_count,6);
  assert.match(compiled.source,/String\(params\["t\.item_name"\]\)/);
  assert.doesNotMatch(compiled.source,/Saved Build Fixture/,'The saved assertion cannot freeze the build value');
  const lowered=deriveProgramTools({payload:{steps:[{step_id:'save',automation_code:compiled.source}]},execution:{required:true,step_id:'save'}});
  assert.deepEqual(lowered,operations,'Closed source lowering retains all six composite assertions and their original binding');
  assert.equal(compileEngineProgram(operations)?.source,compiled.source,'The independently packaged host and runner compilers agree');
  return {compiled,operations,obligations};
}

test('original composite status assertions replay with edited data and preserve literal token-looking input', {timeout:90000}, async t=>{
  const {compiled,operations,obligations}=recordedFixture();
  const savedSource=compiled.source;
  const root=await mkdtemp(path.join(tmpdir(),'qaira-composite-assertion-'));
  const previousRoot=process.env.ARTIFACT_ROOT,previousHosts=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;
  process.env.ARTIFACT_ROOT=root;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
  const app=Fastify();
  app.get('/form',async (_request,reply)=>reply.type('text/html').send(`<!doctype html>
    <label>Item name<input id="name"></label><button id="save" type="button">Save</button>
    <section id="status-panel"><div id="status" role="status"></div><span>Operation complete</span></section>
    <script>document.getElementById('save').onclick=()=>{const name=document.getElementById('name').value;document.getElementById('status').textContent='  Saved   '+name+'  ';document.title='Saved '+name;};</script>`));
  const origin=await app.listen({host:'127.0.0.1',port:0});
  t.after(async()=>{
    await app.close();await rm(root,{recursive:true,force:true});
    if(previousRoot===undefined)delete process.env.ARTIFACT_ROOT;else process.env.ARTIFACT_ROOT=previousRoot;
    if(previousHosts===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=previousHosts;
  });

  for(const [version,itemName] of [[1,'Build Fixture'],[2,'literal @t.other']]) {
    const resolver=createBrowserParameterResolver({caseValues:{'t.item_name':itemName,'t.other':'Unrelated replacement must never appear'},materialize:false});
    const prepared=prepareVerificationSections([{id:'save',step_type:'web',automation_code:savedSource}],resolver);
    assert.deepEqual({...prepared.parameters},{'t.item_name':itemName},'Only the original referenced parameter is frozen; inserted token-looking data is not scanned');
    assert.deepEqual(prepared.sections[0].operations,operations);
    assert.equal(prepared.sections[0].automation_code,savedSource);
    const session=createWebRunSession({
      engine_run_id:`composite-status-${version}`,browser:'chromium',headless:true,web_engine:{active:'playwright'},
      environment:{base_url:origin+'/form'},run_timeout_seconds:20,max_repair_attempts:0,parameters_frozen:true,
      case_parameters:{'t.item_name':itemName,'t.other':'Unrelated replacement must never appear'},suite_parameters:{},run_parameters:{},
      artifact_policy:{video_mode:'off',trace_mode:'off',screenshot_on_success:false,screenshot_on_failure:false,capture_console:false,capture_network:false},steps:[]
    });
    try {
      await session.start();
      const result=await session.runStep({id:'save',order:1,step_type:'web',action:obligations[0].action,expected_result:obligations[0].expected_result,automation_code:savedSource});
      assert.equal(result.status,'passed',`Composite oracle data version ${version}: ${result.note}`);
      assert.equal(result.recovery_attempted,false,'The parameterized status assertion passes without replay or repair');
    } finally {await session.stop();}
    const verified=await runAutomationVerification({
      schema_version:1,verification_id:randomUUID(),lease_token:randomUUID(),execution_driver:'native',start_url:origin+'/form',
      sections:[{step_id:'save',automation_code:savedSource,operations}],
      parameters:{...prepared.parameters,'t.other':'Unrelated replacement must never appear'},
      replay_policy:{mode:'authorized_run',allow_mutations:true},timeout_ms:15000
    },{artifactRoot:root});
    assert.equal(verified.status,'passed',`Frozen native composite oracle data version ${version}: ${JSON.stringify(verified)}`);
    assert.equal(verified.verification_status,'verified');assert.equal(verified.execution_driver,'native');
    assert.equal(verified.assertion_count,6);assert.equal(verified.completed_interactions,2);assert.equal(verified.completed_operations,8);
    assert.equal(compiled.source,savedSource,'Data changes do not regenerate or rewrite the durable source');
  }
});
