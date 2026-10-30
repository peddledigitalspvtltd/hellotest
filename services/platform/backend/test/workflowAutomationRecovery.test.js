const test = require('node:test');
const assert = require('node:assert/strict');
const tasks = require('../../../agentic/backend/workflows/artifactTasks');
const inputs = require('../../../agentic/backend/workflows/automationNodeInputs');
const permission = require('../services/permission.service');
const flags = require('../services/featureFlag.service');
const requirements = require('../../../manual/backend/services/requirement.service');
const automation = require('../../../automation/backend/services/aiAutomationBuilder.service');
const connections = require('../../../agentic/backend/workflows/connections');
const settings = require('../../../agentic/backend/workflows/connectionSettings');
const story = {id:'story',project_id:'project',iteration_id:'sprint',revision:4,title:'Read saved invoices',description:'Read the selected saved invoice using its documented API.'};
const caseDraft = index => ({client_id:`case-${index}`,title:`Read invoice ${index}`,description:`Read saved invoice ${index} and assert its response.`,priority:2,test_case_type:'functional',authoring_mode:'structured',requirement_ids:['story'],parameter_values:{},steps:[{action:`GET https://application.example/invoices/${index}`,expected_result:'HTTP 200 with the saved invoice',step_type:'api'}]});
function setup(t, count=3) {
  t.mock.method(permission,'hasPermission',async()=>true);
  t.mock.method(flags,'areEnabled',async()=>true);
  t.mock.method(requirements,'getRequirement',async()=>structuredClone(story));
  t.mock.method(require('../public/applicationAccess'),'getAppType',async()=>({id:'app',project_id:'project',type:'api'}));
  const cases=Array.from({length:count},(_,index)=>caseDraft(index+1));
  const packet={story_id:'story',story_revision:tasks.revision(story),cases,
    case_assurance:cases.map(item=>({verification:{status:'passed'},case_fingerprint:tasks.fingerprint(item),assurance_review:{summary:'The exact API contract is documented.'}}))};
  const run={id:'run',project_id:'project',app_type_id:'app',input_payload:{sprint_id:'sprint'},node_results:[{node_id:'build',status:'running'}]};
  const node={id:'build',data:{kind:'artifactTask',artifactTask:'automation-engineer'}};
  const progress=[];
  const execute = async (signal=new AbortController().signal)=> {
    const result=await tasks.execute({run,node,user:{id:'actor'},signal,context:{input:[packet]},onProgress:async value=>{
      run.node_results[0].progress=structuredClone(value);progress.push(structuredClone(value));
    }});
    return result.__workflow_result;
  };
  return {run,node,packet,progress,execute};
}
const built = input => ({steps:input.draft.steps,validation:{status:'passed'},verification_status:'unverified',summary:`Built ${input.draft.client_id}`});

test('Automation Engineer checkpoints every case, continues generation failures and retries only unfinished cases',async t=>{
  const fixture=setup(t),called=[];let failSecond=true;
  t.mock.method(automation,'previewAutomationDraft',async input=>{
    called.push(input.draft.client_id);
    if(input.draft.client_id==='case-2'&&failSecond)throw Object.assign(new Error('Provider details must not become diagnostics'),{
      code:'AUTOMATION_BUILD_INCOMPLETE',statusCode:422,publicMessage:'The invoice assertion could not be completed.',completed_sections:0,total_sections:1,
      validation_feedback:[{step_id:'draft-step-1',code:'ASSERTION_REQUIRED',message:'Include the documented invoice assertion.'}]});
    return built(input);
  });
  const first=await fixture.execute();
  assert.deepEqual(called,['case-1','case-2','case-3']);
  assert.equal(first.output.outcome,'automation_partial');assert.equal(first.output.verification.status,'needs_input');
  assert.deepEqual(first.output.data[0].automation.map(item=>item?.client_id||null),['case-1',null,'case-3']);
  assert.equal(first.output.data[0].automation_failures[0].case_index,1);
  assert.match(first.output.data[0].automation_failures[0].validation_feedback[0].message,/invoice assertion/);
  assert.deepEqual(fixture.progress.map(item=>item.current_case),[1,2,3]);
  assert.deepEqual(fixture.progress[1].automation_checkpoint.stories[0].automation.map(item=>item?.client_id||null),['case-1',null]);
  assert.deepEqual(first.context.data[0].cases,fixture.packet.cases,'Internal lineage remains pinned to original authored drafts');
  const cancelledRetry=new AbortController();called.length=0;
  await assert.rejects(tasks.execute({run:fixture.run,node:fixture.node,user:{id:'actor'},signal:cancelledRetry.signal,context:{input:[fixture.packet]},onProgress:async value=>{
    fixture.run.node_results[0].progress=structuredClone(value);cancelledRetry.abort();
  }}),{statusCode:499});
  assert.deepEqual(called,[]);
  assert.equal(fixture.run.node_results[0].progress.automation_checkpoint.stories[0].automation[2].client_id,'case-3','An interrupted retry never erases a later case already completed in the original pass');
  failSecond=false;called.length=0;
  const retry=await fixture.execute();
  assert.deepEqual(called,['case-2'],'A matching successful full case never consumes a second model call');
  assert.equal(retry.output.verification.status,'passed');assert.deepEqual(retry.output.data[0].automation_failures,[]);
  assert.deepEqual(retry.output.data[0].automation.map(item=>item.client_id),['case-1','case-2','case-3']);
  fixture.node.data.instructions='Use the current node intent.';called.length=0;
  await fixture.execute();assert.equal(called.length,3,'Changed saved intent invalidates reuse');
});

test('provider, access and unknown-outcome failures stop the batch while preserving its last completed checkpoint',async t=>{
  for(const failure of [Object.assign(new Error('Unavailable'),{statusCode:503}),Object.assign(new Error('Denied'),{statusCode:403}),
    Object.assign(new Error('The previous operation is uncertain'),{code:'AUTOMATION_BUILD_INCOMPLETE',statusCode:422,outcome_unknown:true})]){
    const fixture=setup(t),called=[];
    t.mock.method(automation,'previewAutomationDraft',async input=>{called.push(input.draft.client_id);if(called.length===2)throw failure;return built(input);});
    await assert.rejects(fixture.execute(),error=>error===failure);
    assert.deepEqual(called,['case-1','case-2']);
    assert.equal(fixture.run.node_results[0].progress.automation_checkpoint.stories[0].automation[0].client_id,'case-1');
    t.mock.restoreAll();
  }
});

test('cancellation between cases does not dispatch a later case or discard a completed checkpoint',async t=>{
  const fixture=setup(t),controller=new AbortController(),called=[];
  t.mock.method(automation,'previewAutomationDraft',async input=>{called.push(input.draft.client_id);return built(input);});
  await assert.rejects(tasks.execute({run:fixture.run,node:fixture.node,user:{id:'actor'},signal:controller.signal,context:{input:[fixture.packet]},onProgress:async value=>{
    fixture.run.node_results[0].progress=structuredClone(value);controller.abort();
  }}),{statusCode:499});
  assert.deepEqual(called,['case-1']);assert.equal(fixture.run.node_results[0].progress.automation_checkpoint.stories[0].automation.length,1);
});

test('an unexpandable Gherkin case records its own issue and does not stop later complete cases',async t=>{
  const fixture=setup(t),called=[];
  const outline=fixture.packet.cases[1];outline.authoring_mode='gherkin';outline.steps=[];
  outline.gherkin_document='Feature: Read invoice\nScenario Outline: Read <invoice>\nWhen I GET /invoices/<invoice>\nThen status equals 200';
  fixture.packet.case_assurance[1].case_fingerprint=tasks.fingerprint(outline);
  t.mock.method(automation,'previewAutomationDraft',async input=>{called.push(input.draft.client_id);return built(input);});
  const result=await fixture.execute();
  assert.deepEqual(called,['case-1','case-3']);assert.equal(result.output.data[0].automation_failures[0].code,'AUTOMATION_CASE_STEPS_INVALID');
  assert.match(result.output.data[0].automation_failures[0].message,/Examples rows/);
  assert.equal(result.output.data[0].automation[2].client_id,'case-3');
});

test('node URL, username, JSON data and protected password use runtime bindings without entering durable output',async t=>{
  const fixture=setup(t,1),secret='Workflow-PRIVATE:password-39!';
  const item=fixture.packet.cases[0];item.parameter_values={username:'[Missing: username]',password:'[Missing: password]',invoice_id:'[Missing: invoice]'};
  item.steps=[{action:'GET https://application.example/invoices/@t.invoice_id with @t.username and @t.password',expected_result:'HTTP 200 and the requested invoice',step_type:'api'}];
  fixture.packet.case_assurance[0].case_fingerprint=tasks.fingerprint(item);
  Object.assign(fixture.node.data,{automationStartUrl:'https://application.example',automationUsername:'reviewer@example.test',automationCredentialId:'protected-password',automationData:'{"invoice_id":"42","invoice":{"region":"west"}}'});
  const resolved=[];
  t.mock.method(connections,'resolve',async(...args)=>{resolved.push(args);return{connection:{id:'protected-password',kind:'http',authType:'basic',username:'managed-username',encryptedSecret:{},enabled:true}};});
  t.mock.method(settings,'credential',()=>`managed-username:${secret}`);
  let requested;
  t.mock.method(automation,'previewAutomationDraft',async input=>{requested=input;return {...built(input),draft:input.draft};});
  const result=await fixture.execute();
  assert.equal(requested.runtime_parameter_values['t.password'],secret);
  assert.equal(requested.draft.parameter_values['t.username'],'reviewer@example.test');
  assert.equal(requested.draft.parameter_values['t.invoice'],'{"region":"west"}');
  assert.equal(requested.draft.automation_start_url,'https://application.example/');
  assert.deepEqual(resolved[0],['protected-password','project','https://application.example/','http']);
  assert.doesNotMatch(JSON.stringify([result,fixture.progress]),new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.equal(result.output.data[0].automation[0].parameter_values['t.password'],undefined);
  assert.equal(result.output.data[0].automation[0].parameter_bindings.credential_id,'protected-password');
  assert.equal(result.output.data[0].automation[0].case_fingerprint,tasks.fingerprint(item));
  const inherited=await inputs.resolveNodeInputs({run:fixture.run,node:{...fixture.node,data:{...fixture.node.data,automationUsername:undefined}},user:{id:'actor'},access:tasks.access});
  assert.equal(inherited.values['t.username'],'managed-username');assert.equal(inherited.privateValues['t.password'],secret,'Only the first Basic credential colon separates username from password');
});

test('sensitive data and raw node passwords are rejected, while exact external parameter references remain valid',()=>{
  for(const value of ['{"password":"a-plain-password"}','{"fixture":{"access_token":"a-token"}}','{"Authorization":"Bearer private"}','{"headers":{"Cookie":"private-session"}}','{"session_id":"private"}','[]','broken json']) assert.throws(()=>inputs.parameterData(value),{statusCode:422});
  assert.throws(()=>inputs.validateNodeOptions({automationPassword:'plaintext'}),{statusCode:422});
  assert.throws(()=>inputs.validateNodeOptions({automationStartUrl:'https://user:password@application.example'}));
  assert.throws(()=>inputs.validateNodeOptions({automationStartUrl:'https://application.example?access_token=private'}),{statusCode:422});
  assert.deepEqual(inputs.parameterData('{"password":"@r.login_password","data":{"region":"west"}}'),{'t.password':'@r.login_password','t.data':'{"region":"west"}'});
});

test('protected credentials are reauthorized and origin-bound before reaching the native builder',async t=>{
  const fixture=setup(t,1);Object.assign(fixture.node.data,{automationStartUrl:'https://other.example',automationCredentialId:'password'});
  t.mock.method(connections,'resolve',async()=>{throw Object.assign(new Error('The endpoint must stay within the selected connection.'),{statusCode:403});});
  const build=t.mock.method(automation,'previewAutomationDraft',async()=>{throw new Error('Should not dispatch');});
  await assert.rejects(fixture.execute(),{statusCode:403});assert.equal(build.mock.callCount(),0);
  t.mock.method(permission,'hasPermission',async(_,code)=>code!=='data.view');
  await assert.rejects(fixture.execute(),/data.view/);assert.equal(build.mock.callCount(),0);
});
